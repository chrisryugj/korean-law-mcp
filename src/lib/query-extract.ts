/**
 * 자연어 질의에서 파라미터를 뽑는 추출기 모음 (query-router 전용 헬퍼)
 *
 * 조문번호·법령명·별표번호처럼 "쿼리 문자열 → 도구 파라미터" 변환만 담당한다.
 * 어떤 도구로 갈지(라우팅)는 route-patterns.ts, 시나리오 판정은 scenario-rules.ts.
 */

import { parseLawNameAndHint } from "./annex-notation.js"
import { RELATIVE_NOW_WORDS, RELATIVE_PAST_WORDS } from "./date-patterns.js"

/**
 * 조문 표기 정규식.
 * `제`는 선택 — 실무에서 "44조", "3조의3" 표기가 통용되는데 이를 놓치면
 * 조문 조회 경로에 아예 진입하지 못한다(#103). 숫자를 앞에 요구하므로
 * "조례"·"조문" 같은 단어와는 충돌하지 않는다.
 */
const ARTICLE_RE = /제?\s*(\d+)\s*조(?:\s*의\s*(\d+))?/g

/** 조문 뒤에 붙는 항/호 (조문 조회 파라미터는 아니지만 법령명에서는 걷어내야 한다) */
const ARTICLE_TAIL_RE = /제?\s*\d+\s*조(?:\s*의\s*\d+)?(?:\s*제?\s*\d+\s*항)?(?:\s*제?\s*\d+\s*호)?/g

/** "제38조" / "제10조의2" 정규 표기로 변환 */
function formatArticle(no: string, sub?: string): string {
  return sub ? `제${no}조의${sub}` : `제${no}조`
}

/**
 * 공백 덩어리를 한 칸으로 접는다 (2026-09-23 리뷰 C3).
 * ARTICLE_RE·ARTICLE_TAIL_RE 의 `제?\s*\d+` 는 공백 덩어리의 시작 위치마다 끝까지 훑어 제곱이다
 * (search_ordinance 질의 공백 10만 자: stripArticleTail 5.7초, extractArticleNumbers 13.4초).
 * `\s*` 는 길이 1과 k를 구별하지 않고 추출기는 끝에서 공백을 다시 접으므로 결과는 같다.
 */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ")
}

/** 쿼리에 등장하는 조문번호 전부 (등장 순서, 중복 제거) */
export function extractArticleNumbers(query: string): string[] {
  const found: string[] = []
  for (const m of collapseWhitespace(query).matchAll(ARTICLE_RE)) {
    const jo = formatArticle(m[1], m[2])
    if (!found.includes(jo)) found.push(jo)
  }
  return found
}

/** 첫 번째 조문번호 (없으면 undefined) */
/** 조문 표기(+항/호)를 걷어낸 나머지 — 법령명만 남기려는 호출자를 위한 공개 창구 */
export function stripArticleTail(text: string): string {
  return collapseWhitespace(text).replace(ARTICLE_TAIL_RE, " ").replace(/\s+/g, " ").trim()
}

export function extractArticleNumber(query: string): string | undefined {
  return extractArticleNumbers(query)[0]
}

/** 법령명 꼬리로 인정하는 규범 종류 — 여기까지가 법령명, 뒤에 남은 낱말은 별표명 키워드다 */
const LAW_NAME_TAIL = /(?:법|법률|령|규칙|규정|조례)$/

/**
 * 별표 질의 → get_annexes 파라미터.
 *
 * 별표 표기 문법은 annex-notation 단일 원본이 읽는다 — 여기에 다시 적으면
 * "별표 제28호"의 `제28호`가 라우팅에만 안 걸려 법령명에 섞인 채 업스트림으로 나간다.
 * 번호가 없으면 법령명 뒤에 남은 낱말을 `query`(별표명 좁히기, #94)로 넘긴다 —
 * "번호를 모를 때 쓰라"고 만든 파라미터의 유일한 자연어 경로가 여기다.
 */
export function extractAnnexParams(
  query: string
): { lawName: string, annexNo?: string, jo?: string, query?: string } {
  const { normalizedLawName, annexNo } = parseLawNameAndHint(query)
  // "관세법 제38조 별표 2" 처럼 조문이 함께 오면 어느 조의 별표인지가 정보다 (#130).
  // get_annexes 가 jo 를 받기 전까지는 Zod 가 조용히 버리므로 전달해도 무해하다
  const jo = extractArticleNumber(query)
  // 번호 없는 "별표"·"서식" 낱말과 조문 표기·동사형 수식어는 lawNameFromQuery 이 걷어낸다
  const rest = lawNameFromQuery(normalizedLawName)
  const tokens = rest.split(/\s+/).filter(Boolean)
  let lastLawToken = -1
  tokens.forEach((t, i) => { if (LAW_NAME_TAIL.test(t)) lastLawToken = i })
  if (lastLawToken < 0) return { lawName: rest, annexNo, jo }
  const keywords = tokens.slice(lastLawToken + 1).join(" ")
  return {
    lawName: tokens.slice(0, lastLawToken + 1).join(" "),
    annexNo,
    jo,
    query: keywords || undefined,
  }
}

/**
 * 판결문·법령 전문(축약 해제)을 요구하는 표현인지.
 *
 * `전문` 단독 부분매칭은 금지 — 전문가·전문의·전문성·전문건설업이 전부 걸려
 * 판례 응답의 축약(토큰 74% 감축)을 통째로 해제한다. 요구 문맥을 함께 요구한다.
 */
export function wantsFullText(query: string): boolean {
  return /(?:판결문?|판례|결정문?|본문|원문)\s*전문|전문\s*(?:보여|주세요|줘|열람|그대로)/.test(query) ||
    /전체\s*본문|풀\s*텍스트|축약\s*(?:없이|해제)/.test(query)
}

/**
 * 검색 도구용 extract 를 만든다 — 트리거 어휘를 걷어낸 나머지가 검색어다.
 *
 * `strip` 은 탐지용 `patterns` 와 별개다. 탐지는 부분 일치를 허용해도 되지만
 * (`위헌`으로 헌재 질의를 알아본다) 제거는 낱말을 잘라선 안 된다(`위헌성` → `성`).
 * 그래서 두 정규식은 같은 어휘를 다루되 같은 것일 수 없다 — 대신 선언을 나란히 둬
 * 어긋남이 눈에 보이게 한다. 어긋나면 "유권 해석"의 반쪽만 지워지고
 * "법령 용어 선의"가 "선"으로 잘린다(#119).
 *
 * 트리거가 곧 질의 전부여서 남는 게 없으면 원문을 돌려준다 — 빈 검색어는 업스트림에 보내지 않는다.
 */
export function searchExtract(strip: RegExp) {
  return (query: string): Record<string, unknown> => {
    const out = query.replace(strip, " ").replace(/\s+/g, " ").trim()
    return { query: out || query.trim() }
  }
}

/**
 * 쿼리에서 순수 법령명만 추출.
 *
 * 주의: replace 순서에 의존하지 않도록 한 번에 처리.
 * "등록면허세법"처럼 법령명 자체에 키워드가 포함된 경우 파괴하지 않기 위해
 * 단어 경계(\b에 해당하는 한글 패턴)를 고려하여 제거.
 */
export function lawNameFromQuery(query: string): string {
  return collapseWhitespace(query)
    // 조문번호(+항/호) — 확정적 구문이라 먼저 제거
    .replace(ARTICLE_TAIL_RE, " ")
    // "별표 1", "별표" 등 독립적 사용만 제거
    .replace(/별표\s*\d*(?:\s*의\s*\d+)?/g, "")
    // 뒤 경계는 lookahead(소비 안 함) — 소비하면 "개정 연혁"처럼 연속 키워드의 두 번째가 살아남음
    .replace(/(?:^|\s)(판례|판결|사례|대법원|헌재|행정심판)(?=\s|$)/g, " ")
    .replace(/(?:^|\s)(해석례?|유권해석|질의회신)(?=\s|$)/g, " ")
    // "개정된"처럼 어미가 붙은 형태까지 (남으면 검색어를 오염시킨다)
    .replace(/(?:^|\s)(개정|이력|변경|연혁|신구대조)(?:된|한|되는|하는)?(?=\s|$)/g, " ")
    .replace(/(?:^|\s)(3단비교|위임|인용|체계)(?=\s|$)/g, " ")
    .replace(/(?:^|\s)(영문|영어|English)(?=\s|$)/gi, " ")
    .replace(/(?:^|\s)(서식|양식|별지|신청서)(?=\s|$)/g, " ")
    // 조례/규칙은 법령명 일부이므로 유지
    // 동사형 수식어 제거
    .replace(/(?:^|\s)(검색|조회|확인|검증|알려줘|찾아줘|보여줘|검증해줘)(?=\s|$)/g, " ")
    // 조문 나열의 가운뎃점이 홀로 남는 경우 정리 ("민법 제309조·제310조" → "민법 ·")
    .replace(/\s*[·•]\s*/g, " ")
    // 정리
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * "관세법 2024 vs 2026" 처럼 두 시점을 명시한 질의에서 날짜 파라미터와 법령명을 뽑는다.
 * 시나리오 판정(scenario-rules)과 별개 — 판정은 "무엇인가", 여기는 "값이 얼마인가".
 */
export function extractTimeTravel(query: string): Record<string, unknown> {
  const toYmd = (s: string): string | undefined => {
    const m = s.match(/(\d{4})[.\-]?(\d{1,2})?[.\-]?(\d{1,2})?/)
    if (!m) return undefined
    return `${m[1]}${(m[2] || "01").padStart(2, "0")}${(m[3] || "01").padStart(2, "0")}`
  }
  const dates = query.match(/\d{4}[.\-]?\d{0,2}[.\-]?\d{0,2}/g) || []
  const params: Record<string, unknown> = {}
  if (dates[0]) params.fromDate = toYmd(dates[0])
  // 연도 없는 상대 과거("작년이랑 지금")는 여기서 연초로 확정해야 단독 완결된다(#150) —
  // 비우면 시나리오가 입력 안내로 끝난다. 예전·과거·종전은 날짜가 정해지지 않아 그대로 둔다
  else if (/재작년|작년/.test(query)) params.fromDate = `${new Date().getFullYear() - (/재작년/.test(query) ? 2 : 1)}0101`
  if (dates[1]) params.toDate = toYmd(dates[1])
  // "지금" 쪽 어휘는 date-patterns 한 벌에서 온다 — 여기만 좁으면 같은 질문이
  // "vs 현행"은 되고 "vs 올해"는 안 되는, 표현에 따라 갈리는 라우팅이 된다(#144 후속)
  else if (new RegExp(RELATIVE_NOW_WORDS).test(query)) {
    const now = new Date()
    params.toDate = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`
  }
  const lawName = lawNameFromQuery(
    query
      .replace(/\d{4}\s*[.\-년]?\s*\d{0,2}\s*[.\-월]?\s*\d{0,2}\s*일?/g, " ")
      .replace(new RegExp(`${RELATIVE_PAST_WORDS}|${RELATIVE_NOW_WORDS}`, "g"), " ")
      // 기호(vs·↔·~)는 어디서든, 한글 접속어는 홀로 남은 것만 걷는다 — 경계 없이 지우면
      // "성과평가법"의 `과`가 잘린다(#150). 시점에 붙었던 조사("2024와")는 위에서 시점이 먼저 지워져 홀로 남는다
      .replace(/vs\.?|↔|~/gi, " ")
      .replace(/(?:^|\s)(?:이?랑|하고|대비|부터|까지|에서|와|과)(?=\s|$)/g, " ")
      .replace(/뭐가|달라(?:요|졌어|진\s*게)?|다른\s*점|차이|비교(?:해줘|해\s*줘)?|시점|버전|두/g, " ")
  )
  params.query = lawName || query
  return params
}

/**
 * 절차/비용 의도가 처분/허가 의도보다 강한지 판단.
 * "신고 방법", "허가 절차 수수료" 같은 복합 쿼리에서
 * 절차 키워드가 있으면 procedure를 우선.
 */
export function hasProcedureIntent(query: string): boolean {
  return /절차|방법|수수료|과태료|비용|신청\s*방법|어떻게/.test(query)
}

/**
 * 자치법규 질의로 볼 수 있는 지역명인지.
 * "선거구"·"재청구"처럼 행정구역 접미사로 끝나는 일반 명사를 걸러낸다(#104).
 * 접미사를 포함한 토큰 전체를 넘겨야 한다 — 앞부분만 보면 판정할 수 없다.
 */
const NON_REGION_TOKENS = new Set([
  "연구", "요구", "청구", "재청구", "지구", "추구", "촉구", "욕구", "탐구", "선거구", "지역구", "기구", "놀이기구",
  "도시", "고시", "공시", "명시", "표시", "제시", "예시", "감시", "무시", "즉시", "임시", "실시", "대학입시",
  "장군", "학군", "동시", "당시", "일시", "상시", "수시",
])

export function isRegionToken(token: string): boolean {
  return !NON_REGION_TOKENS.has(token)
}
