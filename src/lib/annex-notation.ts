/**
 * 별표/서식 표기 문법 — 이 레포의 단일 원본.
 *
 * "별표4" · "별표 제4호" · "별표 1의2"(= 별표 제1호의2)는 같은 것을 가리키는 세 표기다.
 * 법제처 별표번호는 6자리 코드(AAAABB)인데 모델도 사람도 그렇게 부르지 않는다.
 * 그 간극을 여기서 한 번만 흡수한다 — 도구 입력(get_annexes.lawName)과 자연어 라우팅이
 * 각자 파서를 두면 문법이 갈라져 한쪽만 "제28호"를 못 읽고 법령명에 흘린다.
 */

/**
 * 별표 표기의 접두 어휘 — **이 목록이 단일 원본이다.**
 *
 * 라우팅 트리거는 넷(`별표`·`서식`·`양식`·`별지`)을 인정하는데 이 모듈이 둘만 알던 때,
 * `별지 제3호`는 번호가 떼어지지 않아 `annexNo` 대신 법령명/`query`로 샜다(#141 계열 N1).
 * 단일 원본이 자기 호출자보다 좁으면 원본 노릇을 못 한다.
 */
export const ANNEX_KEYWORDS = ["별표", "서식", "양식", "별지"] as const
const ANNEX_KEYWORD_SRC = ANNEX_KEYWORDS.join("|")

/** 번호부 문법 — "28" · "제28호" · "1의2" · "제1호의2" · "제59호의2서식" */
const ANNEX_NO_SRC = `(\\d{1,6})\\s*(?:호)?\\s*(?:의\\s*(\\d{1,2}))?`
const ANNEX_NUMBER_RE = new RegExp(ANNEX_NO_SRC)
/**
 * 법령명에 붙어 오는 전체 표기 — 떼어내려면 접두어까지 소비해야 한다.
 * 꼬리의 `서식`도 함께 먹는다: `별지 제3호서식`에서 남겨 두면 그 낱말이 법령명에 붙는다.
 */
const ANNEX_HINT_RE = new RegExp(
  `\\[?\\s*(?:${ANNEX_KEYWORD_SRC})\\s*(?:제)?\\s*${ANNEX_NO_SRC}\\s*(?:서식)?\\s*\\]?`
)

/** 번호 없이 낱말만 나온 표기 — 키워드 필터가 이 낱말을 검색어로 오인하지 않게 지운다 */
export const ANNEX_NOTATION_RE = new RegExp(
  `\\[?\\s*(?:${ANNEX_KEYWORD_SRC})\\s*(?:제)?\\s*(?:\\d{1,6}\\s*(?:호)?\\s*(?:의\\s*\\d{1,2})?)?\\s*(?:서식)?\\s*\\]?`,
  "g"
)

/** 별표 표기의 번호부. 가지번호(의N)가 없으면 sub = null */
export function parseAnnexNumber(raw: string): { main: number, sub: number | null } | undefined {
  const m = raw.match(ANNEX_NUMBER_RE)
  if (!m) return undefined
  const main = Number.parseInt(m[1], 10)
  if (Number.isNaN(main)) return undefined
  return { main, sub: m[2] ? Number.parseInt(m[2], 10) : null }
}

/**
 * 법제처 별표번호 6자리 코드 AAAABB — 번호 4자리 + 가지번호 2자리(없으면 00).
 * JO 코드와 같은 체계다. 2026-08-17 licbyl 실호출로 확정:
 * `002800`=별표 28, `012800`=별지 제128호, `002003`=별지 제20호의3, `001712`=별지 제17호의12.
 */
export function toAnnexCode(main: number, sub: number): string {
  return String(main).padStart(4, "0") + String(sub).padStart(2, "0")
}

/**
 * 6자리 코드 → 번호부. `toAnnexCode`의 짝 연산이다.
 *
 * encode만 있고 decode가 없으면 왕복이 끊긴다: 응답이 `002003`으로 알려 준 별표를
 * 사용자가 그대로 되돌려주면 `"2003"`이라는 없는 번호로 읽혀 제목 매칭이 죽는다(N7).
 * 6자리가 아니거나 숫자가 아니면 undefined — 자연어 표기는 `parseAnnexNumber`가 읽는다.
 */
export function fromAnnexCode(code: string): { main: number, sub: number } | undefined {
  if (!/^\d{6}$/.test(code)) return undefined
  const main = Number.parseInt(code.slice(0, 4), 10)
  const sub = Number.parseInt(code.slice(4), 10)
  if (Number.isNaN(main) || Number.isNaN(sub) || main === 0) return undefined
  return { main, sub }
}

/**
 * 법령명 문자열에 섞인 별표 표기를 떼어낸다.
 * 가지번호가 있으면 6자리 코드로, 없으면 정수 문자열로 돌려준다
 * (뒤쪽은 buildSelectorCandidates 가 6자리 후보를 만들어 흡수한다).
 */
export function parseLawNameAndHint(lawName: string): { normalizedLawName: string, annexNo?: string } {
  const trimmedLawName = lawName.trim()
  // 2026-09-23 리뷰 C2: ANNEX_HINT_RE 의 `\s*` 들은 공백 덩어리에서 제곱으로 백트래킹한다
  // ("관세법 별표" + 공백 10만 자 → 23.6초, get_annexes 가 fetch 전에 멈췄다). 공백을 한 칸으로
  // 접은 사본에서 찾는다. `\s*` 는 길이 1과 k를 구별하지 않으므로 번호·법령명 결과는 같다.
  // 힌트가 없으면 종전처럼 원문(trim)을 그대로 돌려준다.
  const collapsed = trimmedLawName.replace(/\s+/g, " ")
  const annexHintMatch = collapsed.match(ANNEX_HINT_RE)

  if (!annexHintMatch) {
    return { normalizedLawName: trimmedLawName }
  }

  const parsed = parseAnnexNumber(annexHintMatch[0])
  const normalizedLawName = collapsed
    .replace(annexHintMatch[0], " ")
    .replace(/\s+/g, " ")
    .trim()

  if (!parsed) {
    return { normalizedLawName: normalizedLawName || trimmedLawName }
  }

  return {
    normalizedLawName: normalizedLawName || trimmedLawName,
    annexNo: parsed.sub != null ? toAnnexCode(parsed.main, parsed.sub) : String(parsed.main),
  }
}
