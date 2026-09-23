/**
 * verify_citations — LLM 환각 방지 인용 검증 도구
 *
 * 입력 텍스트에서 "법령명 제N조(의M)? 제K항? 제L호?" 형태 인용을 추출하고,
 * 각 인용의 실존을 법제처 API로 교차검증.
 *
 * 구현 방침:
 *   - 법령 검색: lib/law-search.ts의 findLaws (관련도 정렬 + 캐시 재사용)
 *   - 조문 데이터: api-client.getLawText (JSON 원본 필요)
 *   - 항 번호 파싱: article-parser.parseHangNumber (원숫자 ①②③ 처리)
 *
 * 결과:
 *   ✓ 법령·조문 실존 (가능하면 조문 제목 포함)
 *   ✗ 법령 없음 / 조문 없음 (존재 범위 힌트)
 *   ⚠ 법령명 불명확 / 부분 매칭 / API 실패
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { buildJO } from "../lib/law-parser.js"
import { findLaws, findRepealedLaw, looseMatchLawName, INTERPUNCT_CHARS, type LawInfo } from "../lib/law-search.js"
import { parseHangNumber } from "../lib/article-parser.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"
import { toArray } from "../lib/xml-parser.js"
import { matchCitationContent } from "../lib/citation-content-matcher.js"
import { verifyCaseCitations } from "../lib/case-citation.js"

export const VerifyCitationsSchema = z.object({
  text: z.string().min(1).describe("검증할 법률 텍스트 (LLM 답변/계약서/판결문 등). 조문 인용이 포함된 문자열"),
  maxCitations: z.number().min(1).max(30).optional().default(15).describe("검증할 최대 인용 개수 (기본 15, 많을수록 느림)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
})

export type VerifyCitationsInput = z.infer<typeof VerifyCitationsSchema>

interface ParsedCitation {
  raw: string
  lawName?: string
  jo: number
  joBranch?: number
  hang?: number
  ho?: number
  joCode: string
  displayArticle: string
  claimTitle?: string
}

// 조문 인용 패턴 — "제N조", "제N조의M", "제N조 제K항 제L호"
const ARTICLE_REGEX = /제\s*(\d+)\s*조(?:\s*의\s*(\d+))?(?:\s*제\s*(\d+)\s*항)?(?:\s*제\s*(\d+)\s*호)?/g

// 조문 인용 직전 30자에서 법령명 스캔 — "XX법/법률/시행령/시행규칙/규칙/규정/조례"로 끝나는 것.
// 가운뎃점은 INTERPUNCT_CHARS 전체를 허용 — 일부만 넣으면 '표시‧광고에 관한 법률'이
// '광고에 관한 법률'로 절단 추출돼 매칭에 실패한다(정규화는 추출 뒤라 못 살린다).
const LAW_NAME_REGEX = new RegExp(
  `([가-힣][가-힣${INTERPUNCT_CHARS}\\s]{0,30}?(?:법률|법|시행령|시행규칙|규칙|규정|조례))$`
)

// 법령명 앞에 붙는 한국어 접속사·부사·수식어 제거 — "또한 상법" → "상법"
const LAW_NAME_STOPWORDS = /^(또한|그리고|하며|따라서|따라|위해|위하여|의한|의하여|따른|해당|관련|이에|아울러|본|이|저|그|또|및|또는|혹은|한편|더불어|이어|이는|즉|결국|결과적으로|실제로|특히)\s+/u

// 그 자체로는 법령명이 될 수 없는 접미사 어절. 후보 축약이 앞 어절을 다 떼고 나면
// 이런 토큰만 남는데("같은 법 시행규칙" → "시행규칙"), 검색에 넣으면 어떤 문서에서든
// 무관한 법령을 물어온다(#70: "시행규칙" → '119긴급신고의 관리 및 운영에 관한 법률 시행규칙').
const LAW_NAME_SUFFIX_TOKENS = new Set(["법", "법률", "시행령", "시행규칙", "규칙", "규정", "조례"])

// 캡처된 법령명 앞에 내용어 수식어가 남을 수 있음(예: "절도죄는 형법", "이혼시 재산분할은 민법").
// 앞 어절을 하나씩 떼며 검색 후보를 만든다. 전체(full)를 먼저 두어 다어절 법령명
// ("전자상거래 등에서의 소비자보호에 관한 법률")은 그대로 매칭되고, 수식어만 붙은 경우는
// 뒤쪽 후보에서 실제 법령명("형법"·"민법")이 매칭된다. 붙어쓴 법령명은 어절 분리되지 않아 보존.
//
// 모든 어절이 접미사뿐인 후보는 버린다(#70). 후보가 하나도 남지 않으면 빈 배열을 반환하며,
// 이는 "법령명을 특정할 수 없음" 신호다 — 호출자는 검색을 시도하지 말고 ⚠로 보고해야 한다.
export function lawNameCandidates(lawName: string): string[] {
  const tokens = lawName.split(/\s+/).filter(Boolean)
  const candidates: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const slice = tokens.slice(i)
    if (slice.every((t) => LAW_NAME_SUFFIX_TOKENS.has(t))) continue
    const cand = slice.join(" ")
    if (cand.length >= 2) candidates.push(cand)
  }
  if (candidates.length > 0) return candidates
  // 어절 분해가 무의미한 경우(공백 없는 단일 토큰 등)는 원본을 그대로 후보로 쓴다.
  // 단, 원본 자체가 접미사뿐이면 후보 없음 — 무관 법령을 물어오는 것보다 모른다고 하는 게 맞다.
  const whole = lawName.trim()
  const wholeIsSuffixOnly = whole
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => LAW_NAME_SUFFIX_TOKENS.has(t))
  return whole.length >= 2 && !wholeIsSuffixOnly ? [whole] : []
}

// 인용 직전 문맥에서 법령명을 추출.
// 「법령명」 제8조 는 법제처·판결문·실무 문서의 표준 인용 표기인데, 닫는 낫표가
// LAW_NAME_REGEX의 $ 앵커를 막아 법령명이 **전혀** 추출되지 않았다(→ "법령명 추출 실패").
// 이 경우 조문 실존 검증에 진입하지 못해 없는 조문·없는 항도 ✗로 잡히지 않는다.
// = 환각 탐지가 조용히 미가동. 따라서 닫는 인용기호를 먼저 벗긴다.
export function lawNameFromCitationContext(lookbackRaw: string): string | undefined {
  const lookback = lookbackRaw.replace(/[\s」』】〕>]+$/, "")
  const m = lookback.match(LAW_NAME_REGEX)
  if (!m) return undefined
  const name = m[1].replace(/\s+/g, " ").trim().replace(LAW_NAME_STOPWORDS, "").trim()
  return name.length >= 2 ? name : undefined
}

// "같은 법"·"동법" 조응(anaphora). 「A법」 제N조 및 같은 법 시행규칙 제M조 는 법제처 조문·
// 행정규칙·관공서 서식의 표준 표기다. 조응을 해소하지 않으면 법령명이 "같은 법 시행규칙"으로
// 남아 조문 검증에 진입하지 못한다(#70).
const LAW_ANAPHORA_REGEX = /^(?:같은|동)\s*법(?:률)?(?=\s|$)/
// 조응 판별은 **추출된 법령명이 아니라 인용 직전 문맥의 꼬리**를 본다. LAW_NAME_REGEX의 문자
// 클래스가 공백·개행을 포함해서 앞 인용의 잔재를 삼키는 경우가 있고("제250조\n\n같은 법 시행령"
// → "조 같은 법 시행령"), 그러면 조응인데도 조응으로 안 보인다.
// 선행 `(?:^|[^가-힣])`은 "노동법"의 '동법'을 조응으로 오인하지 않기 위한 경계다.
const LAW_ANAPHORA_TAIL_REGEX =
  /(?:^|[^가-힣])((?:같은|동)\s*법(?:률)?(?:\s*(?:시행령|시행규칙))?)\s*$/
// 조응이 가리키는 것은 모법이므로, 선행 법령명이 시행령·시행규칙이면 모법으로 되돌린 뒤
// 이번 인용의 접미사를 붙인다. ("A법 시행령" + "같은 법 시행규칙" → "A법 시행규칙")
const SUBORDINATE_SUFFIX_REGEX = /\s*(?:시행령|시행규칙)$/

/**
 * "같은 법 시행규칙" 류의 조응을 선행 법령명으로 해소한다.
 * @param antecedent 같은 문서에서 직전에 추출된 법령명. 없으면 해소 불가.
 * @returns 해소된 법령명. 조응이 아니면 입력 그대로, 해소 불가면 undefined
 *   (선행 법령명 없이 "같은 법"만 있는 텍스트는 법령명을 특정할 수 없다는 게 정직한 답이다).
 */
export function resolveLawAnaphora(lawName: string, antecedent?: string): string | undefined {
  if (!LAW_ANAPHORA_REGEX.test(lawName)) return lawName
  if (!antecedent) return undefined
  const suffix = lawName.replace(LAW_ANAPHORA_REGEX, "").trim()
  const base = antecedent.replace(SUBORDINATE_SUFFIX_REGEX, "").trim()
  if (!base) return undefined
  return suffix ? `${base} ${suffix}` : base
}

// 인용 바로 뒤 "(제목)"에서 조문 제목 claim 추출 — 내용검증용.
// 개정이력·날짜·항호 참조 괄호는 조문 제목이 아니므로 제외.
function extractClaimTitle(after: string): string | undefined {
  const m = after.match(/^\s*\(([^)]{1,40})\)/)
  if (!m) return undefined
  const t = m[1].trim()
  if (!/[가-힣]/.test(t)) return undefined                    // 한글 없으면 제목 아님
  if (/(개정|신설|삭제|전문개정|본조신설)/.test(t)) return undefined  // 개정이력 괄호
  if (/\d{4}\s*\.\s*\d/.test(t)) return undefined             // 날짜(2020. 1. …)
  if (/^제?\s*\d+\s*(항|호|목|조)/.test(t)) return undefined    // 항/호/목 참조
  return t
}

// export: 조응 해소·법령명 역추적이 순회 상태에 의존하므로 단위 테스트로 고정한다.
export function parseCitations(text: string, maxCitations: number): ParsedCitation[] {
  const citations: ParsedCitation[] = []
  const seen = new Set<string>()
  // "같은 법"·"동법" 조응 해소용 — 문서 순서대로 순회하므로 직전에 추출된 법령명을 들고 간다.
  let antecedent: string | undefined
  let antecedentEnd = 0

  ARTICLE_REGEX.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ARTICLE_REGEX.exec(text)) !== null && citations.length < maxCitations) {
    const [raw, joStr, branchStr, hangStr, hoStr] = m
    if (!joStr) continue

    // 직전 30자에서 법령명 역추적
    const lookbackStart = Math.max(0, m.index - 30)
    const lookback = text.slice(lookbackStart, m.index)

    let lawName: string | undefined
    const anaphora = lookback.match(LAW_ANAPHORA_TAIL_REGEX)
    if (anaphora) {
      // 문단이 바뀌면 승계하지 않는다 — 빈 줄 뒤는 다른 법령을 다루는 단락일 수 있어
      // 잘못 승계하면 무관한 법령을 근거로 ✓/✗를 내는 더 나쁜 오답이 된다.
      const paragraphBroke = /\n\s*\n/.test(text.slice(antecedentEnd, m.index))
      // 경계를 넘은 선행 법령명은 완전히 버린다 — antecedentEnd만 갱신하고 남겨두면
      // 같은 단락의 두 번째 조응부터는 구간에 빈 줄이 없어 stale 법령명을 승계한다.
      if (paragraphBroke) antecedent = undefined
      lawName = resolveLawAnaphora(anaphora[1].trim(), antecedent)
      antecedentEnd = m.index
    } else {
      lawName = lawNameFromCitationContext(lookback)
      if (lawName) {
        antecedent = lawName
        antecedentEnd = m.index
      }
    }

    const jo = parseInt(joStr, 10)
    const joBranch = branchStr ? parseInt(branchStr, 10) : undefined
    const displayArticle = joBranch ? `제${jo}조의${joBranch}` : `제${jo}조`

    let joCode: string
    try {
      joCode = buildJO(displayArticle)
    } catch {
      continue
    }

    const key = `${(lawName || "_").toLowerCase()}::${joCode}::${hangStr || ""}::${hoStr || ""}`
    if (seen.has(key)) continue
    seen.add(key)

    // 조문 번호 바로 뒤 "(제목)" 캡처 — 내용검증(matchCitationContent)용
    const afterIdx = m.index + raw.length
    const claimTitle = extractClaimTitle(text.slice(afterIdx, afterIdx + 45))

    citations.push({
      raw: raw.trim(),
      lawName,
      jo,
      joBranch,
      hang: hangStr ? parseInt(hangStr, 10) : undefined,
      ho: hoStr ? parseInt(hoStr, 10) : undefined,
      joCode,
      displayArticle,
      claimTitle,
    })
  }
  return citations
}

// "20220325" → "2022-03-25". 형식 이상이면 원본 그대로.
function formatYmd(ymd?: string): string {
  if (!ymd || !/^\d{8}$/.test(ymd)) return ymd || ""
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
}

function formatCitationLabel(c: ParsedCitation, officialName?: string): string {
  const name = officialName || c.lawName || "(법령명 미지정)"
  let label = `${name} ${c.displayArticle}`
  if (c.hang) label += ` 제${c.hang}항`
  if (c.ho) label += ` 제${c.ho}호`
  return label
}

/** 인용된 법령명 하나를 법제처 법령으로 특정한 결과. 같은 법령명의 인용들이 이 결과를 공유한다. */
type LawResolution =
  | { kind: "no_candidates" }
  | { kind: "chosen"; law: LawInfo }
  | { kind: "repealed"; law: LawInfo }
  | { kind: "not_found" }
  | { kind: "loose_only"; fallback: LawInfo }
  | { kind: "error"; message: string }

async function resolveCitedLaw(
  apiClient: LawApiClient,
  lawName: string,
  apiKey?: string
): Promise<LawResolution> {
  // 1단계: 법령 검색 — findLaws가 관련도 정렬까지 처리 (민법→난민법 오매칭 방지)
  // 앞 수식어가 남은 캡처("절도죄는 형법")도 후보를 순차 축약하며 실제 법령명을 찾는다.
  let fallback: LawInfo | undefined   // 어떤 후보도 looseMatch 실패 시 ⚠ 메시지용 (전체 캡처 기준)
  // 후보가 하나도 없으면(접미사뿐인 캡처, #70) 검색을 시도하지 않는다 — 시도하면 무관 법령이
  // 물려오고, 검색 결과가 0이면 ✗ NOT_FOUND 로 낙인돼 '법령명 미상'이 '환각'으로 오보된다.
  const candidates = lawNameCandidates(lawName)
  if (candidates.length === 0) return { kind: "no_candidates" }
  try {
    for (const cand of candidates) {
      // searchDisplay=100: "상법"처럼 짧은 법령명이 부분매칭에 밀려 기본 20건에 안 들어올 때 대비
      const results = await findLaws(apiClient, cand, apiKey, 5, 100)
      if (results.length === 0) continue
      if (!fallback) fallback = results[0]
      if (looseMatchLawName(cand, results[0].lawName)) return { kind: "chosen", law: results[0] }
    }
    // 현행(target=law)에서 이 법령을 특정하지 못함 → 폐지된 법령인지 연혁(eflaw)에서 확인.
    // '지어낸 인용(환각)'과 '실존했으나 폐지된 법령'을 구분(존재≠생존).
    //
    // fallback 유무와 무관하게 확인한다 — 후보 축약이 만드는 꼬리 후보('기본법',
    // '관한 법률')는 어떤 문서에서든 무언가를 물어와 fallback을 세우므로, fallback을
    // 조건으로 걸면 다어절 폐지 법령이 ⌛ 대신 ⚠로 강등된다(pickRepealed가 완전일치·
    // 접두만 허용해 꼬리 후보가 엉뚱한 폐지본을 물어올 여지는 없다).
    for (const cand of candidates) {
      const repealed = await findRepealedLaw(apiClient, cand, apiKey)
      if (repealed) return { kind: "repealed", law: repealed }
    }
    return fallback ? { kind: "loose_only", fallback } : { kind: "not_found" }
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) }
  }
}

/** 조문 범위 힌트 " (존재 범위: 제N조~제M조)". 장식 정보라 실패는 빈 문자열로 둔다(판정을 바꾸지 않는다). */
async function articleRangeHint(apiClient: LawApiClient, mst: string, apiKey?: string): Promise<string> {
  try {
    const fullJson = JSON.parse(await apiClient.getLawText({ mst, apiKey }))
    const fullRaw = fullJson?.법령?.조문?.조문단위
    const fullUnits = toArray<any>(fullRaw)
    const nums = fullUnits
      .filter((u: any) => u.조문여부 === "조문" && u.조문번호)
      .map((u: any) => parseInt(u.조문번호, 10))
      .filter((n: number) => !isNaN(n))
    if (nums.length > 0) {
      return ` (존재 범위: 제${Math.min(...nums)}조~제${Math.max(...nums)}조)`
    }
  } catch { /* ignore */ }
  return ""
}

/**
 * 한 번의 verify_citations 호출 안에서 공유하는 조회 메모 (2026-09-23 리뷰 B#3).
 * 같은 법령을 여러 번 인용한 문서가 흔하다("민법 제750조, 민법 제751조 …"). 인용마다 법령 확인과
 * 전문 조회(범위 힌트)를 따로 하면 같은 업스트림 요청이 인용 수만큼 반복돼 요청 예산이 먼저 바닥난다.
 */
interface VerifyMemo {
  resolveLaw(lawName: string): Promise<LawResolution>
  rangeHint(mst: string): Promise<string>
}

function createVerifyMemo(apiClient: LawApiClient, apiKey?: string): VerifyMemo {
  const laws = new Map<string, Promise<LawResolution>>()
  const ranges = new Map<string, Promise<string>>()
  return {
    resolveLaw(lawName) {
      let p = laws.get(lawName)
      if (!p) {
        p = resolveCitedLaw(apiClient, lawName, apiKey)
        laws.set(lawName, p)
      }
      return p
    },
    rangeHint(mst) {
      let p = ranges.get(mst)
      if (!p) {
        p = articleRangeHint(apiClient, mst, apiKey)
        ranges.set(mst, p)
      }
      return p
    },
  }
}

/**
 * 인용 검증 동시 실행 상한 (2026-09-23 리뷰 B#3).
 * 전건을 Promise.all 로 한꺼번에 띄우면 모든 인용의 재시도 사다리가 나란히 진행하다가 요청 예산이
 * 바닥나는 순간 전부가 함께 실패한다(실측 재현: 같은 법령 인용 12건 이상이면 ✓ 0건). 풀로 돌리면
 * 앞선 인용은 끝까지 검증되고 예산 초과는 뒤쪽 일부에만 남는다. 업스트림 예의도 같은 방향이다.
 */
// 4 로 두면 업스트림이 느릴 때(왕복 2초) 인용 30건이 20초가 걸렸다. 법령명 메모로 중복 검색은 이미 없으므로
// 8 이면 호출 수는 같고 대기만 절반이다(2026-09-23 독립 리뷰).
const VERIFY_CONCURRENCY = 8

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

async function verifyOne(
  apiClient: LawApiClient,
  cite: ParsedCitation,
  memo: VerifyMemo,
  apiKey?: string
): Promise<string> {
  const inputLabel = formatCitationLabel(cite)

  if (!cite.lawName) {
    return `⚠ ${inputLabel} — 법령명 추출 실패 (앞 문맥에 법령명 명시 필요)`
  }

  const resolution = await memo.resolveLaw(cite.lawName)
  if (resolution.kind === "no_candidates") {
    return `⚠ ${inputLabel} — 법령명 불명확 ('${cite.lawName}'은(는) 법령명으로 특정할 수 없음. 앞 문맥에 법령명 명시 필요)`
  }
  if (resolution.kind === "error") {
    return `⚠ ${inputLabel} — 법령 검색 실패: ${resolution.message}`
  }
  if (resolution.kind === "repealed") {
    const repealed = resolution.law
    const d = formatYmd(repealed.effectiveDate)
    return `⌛ ${formatCitationLabel(cite, repealed.lawName)} — [REPEALED] 「${repealed.lawName}」은(는) 폐지된 법령입니다(연혁${d ? `, 최종시행 ${d}` : ""}). 실존했으나 현행 법령이 아님 — 후속·대체 법령 확인 필요`
  }
  if (resolution.kind === "not_found") {
    return `✗ ${inputLabel} — [NOT_FOUND] 법제처 DB에 해당 법령 없음 (법령명 오탈자 또는 존재하지 않는 법령)`
  }
  if (resolution.kind === "loose_only") {
    return `⚠ ${inputLabel} — 법제처 검색은 '${resolution.fallback.lawName}'(으)로만 매칭됨. 법령명 정확성 재확인 필요`
  }
  const chosen = resolution.law

  if (!chosen?.mst) return `⚠ ${inputLabel} — MST 추출 실패`

  // 2단계: 해당 조문 조회 (raw JSON 필요 — getLawText tool 대신 apiClient 직접)
  try {
    const jsonText = await apiClient.getLawText({ mst: chosen.mst, jo: cite.joCode, apiKey })
    const json = JSON.parse(jsonText)
    const rawUnits = json?.법령?.조문?.조문단위
    const units = toArray<any>(rawUnits)
    // JO 파라미터가 무시된 열화 응답(#64)에서 첫 조문(제1조 등)을 요청 조문으로 오인하면
    // 없는 조문 인용이 ✓ 실존으로 통과한다 — applicable-law.extractJoText와 같은 가드
    const found = units.find((u: any) => {
      if (u.조문여부 !== "조문") return false
      const num = parseInt(String(u.조문번호 ?? ""), 10)
      const branch = parseInt(String(u.조문가지번호 ?? "0"), 10) || 0
      return num === cite.jo && branch === (cite.joBranch || 0)
    })

    if (!found) {
      // 전체 조회로 범위 힌트 (같은 법령의 없는 조문이 여럿이어도 전문은 한 번만 받는다)
      const rangeHint = await memo.rangeHint(chosen.mst)
      return `✗ ${formatCitationLabel(cite, chosen.lawName)} — [NOT_FOUND] 해당 조문 없음${rangeHint}`
    }

    // 3단계: 항 검증 (명시된 경우)
    const joTitle = found.조문제목 ? `(${found.조문제목})` : ""
    const officialLabel = `${chosen.lawName} ${cite.displayArticle}`

    // 내용검증: 인용한 조문 제목이 실제 조문제목과 일치하는지 (lexdiff matchCitationContent 이식).
    // "존재하는 조문에 엉뚱한 제목 붙인 환각"(예: 제750조(계약해제) ← 실제 불법행위) 탐지.
    if (cite.claimTitle && found.조문제목) {
      const cm = matchCitationContent(cite.claimTitle, String(found.조문제목))
      if (!cm.matched) {
        return `✗ ${officialLabel} — [CONTENT_MISMATCH] 인용 제목 '${cite.claimTitle}' ≠ 실제 조문제목 '${found.조문제목}' (단순 표기차이 아니면 인용 오류)`
      }
    }

    if (cite.hang) {
      const rawHang = found.항
      const hangs = toArray<any>(rawHang)
      const hangNumbers = hangs
        .map((h: any) => parseHangNumber(h.항번호))
        .filter((n: number) => !isNaN(n))

      if (hangNumbers.includes(cite.hang)) {
        return `✓ ${officialLabel}${joTitle} 제${cite.hang}항 실존`
      }
      const maxHang = hangNumbers.length > 0 ? Math.max(...hangNumbers) : 0
      // maxHang=0이면 파싱 실패 가능성 높음 — 조문 자체는 실존이므로 ⚠로 보고
      if (maxHang === 0) {
        return `⚠ ${officialLabel}${joTitle} 실존, 제${cite.hang}항 확인 실패 (API 응답 형식 이상)`
      }
      return `✗ ${officialLabel}${joTitle} — [NOT_FOUND] 제${cite.hang}항 없음 (최대 제${maxHang}항)`
    }

    return `✓ ${officialLabel}${joTitle} 실존${cite.claimTitle ? " · 제목 일치" : ""}`
  } catch (e) {
    return `⚠ ${formatCitationLabel(cite, chosen.lawName)} — 조문 조회 실패: ${e instanceof Error ? e.message : String(e)}`
  }
}

export async function verifyCitations(
  apiClient: LawApiClient,
  input: VerifyCitationsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const citations = parseCitations(input.text, input.maxCitations ?? 15)
    // 판례 인용은 법령 인용과 독립 축이다 — 사건번호를 추출조차 않으면 [HALLUCINATION_DETECTED]
    // 배너가 "전체 인용이 검증됐다"로 오독된다(#93).
    // 같은 법령명은 한 번만 특정하고, 인용은 상한 동시 실행으로 검증한다 (2026-09-23 리뷰 B#3)
    const memo = createVerifyMemo(apiClient, input.apiKey)
    const [results, cases] = await Promise.all([
      mapWithConcurrency(citations, VERIFY_CONCURRENCY, (c) => verifyOne(apiClient, c, memo, input.apiKey)),
      verifyCaseCitations(apiClient, input.text, input.apiKey),
    ])

    if (citations.length === 0 && cases.total === 0) {
      return {
        content: [{
          type: "text",
          text: "[NO_CITATIONS_FOUND] 입력 텍스트에서 조문·판례 인용이 발견되지 않았습니다.\n\n지원 패턴: '민법 제750조', '상법 제401조의2 제2항 제3호', 사건번호 '2013다61381'. 법령명이 빠진 단독 '제N조' 인용은 앞 문맥에서 법령명을 추출하려고 시도합니다.\n\n⚠️ 이 결과는 '검증 성공'이 아니라 '검증할 인용이 없음'입니다. 인용을 포함한 텍스트로 재요청하세요.",
        }],
      }
    }

    const okCount = results.filter((r) => r.startsWith("✓")).length
    const failCount = results.filter((r) => r.startsWith("✗")).length
    const warnCount = results.filter((r) => r.startsWith("⚠")).length
    const repealedCount = results.filter((r) => r.startsWith("⌛")).length

    // 환각 감지 시 isError=true로 LLM이 "검증 통과"로 오인하지 못하게 차단.
    // 폐지 법령(⌛)은 실존했으므로 환각이 아님 — failCount에 포함되지 않는다.
    const hasHallucination = failCount > 0 || cases.fail > 0

    const headerMarker = hasHallucination
      ? "[HALLUCINATION_DETECTED] "
      : repealedCount > 0 ? "[REPEALED_REFERENCE] "
        : (warnCount > 0 || cases.unknown > 0) ? "[PARTIAL_VERIFIED] " : "[VERIFIED] "
    let output = `${headerMarker}== 인용 검증 결과 ==\n`
    output += `법령 인용 ${citations.length}건 | ✓ ${okCount} 실존 | ✗ ${failCount} 오류 | ⌛ ${repealedCount} 폐지 | ⚠ ${warnCount} 확인필요\n`
    output += `판례 인용 ${cases.total + cases.skipped}건 | ✓ ${cases.ok} 실존 | ✗ ${cases.fail} 실존불가 | ⚠ ${cases.unknown} 미확인${cases.skipped > 0 ? ` | ⊘ ${cases.skipped} 미검증` : ""}\n\n`
    if (results.length > 0) output += `▶ 법령 인용\n`
    for (const line of results) {
      output += `${line}\n`
    }
    if (cases.lines.length > 0) {
      output += `${results.length > 0 ? "\n" : ""}▶ 판례 인용\n`
      for (const line of cases.lines) {
        output += `${line}\n`
      }
    }
    if (repealedCount > 0) {
      output += `\n⌛ [REPEALED_REFERENCE] ${repealedCount}건은 폐지된 법령(연혁) 인용입니다. 실존했던 법령이라 '환각'은 아니지만 현행이 아니므로, 후속·대체 법령으로 갱신이 필요한지 확인하세요.\n`
    }
    if (hasHallucination) {
      output += `\n⚠️ [HALLUCINATION_DETECTED] ${failCount + cases.fail}건 인용이 법제처 DB에 실존하지 않거나 인용 내용(조문 제목)이 실제와 불일치합니다.\n`
      output += `   LLM이 지어낸 인용일 가능성이 높습니다. 원문을 수정하거나 사용자에게 '인용 오류'를 명시 보고하세요.\n`
      output += `   절대로 "검증 완료"로 답변하지 마세요.\n`
    }
    if (warnCount > 0) {
      output += `\n💡 ⚠ 항목은 법령명 불명확/부분 매칭/API 일시 실패 등. 법령명을 명시하거나 재시도하세요.\n`
    }
    if (cases.unknown > 0) {
      output += `\n💡 판례 '미확인'은 부존재가 아닙니다 — 법제처 수록 판례는 대법원 중심이라 하급심·미수록 판례는 검색되지 않습니다. 부존재로 단정하지 말고 search_decisions로 교차 확인하세요.\n`
    }

    return {
      content: [{ type: "text", text: truncateResponse(output) }],
      ...(hasHallucination ? { isError: true } : {}),
    }
  } catch (error) {
    return formatToolError(error, "verify_citations")
  }
}
