/**
 * 사건번호 인용 — 추출과 실존 확인 (#93)
 *
 * verify_citations는 법령 인용만 검증하고 "대법원 2099다99999" 같은 판례 인용은
 * 추출조차 하지 않았다. [HALLUCINATION_DETECTED] 배너가 붙은 채 판례가 무검증으로
 * 통과하면 소비자(LLM)는 전체가 검증됐다고 읽는다 — 누락보다 오도가 문제다.
 *
 * 판정 원칙: **부존재 단정 금지.** 법제처 수록 판례는 대법원 중심이라
 * "검색되지 않음"과 "존재하지 않음"을 구별할 수 없다. 구조적으로 불가능한 것
 * (실재하는 사건부호 + 미래 연도)만 ✗로 단정하고, 나머지 미검색은 '미확인'으로 남긴다.
 */
import type { LawApiClient } from "./api-client.js"
import { parsePrecedentXML } from "./xml-parser.js"
import { throwIfRequestCancelled } from "./session-state.js"

/*
 * 추출 규칙과 그 균형 (#93 → #137)
 *
 * 처음엔 부호를 블랙리스트로 걸렀다 — "빠진 부호가 무검증 통과하는 것"이 환각 억제
 * 도구에서 가장 나쁜 실패라고 봤기 때문이다. 그 판단의 절반은 지금도 맞다. 다만
 * 블랙리스트는 산문의 `숫자+한글+숫자`를 전부 사건번호로 만든다
 * ("1000억원2024", "2000개2025", "9001인증2020").
 *
 * 두 위험은 서로 다른 자리에 있다:
 *   - 놓침(false negative) → 검증 안 된 인용이 조용히 통과. ✗ 단정 자리의 위험.
 *   - 오탐(false positive) → "판례 인용 N건"을 지어내고, 확인 상한 5건을 쓰레기가
 *     소진해 **진짜 인용이 ⊘ 미검증으로 밀린다**. 이건 이 모듈 자신의 원칙
 *     ("누락보다 오도가 문제다")에 정면으로 걸린다.
 *
 * 그래서 두 판단을 분리한다. 추출은 실재 사건부호(CASE_CODES)로 한정하고,
 * 부존재 단정(isImpossibleCaseNumber)은 거기서 한 번 더 좁힌다. 목록에서 빠진 부호는
 * 여기(CASE_CODES) 한 곳에만 추가하면 두 경로가 같이 살아난다 — #125의 단일 원본이
 * 이 결정을 감당할 만큼 넓어졌기에 가능한 교환이다.
 *
 * 연도·부호·일련번호 사이 공백도 받는다. 산문은 실재 부호 목록과 수량 후행 가드로
 * 차단한다("2027 예산 500억원", "2030 도 3000명"). 띄어 쓴 판례가 법령과 섞여도
 * 검증 대상에서 빠져 전체 [VERIFIED]로 잘못 인증되지 않게 한다.
 * 선행 `제`·숫자를 막는 것이 조문 인용과의 경계다 — "제999조의9"의 999는 사건연도가 아니다.
 */
/**
 * 실재하는 사건부호 — 이 레포의 **단일 원본** (#125).
 * 같은 지식이 compact-query-planner에도 따로 살면서 므(가사)·후/허(특허)·재(재심)를
 * 빠뜨려 해당 사건번호가 사건번호로 인식되지 않았다. 여기서만 관리한다.
 */
const CASE_CODES = [
  // 민사
  "가소", "가단", "가합", "가", "나", "다카", "다", "머", "자", "차전", "차",
  "카단", "카합", "카기", "카명", "카확", "카", "그", "마", "라", "바", "사", "아", "타",
  "하단", "하합", "하",
  // 형사
  "고단", "고합", "고정", "고약", "고", "노", "도", "오", "초", "감", "전", "보", "모", "로", "코",
  // 행정·조세
  "구단", "구합", "구", "누", "두", "루", "부", "수", "우", "주",
  // 가사
  "드단", "드합", "드", "르", "므", "브", "스", "너", "버",
  "즈단", "즈합", "즈", "느단", "느합", "느",
  // 특허
  "허", "후", "취",
  // 헌재
  "헌가", "헌나", "헌다", "헌라", "헌마", "헌바", "헌사", "헌아",
  // 회생·파산·개인회생 — '파'는 구 파산법 사건부호(예: 2020파123). main의
  // compact-query-planner에는 있었는데 단일 원본 통합 때 빠졌다(#150).
  "회단", "회합", "회확", "회기", "회", "개회", "개확", "간회", "간확", "파",
  // 재심
  "재고합", "재나", "재다", "재두", "재누", "재",
] as const

// 긴 부호 우선. JS 정규식 대안은 leftmost-first라 "재"가 "재고합"보다 앞서면
// 재심 사건번호를 "재" + (숫자 아님)으로 읽고 매칭에 실패한다. 정렬로 순서를 보장한다.
export const CASE_CODE_PATTERN =
  `(?:${[...CASE_CODES].sort((a, b) => b.length - a.length).join("|")})`

/** 법원 사건번호 전체 형태 (연도 4자리 + 부호 + 일련번호). 공백 표기를 허용한다. */
export const COURT_CASE_PATTERN = `(?:19|20)\\d{2}\\s*${CASE_CODE_PATTERN}\\s*\\d{1,8}`

// 부존재 단정(✗) 전용 게이트. 추출보다 한 단계 더 보수적인 자리다 —
// 여기서 통과시키면 "지어낸 인용"이라고 사용자에게 단정하게 된다.
const KNOWN_CASE_CODE_RE = new RegExp(`^${CASE_CODE_PATTERN}$`)

/**
 * 사건번호일 수 없는 후행 음절 — 일련번호 마지막 숫자 직후 한 음절만 본다 (#150).
 * "2030도3000명 증가" 같은 산문(연도형 숫자+실재 부호+수량)이 추출되면
 * isImpossibleCaseNumber가 미래연도로 ✗ 실존불가를 단정한다 — 산문에 환각 배너.
 * 수량 명사(명·개·원·건·회·차·호·억·천)와 단위 음절(조·항·목·년·월·일)은 실존
 * 사건번호 바로 뒤에 붙는 일이 없어 안전하게 자를 수 있다.
 * ⚠️ 조사(의·을·를·이·가·은·는·에·도·만)는 넣지 않는다 — "2013다61381의 판시취지"처럼
 * 실인용 뒤에 조사가 바로 붙는 것이 정상 표기라, 넣으면 정탐이 통째로 죽는다.
 */
const NON_CASE_SYLLABLES = "명개원건회차호년월일조항목억천"

// 추출 규칙 (위 주석의 균형 참조). 부호는 CASE_CODES에 실재하는 것만 인정한다.
// 후행 lookahead에 숫자를 함께 두는 것이 잘림 방어다 — 숫자를 빼면 "…61381명"에서
// 백트래킹이 "…6138"로 물러나 잘린 사건번호를 만들어낸다.
// 공백 수량도 차단한다("2030 도 3000 명이"). 공백 뒤는 단위+조사의 어절 경계까지 본다:
// 단위 음절만 보면 진짜 인용 뒤 "원심"·"조문"까지 오탐으로 지우게 된다.
const CASE_NO_RE = new RegExp(
  `(?<![\\d제])(\\d{2,4}) ?(${CASE_CODE_PATTERN}) ?(\\d{1,7})` +
  `(?![\\d${NON_CASE_SYLLABLES}]| [${NON_CASE_SYLLABLES}](?:으로|로|에서|까지|부터|[을를이가은는에의도만])?(?=$|[^가-힣]))`,
  "g"
)

/** 텍스트에서 사건번호 추출 (예: 2013다61381, 96누4671, 2024헌바107, 2023개회100001) */
export function extractCaseNumbers(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  const normalized = (text || "").replace(/\s+/g, " ")
  CASE_NO_RE.lastIndex = 0
  while ((m = CASE_NO_RE.exec(normalized)) !== null) {
    const cn = `${m[1]}${m[2]}${m[3]}`
    if (!seen.has(cn)) {
      seen.add(cn)
      out.push(cn)
    }
  }
  return out
}

/**
 * 구조적으로 실존할 수 없는 사건번호인지. 사건연도가 미래면 어떤 검색 한계로도
 * 설명되지 않으므로 이때만 부존재를 단정한다(2자리 연도는 세기 추정이 필요해 판단하지 않음).
 * 부호가 실재 사건부호일 때로 한정한다 — 휴리스틱 추출물에 ✗를 붙이면 인용 없는 문서에
 * 환각 배너가 붙는다.
 */
/** 테스트 도달용 공개 — 프로덕션 소비자는 이 파일 안뿐이다 (#143) */
export function isImpossibleCaseNumber(caseNo: string, currentYear: number): boolean {
  const m = /^(\d{4})([가-힣]{1,3})\d+$/.exec(caseNo)
  if (!m) return false
  if (!KNOWN_CASE_CODE_RE.test(m[2])) return false
  return Number.parseInt(m[1], 10) > currentYear
}

/** 업스트림 사건번호 필드는 "2017다360, 2017다377"처럼 여러 건이 붙어 온다.
 *  cite_check도 "입력과 다른 판례가 특정됐는지" 판정에 같은 규칙을 쓴다 (#150). */
export function fieldHasExactCase(field: string, caseNo: string): boolean {
  return field
    .replace(/\s/g, "")
    .split(/[,·;/]/)
    .some(part => part === caseNo)
}

export interface CaseCitationReport {
  total: number
  ok: number
  fail: number
  unknown: number
  /** 상한을 넘겨 확인하지 못한 인용 수 — 침묵하면 헤더가 '전건 검증'으로 읽힌다 */
  skipped: number
  lines: string[]
}

async function verifyOne(
  apiClient: LawApiClient,
  caseNo: string,
  apiKey?: string
): Promise<{ mark: "ok" | "fail" | "unknown"; line: string }> {
  if (isImpossibleCaseNumber(caseNo, new Date().getFullYear())) {
    return {
      mark: "fail",
      line: `✗ ${caseNo} — [NOT_FOUND] 실존할 수 없는 사건번호 (사건연도가 미래)`,
    }
  }
  try {
    const xml = await apiClient.fetchApi({
      endpoint: "lawSearch.do",
      target: "prec",
      extraParams: { nb: caseNo, display: "10" },
      apiKey,
    })
    const parsed = parsePrecedentXML(xml)
    // nb=는 업스트림에서 **전방 일치**다. "2013다6138"로 물으면 "2013다61381"이 돌아온다.
    // 부분 포함으로 받아주면 한 자리 틀린 환각 인용이 실존 판결의 법원·선고일을 달고
    // ✓로 통과한다 — 환각 탐지기가 환각을 인증하는 최악의 실패다. 정확 일치만 인정한다.
    const hit = parsed.items.find(i => fieldHasExactCase(i.사건번호 || "", caseNo))
    if (hit) {
      const meta = [hit.법원명, hit.선고일자].filter(Boolean).join(" ")
      return { mark: "ok", line: `✓ ${caseNo} 실존 — ${meta} ${hit.판례명 || ""}`.trimEnd() }
    }
    return {
      mark: "unknown",
      line: `⚠ ${caseNo} — 미확인 (법제처 수록 판례에서 검색되지 않음. 하급심·미수록 판례일 수 있어 부존재로 단정 불가)`,
    }
  } catch (e) {
    throwIfRequestCancelled()
    return {
      mark: "unknown",
      line: `⚠ ${caseNo} — 미확인 (조회 실패: ${e instanceof Error ? e.message : String(e)})`,
    }
  }
}

/** 텍스트의 사건번호 인용을 추출해 법제처 수록 여부를 확인한다. */
export async function verifyCaseCitations(
  apiClient: LawApiClient,
  text: string,
  apiKey?: string,
  max = 5
): Promise<CaseCitationReport> {
  const found = extractCaseNumbers(text)
  const caseNumbers = found.slice(0, max)
  const skipped = found.length - caseNumbers.length
  if (caseNumbers.length === 0) {
    return { total: 0, ok: 0, fail: 0, unknown: 0, skipped: 0, lines: [] }
  }

  const results = await Promise.all(caseNumbers.map(cn => verifyOne(apiClient, cn, apiKey)))
  const lines = results.map(r => r.line)
  if (skipped > 0) {
    lines.push(`⚠ 사건번호 ${skipped}건은 확인 상한(${max}건)을 넘어 검증하지 않았습니다 — 미검증입니다: ${found.slice(max).join(", ")}`)
  }
  return {
    total: caseNumbers.length,
    ok: results.filter(r => r.mark === "ok").length,
    fail: results.filter(r => r.mark === "fail").length,
    unknown: results.filter(r => r.mark === "unknown").length,
    skipped,
    lines,
  }
}
