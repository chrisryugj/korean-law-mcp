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
import { findLaws, type LawInfo } from "../lib/law-search.js"
import { parseHangNumber } from "../lib/article-parser.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"
import { toArray } from "../lib/xml-parser.js"
import { matchCitationContent } from "../lib/citation-content-matcher.js"

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

// 조문 인용 직전 30자에서 법령명 스캔 — "XX법/법률/시행령/시행규칙/규칙/규정/조례"로 끝나는 것
const LAW_NAME_REGEX = /([가-힣][가-힣·ㆍ\s]{0,30}?(?:법률|법|시행령|시행규칙|규칙|규정|조례))$/

// 법령명 앞에 붙는 한국어 접속사·부사·수식어 제거 — "또한 상법" → "상법"
const LAW_NAME_STOPWORDS = /^(또한|그리고|하며|따라서|따라|위해|위하여|의한|의하여|따른|해당|관련|이에|아울러|본|이|저|그|또|및|또는|혹은|한편|더불어|이어|이는|즉|결국|결과적으로|실제로|특히)\s+/u

// 캡처된 법령명 앞에 내용어 수식어가 남을 수 있음(예: "절도죄는 형법", "이혼시 재산분할은 민법").
// 앞 어절을 하나씩 떼며 검색 후보를 만든다. 전체(full)를 먼저 두어 다어절 법령명
// ("전자상거래 등에서의 소비자보호에 관한 법률")은 그대로 매칭되고, 수식어만 붙은 경우는
// 뒤쪽 후보에서 실제 법령명("형법"·"민법")이 매칭된다. 붙어쓴 법령명은 어절 분리되지 않아 보존.
export function lawNameCandidates(lawName: string): string[] {
  const tokens = lawName.split(/\s+/).filter(Boolean)
  const candidates: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const cand = tokens.slice(i).join(" ")
    if (cand.length >= 2) candidates.push(cand)
  }
  return candidates.length > 0 ? candidates : [lawName]
}

// 후보 법령명과 법제처 공식 법령명의 느슨한 일치 — 공백 무시 + 접두/약칭 허용.
// findLaws가 관련도 정렬은 해도 매칭이 전혀 다른 법령일 수 있어 최종 방어선으로 사용.
export function looseMatchLawName(target: string, official: string): boolean {
  const normalize = (s: string) => s.replace(/\s+/g, "")
  const targetNorm = normalize(target)
  const officialNorm = normalize(official)
  return officialNorm === targetNorm
    || officialNorm.startsWith(targetNorm)
    || targetNorm.startsWith(officialNorm.replace(/(법률|법)$/, "법"))
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

function parseCitations(text: string, maxCitations: number): ParsedCitation[] {
  const citations: ParsedCitation[] = []
  const seen = new Set<string>()

  ARTICLE_REGEX.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ARTICLE_REGEX.exec(text)) !== null && citations.length < maxCitations) {
    const [raw, joStr, branchStr, hangStr, hoStr] = m
    if (!joStr) continue

    // 직전 30자에서 법령명 역추적
    const lookbackStart = Math.max(0, m.index - 30)
    const lookback = text.slice(lookbackStart, m.index).replace(/\s+$/, "")
    const lawMatch = lookback.match(LAW_NAME_REGEX)
    let lawName: string | undefined = lawMatch
      ? lawMatch[1].replace(/\s+/g, " ").trim().replace(LAW_NAME_STOPWORDS, "").trim()
      : undefined
    if (lawName && lawName.length < 2) lawName = undefined

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

function formatCitationLabel(c: ParsedCitation, officialName?: string): string {
  const name = officialName || c.lawName || "(법령명 미지정)"
  let label = `${name} ${c.displayArticle}`
  if (c.hang) label += ` 제${c.hang}항`
  if (c.ho) label += ` 제${c.ho}호`
  return label
}

async function verifyOne(
  apiClient: LawApiClient,
  cite: ParsedCitation,
  apiKey?: string
): Promise<string> {
  const inputLabel = formatCitationLabel(cite)

  if (!cite.lawName) {
    return `⚠ ${inputLabel} — 법령명 추출 실패 (앞 문맥에 법령명 명시 필요)`
  }

  // 1단계: 법령 검색 — findLaws가 관련도 정렬까지 처리 (민법→난민법 오매칭 방지)
  // 앞 수식어가 남은 캡처("절도죄는 형법")도 후보를 순차 축약하며 실제 법령명을 찾는다.
  let chosen: LawInfo | undefined
  let fallback: LawInfo | undefined   // 어떤 후보도 looseMatch 실패 시 ⚠ 메시지용 (전체 캡처 기준)
  try {
    for (const cand of lawNameCandidates(cite.lawName)) {
      // searchDisplay=100: "상법"처럼 짧은 법령명이 부분매칭에 밀려 기본 20건에 안 들어올 때 대비
      const results = await findLaws(apiClient, cand, apiKey, 5, 100)
      if (results.length === 0) continue
      if (!fallback) fallback = results[0]
      if (looseMatchLawName(cand, results[0].lawName)) {
        chosen = results[0]
        break
      }
    }
    if (!fallback) {
      return `✗ ${inputLabel} — [NOT_FOUND] 법제처 DB에 해당 법령 없음 (법령명 오탈자 또는 존재하지 않는 법령)`
    }
    if (!chosen) {
      return `⚠ ${inputLabel} — 법제처 검색은 '${fallback.lawName}'(으)로만 매칭됨. 법령명 정확성 재확인 필요`
    }
  } catch (e) {
    return `⚠ ${inputLabel} — 법령 검색 실패: ${e instanceof Error ? e.message : String(e)}`
  }

  if (!chosen?.mst) return `⚠ ${inputLabel} — MST 추출 실패`

  // 2단계: 해당 조문 조회 (raw JSON 필요 — getLawText tool 대신 apiClient 직접)
  try {
    const jsonText = await apiClient.getLawText({ mst: chosen.mst, jo: cite.joCode, apiKey })
    const json = JSON.parse(jsonText)
    const rawUnits = json?.법령?.조문?.조문단위
    const units = toArray<any>(rawUnits)
    const found = units.find((u: any) => u.조문여부 === "조문")

    if (!found) {
      // 전체 조회로 범위 힌트
      let rangeHint = ""
      try {
        const fullJson = JSON.parse(await apiClient.getLawText({ mst: chosen.mst, apiKey }))
        const fullRaw = fullJson?.법령?.조문?.조문단위
        const fullUnits = toArray<any>(fullRaw)
        const nums = fullUnits
          .filter((u: any) => u.조문여부 === "조문" && u.조문번호)
          .map((u: any) => parseInt(u.조문번호, 10))
          .filter((n: number) => !isNaN(n))
        if (nums.length > 0) {
          rangeHint = ` (존재 범위: 제${Math.min(...nums)}조~제${Math.max(...nums)}조)`
        }
      } catch { /* ignore */ }
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
    if (citations.length === 0) {
      return {
        content: [{
          type: "text",
          text: "[NO_CITATIONS_FOUND] 입력 텍스트에서 조문 인용이 발견되지 않았습니다.\n\n지원 패턴: '민법 제750조', '상법 제401조의2 제2항 제3호'. 법령명이 빠진 단독 '제N조' 인용은 앞 문맥에서 법령명을 추출하려고 시도합니다.\n\n⚠️ 이 결과는 '검증 성공'이 아니라 '검증할 인용이 없음'입니다. 인용을 포함한 텍스트로 재요청하세요.",
        }],
      }
    }

    // 병렬 검증
    const results = await Promise.all(
      citations.map((c) => verifyOne(apiClient, c, input.apiKey))
    )

    const okCount = results.filter((r) => r.startsWith("✓")).length
    const failCount = results.filter((r) => r.startsWith("✗")).length
    const warnCount = results.filter((r) => r.startsWith("⚠")).length

    // 환각 감지 시 isError=true로 LLM이 "검증 통과"로 오인하지 못하게 차단
    const hasHallucination = failCount > 0

    const headerMarker = hasHallucination
      ? "[HALLUCINATION_DETECTED] "
      : warnCount > 0 ? "[PARTIAL_VERIFIED] " : "[VERIFIED] "
    let output = `${headerMarker}== 인용 검증 결과 ==\n총 ${citations.length}건 | ✓ ${okCount} 실존 | ✗ ${failCount} 오류 | ⚠ ${warnCount} 확인필요\n\n`
    for (const line of results) {
      output += `${line}\n`
    }
    if (hasHallucination) {
      output += `\n⚠️ [HALLUCINATION_DETECTED] ${failCount}건 인용이 법제처 DB에 실존하지 않거나 인용 내용(조문 제목)이 실제와 불일치합니다.\n`
      output += `   LLM이 지어낸 인용일 가능성이 높습니다. 원문을 수정하거나 사용자에게 '인용 오류'를 명시 보고하세요.\n`
      output += `   절대로 "검증 완료"로 답변하지 마세요.\n`
    }
    if (warnCount > 0) {
      output += `\n💡 ⚠ 항목은 법령명 불명확/부분 매칭/API 일시 실패 등. 법령명을 명시하거나 재시도하세요.\n`
    }

    return {
      content: [{ type: "text", text: truncateResponse(output) }],
      ...(hasHallucination ? { isError: true } : {}),
    }
  } catch (error) {
    return formatToolError(error, "verify_citations")
  }
}
