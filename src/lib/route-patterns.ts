/**
 * 라우팅 패턴 테이블 (query-router 의 데이터부)
 *
 * "어떤 자연어가 어떤 도구로 가는가"의 선언만 모은다. 매칭 엔진은 query-router.ts,
 * 파라미터 추출기는 query-extract.ts, 시나리오 판정 어휘는 scenario-rules.ts.
 *
 * 시나리오를 실은 패턴(action_plan·customs·penalty·delegation·impact·time_travel)은
 * scenario-rules.ts 의 규칙에서 파생된다 — 어휘를 여기에 다시 적지 않는다(#101).
 */

import {
  extractArticleNumber,
  extractArticleNumbers,
  extractAnnexParams,
  lawNameFromQuery,
  extractTimeTravel,
  hasProcedureIntent,
  searchExtract,
  isRegionToken,
} from "./query-extract.js"
import { ROUTABLE_SCENARIO_RULES } from "./scenario-rules.js"
import { CASE_CODE_PATTERN, CASE_SERIAL_PATTERN } from "./case-citation.js"

export interface Pattern {
  /** 패턴 이름 */
  name: string
  /** 매칭 정규식 배열 (OR 조건) */
  patterns: RegExp[]
  /** 매칭 시 실행할 도구 */
  tool: string
  /** 파라미터 추출 함수 */
  extract: (query: string, match: RegExpMatchArray | null) => Record<string, unknown>
  /** 라우팅 설명 */
  reason: string
  /** 우선순위 (낮을수록 우선) */
  priority: number
  /**
   * 이 패턴이 양보해야 하는 수신 패턴 이름들 (#123).
   * 가드 어휘를 여기 베껴 적지 않는다 — 지목한 패턴의 정규식을 그대로 평가한다.
   * 수신 패턴에 어휘가 늘면 가드도 같이 늘어난다.
   */
  yieldsTo?: string[]
}

// 라우팅이 보는 사건번호. 부호 목록은 case-citation 단일 원본(#125) — 자체
// `[가-힣]{1,5}` 와일드카드는 "2023년 5월"의 `년`을 부호로 읽었고, 어순마다 덧댄
// `(?!년|월|일)` 가드는 한쪽에만 있었다. 실재 부호만 받으면 가드가 필요 없다.
// COURT_CASE_PATTERN 은 연도 4자리 전용이라 "96누4671" 표기를 놓쳐 쓰지 않는다.
const CASE_NO_SRC = `(?<![\\d제])\\d{2,4}\\s*${CASE_CODE_PATTERN}\\s*${CASE_SERIAL_PATTERN}`
const CASE_NO_RE = new RegExp(CASE_NO_SRC)
/** cite_check 트리거 어휘 — 두 어순이 같은 목록을 본다 */
const CITE_CHECK_KEYWORDS = "유효|살아|변경|폐기|뒤집|생사|추적|아직|citator"

/** 법령명 접미사를 가졌지만 법령명이 아닌 일반 낱말 — explicit_law·statistics 공용 블랙리스트 */
const NON_LAW_WORD_RE = /^(?:방법|변경법|입법|사법|문법|용법|어법|수법|기법|활법|진법|심법|산법)$/

/**
 * 특정 법령·조문을 지목하는 신호 — query 를 버리는 패턴(statistics)의 _skip 판정용(#150).
 * `법령`은 법으로 끝나지 않아 걸리지 않고, `방법` 류는 블랙리스트로 거른다.
 */
function hasLawNameSignal(query: string): boolean {
  if (/제\s*\d{1,4}\s*조/.test(query)) return true
  for (const m of query.matchAll(/(?<![가-힣])([가-힣]+(?:법|법률|시행령|시행규칙)|법률)(?![가-힣])/g)) {
    if (!NON_LAW_WORD_RE.test(m[1])) return true
  }
  return false
}

// `(?<![가-힣])` 는 낱말 중간에서 시작하는 시도를 O(1) 에 쳐낸다 —
// 없으면 `[가-힣]+` 가 붙어 있는 한글 덩어리에서 시작 위치마다 끝까지 훑어 제곱이 된다(#121)
const routePatterns: Pattern[] = [
  // ── 1. 특정 조문 조회 (최고 우선) ──
  {
    name: "specific_article",
    patterns: [
      // 조문번호로 끝나는 형태.
      // 앞에 `(.+?)`를 두지 않는다 — 캡처를 쓰지도 않으면서 $ 앵커와 만나 입력 길이의
      // 제곱으로 backtrack 한다. 법령명은 lawNameFromQuery 이 따로 뽑는다.
      /제\s*\d{1,4}\s*조(?:\s*의\s*\d{1,3})?(?:\s*제?\s*\d{1,3}\s*항)?(?:\s*제?\s*\d{1,3}\s*호)?\s*$/,
      // `제` 생략 표기는 법령명 뒤에서만 인정한다 — "도교법 44조", "형법 1조 2항" (#103).
      // 무조건 허용하면 "예산 3조"·"국가 예산이 656조"의 조(兆)가 조문번호로 읽힌다
      /(?<![가-힣])[가-힣]+(?:법|령|규칙|규정|조례|법률)\s*\d{1,4}\s*조(?:\s*의\s*\d{1,3})?(?:\s*제?\s*\d{1,3}\s*항)?(?:\s*제?\s*\d{1,3}\s*호)?\s*$/,
      // 조문번호로 시작하는 형태는 `제`를 요구한다 — 생략까지 허용하면 "60조 연차 며칠이야" 같은
      // 서술형 질의가 통째로 조문 조회로 끌려간다
      /제\d+조(?:의\d+)?\s*(.+)/,
    ],
    tool: "get_law_text",
    // 조문번호 뒤에 다른 의도(검증·비교·판례·이력·시점)가 붙어 있으면 양보한다 —
    // 우선순위 1이 삼키면 그 의도는 라우팅에서 통째로 사라진다(#99).
    // 가드 어휘를 따로 적지 않고 수신 패턴의 정규식을 그대로 평가한다(#123)
    yieldsTo: [
      "impact_map", "applicable_law", "verify_citations", "cite_check",
      "law_system", "law_comparison", "amendment", "precedent",
      "annex", "law_tree", "constitutional", "english_law",
      "interpretation", "nts_interpretation", "mois_interpretation", "moel_interpretation", "insurance_review", "contract_review",
      "scenario_time_travel",
    ],
    extract: (query) => {
      const joList = extractArticleNumbers(query)
      const lawName = lawNameFromQuery(query)
      return { _searchQuery: lawName, jo: joList[0], _joList: joList, _needsMst: true }
    },
    reason: "법령명 + 조문번호 → 해당 조문 직접 조회",
    priority: 1,
  },

  // ── 2. 행정규칙 (고시/훈령 등은 법령명 자체이므로 높은 우선순위) ──
  {
    name: "admin_rule",
    patterns: [
      /훈령|예규|고시|지침|내규/,
    ],
    tool: "search_admin_rule",
    extract: (query) => ({ query }),
    reason: "행정규칙 키워드 → 행정규칙 검색",
    priority: 4,
  },

  // ── 3. 조례/자치법규 검색 ──
  {
    name: "ordinance",
    patterns: [
      /조례/,
      // "시·군·구" 단독이 아닌 "XX시", "XX구" 등 지역+행정구역 패턴
      /(?<![가-힣])[가-힣]+(?:시|군|구)\s+[가-힣]+\s*(?:조례|규칙)/,
      // "조례/규칙" 명시가 없는 자치법규 질의 — "광진구 공무원 휴직 규정" (#104).
      // CLAUDE.md 의 자치법규→상위법령 fallback 체인은 이 1단계에 진입해야 시작된다.
      // 접미사에 `도`는 넣지 않는다 — 위험도·만족도·난이도·인지도가 전부 지역명이 된다.
      /^(?<region>[가-힣]{2,5}(?:특별시|광역시|특별자치시|특별자치도|[시군구]))\s+[가-힣][^]*?(?:조례|규칙|규정|지침|요령|수당|휴직|복무|징계|보조금|사용료|수수료|위원회)/,
    ],
    tool: "search_ordinance",
    // 자치법규 별표 질의는 별표 경로가 받아 간다 — 자치법규 별표 처리(ordinbyl 분기·
    // filterByRelatedLawName·서울특별시 건축 조례의 번호 충돌 사례)는 갖춰져 있는데
    // `/조례/`(우선순위 5)가 annex(10)보다 먼저 삼켜 별표 의도가 사라졌다(N6).
    // 우선순위를 흔드는 대신 #123이 세운 양보 기구를 쓴다 — annex 가 실제로 받아 갈 때만 양보한다.
    yieldsTo: ["annex"],
    extract: (query, match) => {
      // "선거구 획정", "재청구 절차"처럼 행정구역 접미사로 끝나는 일반 명사는 지역명이 아니다.
      // 이름 있는 그룹만 본다 — 위 두 정규식은 캡처 위치가 달라 match[1] 로는 엉뚱한 값을 읽는다
      const region = match?.groups?.region
      if (region && !isRegionToken(region)) return { _skip: true }
      return { query }
    },
    reason: "조례/자치법규 키워드 → 자치법규 검색",
    priority: 5,
  },

  // ── 4. 개정 이력/신구대조 ──
  {
    name: "amendment",
    patterns: [
      // "언제 바뀌었어?", "뭐가 달라졌어" 도 개정 이력 질의다(#122)
      /개정|신구대조|변경\s*이력|연혁|바뀌었|바뀐|달라졌|달라진/,
    ],
    tool: "chain_amendment_track",
    extract: (query) => {
      const lawName = lawNameFromQuery(query)
      // 법령명이 비어있으면 원본 쿼리를 그대로 사용 (chain이 자체 검색)
      return { query: lawName || query }
    },
    reason: "개정/이력 키워드 → 개정추적 체인",
    priority: 10,
  },

  // ── 5. 3단비교/법체계 ──
  {
    name: "law_system",
    patterns: [
      /3단\s*비교|위임\s*조문|인용\s*조문|법\s*체계|시행령\s*비교/,
    ],
    tool: "chain_law_system",
    extract: (query) => ({ query: lawNameFromQuery(query) || query }),
    reason: "법체계/3단비교 키워드 → 법체계 체인",
    priority: 10,
  },

  // ── 6. 별표/서식 조회 ──
  {
    name: "annex",
    patterns: [
      // "XX법 별표", "XX령 서식" 등 법령명이 함께 있는 경우만 매칭.
      // `조례`를 포함하는 이유: 자치법규 별표 처리(ordinbyl 분기·filterByRelatedLawName·
      // 서울특별시 건축 조례의 번호 충돌 사례)는 이미 갖춰져 있는데 그리로 가는 자연어 문만
      // 닫혀 있었다 — "서울특별시 건축 조례 별표 4"가 search_ordinance 로 새면서 별표 의도가
      // 통째로 사라진다(N6). annex 는 priority 10 이라 search_ordinance(20)보다 앞선다.
      /(?<![가-힣])[가-힣]+(?:\s*조례|법|령|규칙|규정)\s*(?:별표|서식|양식|별지)/,
      // 조문번호가 사이에 끼어도 별표 의도가 이긴다 — "관세법 제38조 별표 2" (#130).
      // 조문 조회로 가면 별표 번호가 통째로 사라진다
      /(?<![가-힣])[가-힣]+(?:\s*조례|법|령|규칙|규정)[^]{0,20}?제?\s*\d{1,4}\s*조(?:\s*의\s*\d{1,3})?\s*(?:별표|서식|양식|별지)/,
      // "별표" 단독은 매칭하되 법령명 추출이 비어있으면 chain_full_research로 폴백
    ],
    tool: "get_annexes",
    extract: (query) => {
      // 별표 번호를 버리면 법령의 별표 목록만 돌아온다 — get_annexes 는 annexNo 를 받는다(#103).
      // 번호가 없으면 남은 키워드가 query 로 간다 — annex-notation 이 표기를 읽는다.
      const { lawName, annexNo, jo, query: keywords } = extractAnnexParams(query)
      if (!lawName) {
        // 법령명 없이 "별표"만 → 종합 리서치로 폴백
        return { _fallback: true, query }
      }
      const params: Record<string, unknown> = { lawName }
      if (annexNo) params.annexNo = annexNo
      // 조문 동반형("관세법 제38조 별표 2")의 조문값 — get_annexes 가 jo 를 열면(#133)
      // 그때부터 소비된다. 그 전에는 Zod 가 조용히 버린다
      if (jo) params.jo = jo
      if (keywords) params.query = keywords
      return params
    },
    reason: "별표/서식 키워드 → 별표 조회",
    priority: 10,
  },

  // ── 7. 판례 검색 ──
  {
    name: "precedent",
    patterns: [
      // `판례`는 심판례 합성어(행정심판례·조세심판례)의 꼬리를 물지 않는다 — 물면
      // admin_appeal/tax_tribunal 의 양보 가드(#150)가 합성어 질의까지 넘겨 #129 가 역행한다
      /(?<!심)판례|판결|대법원\s*판/,
    ],
    tool: "search_precedents",
    // `전문`은 낱말 경계 필수 — 전문가·전문의·전문성이 "가"·"의"·"성"으로 잘린다.
    // `대법원\s*판` 으로 탐지하되 제거는 `대법원` 까지만 — "판단"의 `판` 을 먹으면 안 된다
    extract: searchExtract(/판례|판결|대법원|보여줘|(?:^|\s)전문(?=\s|$)/g),
    reason: "판례 키워드 → 판례 검색",
    priority: 10,
  },

  // ── 8. 해석례 ──
  {
    name: "interpretation",
    patterns: [
      /해석례?|유권\s*해석|질의\s*회신/,
    ],
    tool: "search_interpretations",
    extract: searchExtract(/해석례?|유권\s*해석|질의\s*회신/g),
    reason: "해석례 키워드 → 해석례 검색",
    priority: 10,
  },

  // ── 9. 헌재 결정례 ──
  {
    name: "constitutional",
    patterns: [
      /헌재|헌법재판|위헌/,
    ],
    tool: "search_constitutional_decisions",
    // 탐지는 `위헌` 도 보지만 제거하지는 않는다 — "위헌성"이 "성"으로 잘린다.
    // `결정례?` 는 "결정문"에서 고아 "문"을 남긴다(#150) — 례·문을 통으로 걷는다
    extract: searchExtract(/헌재|헌법\s*재판소?|결정(?:례|문)?/g),
    reason: "헌재 키워드 → 헌재 결정례 검색",
    priority: 10,
  },

  // ── 10. 행정심판 ──
  {
    name: "admin_appeal",
    patterns: [
      /행정심판|행심/,
    ],
    tool: "search_admin_appeals",
    // `례` 단독 제거 금지 — 사례·선례·관례·비례가 전부 잘린다
    extract: searchExtract(/행정\s*심판례?|행심/g),
    // `행정심판례` 는 `판례` 를 품는다 — precedent(10)보다 앞서야 심판례 질의를 뺏기지 않는다(#129).
    // 역방향(#150): "재결 취소 대법원 판례"처럼 법원 판례를 명시하면 precedent 가 받아 간다 —
    // precedent 의 `판례`가 (?<!심) 이라 합성어는 넘어가지 않으므로 두 방향이 동시에 성립한다
    yieldsTo: ["precedent"],
    reason: "행정심판 키워드 → 행정심판례 검색",
    priority: 9,
  },

  // ── 11. 조세심판 ──
  {
    name: "tax_tribunal",
    patterns: [
      /조세\s*심판|세금\s*심판/,
    ],
    tool: "search_tax_tribunal_decisions",
    // `심판원?` 만으로는 "조세심판례"에서 고아 `례`가, `결정례?` 는 "결정문"에서 고아 `문`이 남는다(#150)
    extract: searchExtract(/조세\s*심판(?:원|례)?|세금\s*심판|결정(?:례|문)?/g),
    // `조세심판례` 도 `판례` 를 품는다 — 같은 이유로 precedent 보다 앞서고(#129),
    // 법원 판례를 명시한 질의는 admin_appeal 과 같은 가드로 양보한다(#150)
    yieldsTo: ["precedent"],
    reason: "조세심판 키워드 → 조세심판 결정례 검색",
    priority: 9,
  },

  // ── 12. 영문 법령 ──
  {
    name: "english_law",
    patterns: [
      /영문|영어|English/i,
    ],
    tool: "search_english_law",
    extract: searchExtract(/영문|영어|English|법령/gi),
    reason: "영문 키워드 → 영문법령 검색",
    priority: 10,
  },

  // ── 13. 법령용어 ──
  {
    name: "legal_terms",
    patterns: [
      /법률?\s*용어|법령\s*용어|용어\s*정의|용어\s*뜻|뭐야$|뜻이?$/,
    ],
    tool: "search_legal_terms",
    extract: searchExtract(/법률?\s*용어|법령\s*용어|용어\s*정의|용어\s*뜻|뭐야$|뜻이?$/g),
    reason: "용어 키워드 → 법령용어 검색",
    priority: 10,
  },

  // ── 14. 절차/비용/수수료 (처분보다 우선 — 절차 키워드가 있으면 여기로) ──
  {
    name: "procedure",
    patterns: [
      /절차|수수료|과태료|비용|신청\s*방법|어떻게/,
    ],
    tool: "chain_procedure_detail",
    extract: (query) => ({ query }),
    reason: "절차/비용 키워드 → 절차상세 체인",
    priority: 14,
  },

  // ── 15. 처분/허가 근거 ──
  {
    name: "action_basis",
    patterns: [
      /허가|인가|처분|취소\s*사유|거부\s*근거|요건/,
    ],
    tool: "chain_action_basis",
    extract: (query) => {
      // 절차 키워드도 함께 있으면 procedure로 위임
      if (hasProcedureIntent(query)) {
        return { _reroute: "chain_procedure_detail", query }
      }
      return { query }
    },
    reason: "처분/허가 키워드 → 처분근거 체인",
    priority: 15,
  },

  // ── 16. "신고" — 단독이면 action_basis, "신고 방법/절차"면 procedure ──
  {
    name: "report_action",
    patterns: [
      /신고|등록/,
    ],
    tool: "chain_action_basis",
    extract: (query) => {
      if (hasProcedureIntent(query)) {
        return { _reroute: "chain_procedure_detail", query }
      }
      return { query }
    },
    reason: "신고/등록 키워드 → 처분근거 (절차 키워드 동반 시 절차상세)",
    priority: 16,
  },

  // ── 17. 쟁송/분쟁 대비 ──
  {
    name: "dispute",
    patterns: [
      /불복|소송|쟁송|항고|이의\s*신청|감경|취소\s*소송/,
    ],
    tool: "chain_dispute_prep",
    extract: (query) => ({ query }),
    reason: "분쟁/쟁송 키워드 → 쟁송대비 체인",
    priority: 17,
  },

  // ── 18. "방법" 단독 — procedure 폴백 ──
  {
    name: "method_fallback",
    patterns: [
      /방법/,
    ],
    tool: "chain_procedure_detail",
    extract: (query) => ({ query }),
    reason: "방법 키워드 → 절차상세 체인",
    priority: 18,
  },

  // ── 19. 관세 해석례 (일반 해석례보다 구체적 → 더 높은 우선순위) ──
  {
    name: "customs",
    patterns: [
      /관세\s*해석|관세청\s*(해석|질의|회신)|FTA\s*해석/,
    ],
    tool: "search_customs_interpretations",
    extract: searchExtract(/관세\s*해석|관세청\s*(?:해석|질의|회신)|FTA\s*해석/g),
    reason: "관세 해석 키워드 → 관세 해석례 검색",
    priority: 9,
  },

  // ── 19-1. 국세청 법령해석 (#35) ──
  // search_decisions의 nts 도메인으로 라우팅 — 신규 노출 도구 없이 통합 도구 경유
  // priority=3: admin_rule(4, '예규' 키워드 매칭)보다 우선 — 국세청/세목 키워드 동반 시 nts 우선
  {
    name: "nts_interpretation",
    patterns: [
      /국세청\s*(?:법령\s*)?해석|국세청\s*(?:해석|질의|회신|예규)/,
      // "국세청 + 세목" 단독 패턴 (예: "국세청 양도세", "국세청 부가세")
      /국세청\s+(?:양도|소득|법인|부가가치|부가|상속|증여|종합부동산|취득|재산|지방|지방소득|양도소득)세/,
      // 세목 + 해석/예규/질의 (양도세/부가세 같은 약칭 포함). 지방세(취득·재산·지방소득세 등)는 행안부 소관이라 mois 로 (#182)
      /(?<!지방)(?:양도소득|양도|소득|법인|부가가치|부가|상속|증여|종합부동산)세\s*(?:해석|예규|질의|회신)/,
      /예규\s*(?:국세|소득세|법인세|부가세|양도소득세|양도세|상속세|증여세)/,
    ],
    tool: "search_decisions",
    extract: (query) => {
      const cleaned = query
        .replace(/국세청|법령해석|해석례?|질의|회신|예규/g, "")
        .replace(/\s+/g, " ")
        .trim()
      return { domain: "nts", query: cleaned || query }
    },
    reason: "국세청 해석 키워드 → search_decisions(domain=nts) — 국세청 직접 회신 해석례",
    priority: 3,
  },

  // ── 19-1b. 행정안전부 법령해석 — 지방세 유권해석 (#182) ──
  // 국세청 DB 에도 취득세 건이 있지만(103건) 지방세 해석은 행안부 회신(1,036건)이 실무 기준이다.
  // "국세청 취득세"처럼 국세청을 명시하면 위 nts 패턴이 먼저 잡는다
  {
    name: "mois_interpretation",
    patterns: [
      /(?:행정\s*안전부|행안부)\s*(?:법령\s*|유권\s*)?(?:해석|질의|회신)/,
      /(?:취득|재산|지방\S{0,3}|등록면허|주민)세\s*(?:유권\s*)?(?:해석|예규|질의|회신)/,
    ],
    tool: "search_decisions",
    extract: (query) => {
      const cleaned = query
        .replace(/행정\s*안전부|행안부|법령\s*해석|유권\s*해석|해석례?|질의|회신|예규/g, "")
        .replace(/\s+/g, " ")
        .trim()
      return { domain: "mois", query: cleaned || query }
    },
    reason: "행안부·지방세 해석 키워드 → search_decisions(domain=mois) — 행정안전부 유권해석",
    priority: 3,
  },

  // ── 19-2. 고용노동부 법령해석(질의회시) ──
  // 법제처 해석례(interpretation, priority 10)는 법제처 회신이라 고용노동부 질의회시와 다른 DB다.
  // 노동부·질의회시를 명시한 질의만 moel 로 보낸다 (일반 "해석례"는 기존대로 interpretation)
  {
    name: "moel_interpretation",
    patterns: [
      /(?:고용\s*)?노동부\s*(?:행정\s*|법령\s*)?(?:해석|질의|회시|회신)/,
      /질의\s*회시/,
    ],
    tool: "search_decisions",
    extract: (query) => {
      const cleaned = query
        .replace(/고용\s*노동부|노동부|법령\s*해석|행정\s*해석|해석례?|질의\s*회시|질의|회시|회신/g, "")
        .replace(/\s+/g, " ")
        .trim()
      return { domain: "moel", query: cleaned || query }
    },
    reason: "고용노동부 해석 키워드 → search_decisions(domain=moel) — 고용노동부 질의회시",
    priority: 3,
  },

  // ── 19-3. 산재보험·고용보험 재심사 재결 ──
  {
    name: "insurance_review",
    patterns: [
      /산재\s*(?:보험\s*)?재심사|산업재해\s*보상\s*보험\s*재심사/,
      /고용\s*보험\s*(?:재\s*)?심사\s*위원회|고용\s*보험\s*재심사/,
    ],
    tool: "search_decisions",
    extract: (query) => {
      const domain = /고용\s*보험/.test(query) && !/산재|산업재해/.test(query) ? "eiac" : "iaciac"
      const cleaned = query
        .replace(/산업재해\s*보상\s*보험|산재\s*보험|산재|고용\s*보험|재\s*심사|심사|위원회|재결례?|결정(?:례|문)?/g, "")
        .replace(/\s+/g, " ")
        .trim()
      return cleaned ? { domain, query: cleaned } : { domain }
    },
    reason: "산재·고용보험 재심사 키워드 → search_decisions(domain=iaciac|eiac) — 재심사위원회 재결",
    priority: 3,
  },

  // ── 20. 공정위 결정문 ──
  {
    name: "ftc",
    patterns: [
      /공정위|공정거래\s*위원회?|시장지배|불공정\s*거래|담합/,
    ],
    tool: "search_ftc_decisions",
    // `결정문?` 은 "결정례"에서 고아 "례"를 남긴다(#150) — 결정계 strip 은 `결정(?:례|문)?` 로 통일
    extract: searchExtract(/공정거래\s*위원회?|공정위|결정(?:례|문)?/g),
    reason: "공정위 키워드 → 공정위 결정문 검색",
    priority: 10,
  },

  // ── 21. 개인정보위 결정문 ──
  {
    name: "pipc",
    patterns: [
      /개인정보\s*위|개인정보\s*보호\s*위원회?|개인정보\s*침해/,
    ],
    tool: "search_pipc_decisions",
    extract: searchExtract(/개인정보\s*보호\s*위원회?|개인정보\s*위|결정(?:례|문)?/g),
    reason: "개인정보위 키워드 → 개인정보위 결정문 검색",
    priority: 10,
  },

  // ── 22. 노동위 결정문 ──
  {
    name: "nlrc",
    patterns: [
      /노동\s*위원회?|부당\s*해고|부당\s*노동|노동위/,
    ],
    tool: "search_nlrc_decisions",
    extract: searchExtract(/중앙\s*노동\s*위원회?|노동\s*위원회?|노동위|결정(?:례|문)?/g),
    reason: "노동위 키워드 → 노동위 결정문 검색",
    priority: 10,
  },

  // ── 23. 조례 비교 체인 (조례 단독(5)보다 우선) ──
  {
    name: "ordinance_compare",
    patterns: [
      /조례\s*비교|자치법규\s*비교|전국\s*조례/,
    ],
    tool: "chain_ordinance_compare",
    extract: (query) => ({ query }),
    reason: "조례 비교 키워드 → 조례비교 체인",
    priority: 4,
  },

  // ── 24. AI 의미검색 (법령명 모를 때 — explicit_law(3)보다 우선) ──
  {
    name: "ai_search",
    patterns: [
      /생활\s*법령|AI\s*검색/,
    ],
    tool: "search_ai_law",
    extract: searchExtract(/생활\s*법령|AI\s*검색/gi),
    reason: "AI/생활법령 키워드 → AI 의미검색",
    priority: 2,
  },

  // ── 25. 일상용어 → 법률용어 (일반 용어검색(10)보다 구체적 → 우선) ──
  {
    name: "daily_term",
    patterns: [
      /법률?\s*용어로|일상\s*용어|쉬운\s*말|법적\s*표현/,
    ],
    tool: "get_daily_to_legal",
    extract: searchExtract(/법률?\s*용어로?|일상\s*용어|쉬운\s*말|법적\s*표현/g),
    reason: "일상→법률 용어 변환 키워드 → 용어 매핑",
    priority: 9,
  },

  // ── 26. 법령 통계/최근 개정 ──
  {
    name: "statistics",
    patterns: [
      /최근\s*개정|법령\s*통계|개정\s*현황/,
    ],
    tool: "get_law_statistics",
    extract: (query) => {
      // 특정 법령·조문을 지목한 질의("최근 개정된 근로기준법 제60조")는 전국 통계가 아니라
      // 그 법령의 개정 이력 의도다 — 여기서 받으면 query 를 버리므로 법령명·조문이 통째로
      // 사라진다(#150). _skip 으로 다음 순위(amendment 10)에 넘긴다
      if (hasLawNameSignal(query)) return { _skip: true }
      const daysMatch = query.match(/(\d+)\s*일/)
      return { days: daysMatch ? parseInt(daysMatch[1], 10) : 30, count: 20 }
    },
    reason: "통계/최근개정 키워드 → 법령 통계",
    priority: 9,
  },

  // ── 27. 법령 목차/체계 조회 ──
  {
    name: "law_tree",
    patterns: [
      /목차|편장절|체계도/,
    ],
    tool: "get_law_tree",
    extract: (query) => {
      const lawName = lawNameFromQuery(query)
      if (!lawName) {
        return { _fallback: true, query }
      }
      return { _searchQuery: lawName, _needsMst: true }
    },
    reason: "목차 키워드 → 법령 체계 조회",
    priority: 10,
  },

  // ── 28. 통합검색 (명시적) ──
  {
    name: "search_all_explicit",
    patterns: [
      /통합\s*검색/,
    ],
    tool: "search_all",
    extract: searchExtract(/통합\s*검색/g),
    reason: "통합검색 키워드 → 통합검색",
    priority: 10,
  },

  // ── 29. 지역명 시작 + 키워드 (조례 추정) ──
  {
    name: "region_ordinance",
    patterns: [
      /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)\S*\s+.+/,
    ],
    tool: "search_ordinance",
    extract: (query) => ({ query }),
    reason: "지역명 시작 → 자치법규 검색",
    priority: 20,
  },

  // ── 29-0. 조문 영향 그래프 (impact_map, v4.0) ──
  // "민법 103조 영향", "민법 제103조 파급효과", "이 조문 인용한 판례 전부"
  {
    name: "impact_map",
    // 접두 `(.+?)` 제거 — extract 가 법령명을 ^ 앵커 정규식으로 따로 뽑으므로 캡처가 필요 없다(#121)
    patterns: [
      /제?\s*\d{1,4}\s*조(?:\s*의\s*\d{1,3})?\s*(?:파급|영향\s*그래프|impact|인용한\s*(?:모든|판례|판결))/i,
      /제?\s*\d{1,4}\s*조(?:\s*의\s*\d{1,3})?\s*인용\s*(?:판례|모두|전부|어디)/,
      /조문\s*(?:파급|임팩트|영향\s*그래프)/,
    ],
    tool: "impact_map",
    extract: (query) => {
      const jo = extractArticleNumber(query) || ""
      const lawNameMatch = query.match(/^(.+?)\s*제?\d+조/)
      const lawName = lawNameMatch ? lawNameMatch[1].trim() : ""
      if (!lawName || !jo) return { _fallback: true, query }
      return { lawName, jo }
    },
    reason: "조문 영향 그래프 키워드 → impact_map (역방향 인용 그래프 + mermaid)",
    priority: 2,
  },

  // ── 29-0-3. 판례 생사 확인 (cite_check, v4.3) ──
  // "2013다61381 아직 유효해?", "이 판례 변경됐어?", "2018두42559 인용 추적"
  {
    name: "cite_check",
    patterns: [
      new RegExp(`${CASE_NO_SRC}[\\s\\S]{0,40}?(?:${CITE_CHECK_KEYWORDS})`, "i"),
      // "이 판례 아직 유효해? 2013다61381" — 키워드가 앞에 오는 어순도 같은 질의다(#122)
      new RegExp(`(?:${CITE_CHECK_KEYWORDS})[\\s\\S]{0,40}?${CASE_NO_SRC}`, "i"),
      /판례\s*(?:생사|유효성|변경\s*여부|폐기\s*여부|인용\s*추적)/,
      /(?:변경|폐기)된?\s*판례(?:인지|냐|인가요?|\s*확인)/,
    ],
    tool: "cite_check",
    extract: (query) => {
      // 탐지와 같은 원본으로 다시 뽑는다 — 여기가 세 번째 사본이던 자리다
      const m = query.match(CASE_NO_RE)
      if (!m) return { _fallback: true, query }
      return { caseNumber: m[0].replace(/\s+/g, "") }
    },
    reason: "사건번호 + 유효성 키워드 → cite_check (후속 인용 역추적 + 변경·폐기 감지)",
    priority: 2,
  },

  // ── 29-0-4. 행위시법 판단 (applicable_law, v4.3) ──
  // "2023년 5월 당시 도로교통법 제44조", "사건 시점에 적용되는 법", "행위시법"
  {
    name: "applicable_law",
    patterns: [
      /(\d{4})\s*[년\.\-\/]\s*(\d{1,2})\s*[월\.\-\/]?\s*(\d{1,2})?\s*일?\s*(?:당시|시점|기준|무렵|에\s*적용)/,
      /(?:행위\s*시|사건\s*당시|계약\s*당시|위반\s*당시)\s*(?:의\s*)?(?:법|적용)/,
      /행위시법|적용\s*법령\s*판단|당시\s*시행/,
    ],
    tool: "applicable_law",
    extract: (query) => {
      const dm = query.match(/(\d{4})\s*[년\.\-\/]\s*(\d{1,2})(?:\s*[월\.\-\/]\s*(\d{1,2}))?/)
      if (!dm) return { _fallback: true, query }
      const date = `${dm[1]}${dm[2].padStart(2, "0")}${(dm[3] || "1").padStart(2, "0")}`
      const jo = extractArticleNumber(query)
      // 키워드 strip은 단어 경계 필수 — "근로기준법"의 "기준"을 떼면 법령명 파괴
      const lawName = lawNameFromQuery(
        query.replace(/(\d{4})\s*[년\.\-\/]\s*\d{1,2}\s*[월\.\-\/]?\s*\d{0,2}\s*일?/g, " ")
          // 탐지 정규식(위)에 어휘를 넣으면 여기에도 넣어야 한다 —
          // 빠지면 "무렵에 시행되던 도로교통법"이 통째로 법령명이 된다
          .replace(/(?:^|\s)(당시|시점|기준일?|무렵에?|행위시법|사건|적용|시행되?던?)(?=\s|$)/g, " ")
          .replace(/에\s*적용되?는?\s*법령?/g, " ")
      )
      if (!lawName) return { _fallback: true, query }
      const params: Record<string, unknown> = { lawName, date }
      if (jo) params.jo = jo
      return params
    },
    reason: "기준일 + 법령명 → applicable_law (시점 적용 버전 + 부칙 경과규정)",
    priority: 2,
  },

  // ── 29-1. 인용 검증 (citation validator) ──
  {
    name: "verify_citations",
    patterns: [
      /인용\s*(?:검증|확인|체크)/,
      /(?:인용|조문|조항)\s*(?:검증|실존)/,
      /(?:환각|hallucination)\s*(?:검증|체크)/i,
      /이\s*(?:텍스트|글|답변)에.*조문.*(?:맞|실제)/,
      // 인용(조문번호·사건번호) + 검증 요구가 한 문장에 같이 있는 형태.
      // "민법 제103조 인용 검증해줘" 류가 조문 조회로 흡수되던 문제의 수신처(#99)
      /(?:제\s*\d+\s*조|\d{2,4}\s*(?!년|월|일)[가-힣]{1,3}\s*\d{2,7})[\s\S]{0,80}?(?:검증|맞는지|맞나|사실인지|실존)/,
      /(?:검증|맞는지|맞나|사실인지|실존)[\s\S]{0,120}?(?:제\s*\d+\s*조|\d{2,4}\s*(?!년|월|일)[가-힣]{1,3}\s*\d{2,7})/,
    ],
    tool: "verify_citations",
    extract: (query) => ({ text: query }),
    reason: "인용검증 키워드 → 조문 실존/내용 검증",
    priority: 2,
  },

  // ── 29-2. 법령 비교 ──
  {
    name: "law_comparison",
    // extract 가 캡처를 쓰지 않으므로 `(.+?)` 접두를 두지 않는다 — $ 없이도 시작 위치마다
    // 지연 확장이 반복돼 입력 길이의 제곱으로 커진다(#121). ^ 앵커 + lookahead 로 1회 주사.
    patterns: [
      /^(?=[^]*[가-힣A-Za-z](?:와|과)\s)(?=[^]*(?:차이|비교|다른\s*점))/,
      /\bvs\.?\b/i,
    ],
    tool: "chain_law_system",
    extract: (query) => ({ query }),
    reason: "법령 비교 키워드 → 법체계 체인 (두 법령 모두 구조 확인)",
    priority: 8,
  },

  // ── 29-2-1. 시점 1개만 주어진 질의 (single_time_point, #122) ──
  // "민법 2024" — 그 시점 본문을 원하는지(applicable_law) 그 이후 개정 이력을 원하는지
  // 문장만으로는 갈린다. 더 보수적인 개정추적으로 보내되 확인 문구를 함께 돌려준다.
  {
    name: "single_time_point",
    patterns: [
      /^\s*[가-힣]+(?:법|령|규칙|규정|조례|법률)\s+(20\d{2})\s*년?\s*$/,
    ],
    tool: "chain_amendment_track",
    extract: (query, match) => {
      const year = match?.[1]
      const lawName = lawNameFromQuery(query.replace(/20\d{2}\s*년?/, " "))
      // fromDate 는 넘기지 않는다 — chain_amendment_track 은 시나리오가 붙을 때만 읽으므로
      // 여기서 넘겨봐야 조용히 버려진다(#120 과 같은 무음 폐기)
      return {
        query: lawName || query,
        _clarify: year
          ? `"${lawName} ${year}" 를 개정 이력 조회로 해석했습니다. ` +
            `${year}년 당시 시행되던 본문이 필요하면 "${year}.1.1 당시 ${lawName}" 처럼 날짜를 적어 주세요.`
          : undefined,
      }
    },
    reason: "법령명 + 시점 1개 → 개정추적 (해석 확인 요청 동반)",
    priority: 11,
  },

  // ── 29-3. 시간 필터 (최근 N년 개정) ──
  // 날짜 파서가 트리거 토큰을 지우기 전(원문)에 매칭된다 — query-router 가 원문으로 매칭(#100)
  {
    name: "time_filter_amendment",
    patterns: [
      /최근\s*\d+\s*(?:년|개월)\s*(?:이?내|동안)\s*개정/,
      /(?:20\d{2})\s*년\s*이후\s*개정/,
    ],
    tool: "chain_amendment_track",
    extract: (query) => ({ query: lawNameFromQuery(query) || query }),
    reason: "시간 필터 + 개정 키워드 → 개정추적 체인",
    priority: 9,
  },

  // ── 29-4. 손해배상·불법행위 (민사 일반) ──
  {
    name: "civil_liability",
    patterns: [
      /손해\s*배상|불법\s*행위|위자료|과실\s*비율/,
    ],
    tool: "chain_full_research",
    extract: (query) => ({ query }),
    reason: "민사 책임 키워드 → 종합 리서치 (민법+판례+해석례)",
    priority: 12,
  },

  // ── 29-5. 계약서/약관 검토 (기존 chain_document_review 라우팅 강화) ──
  {
    name: "contract_review",
    patterns: [
      /(?:계약서|약관|협정서|합의서).*(?:검토|리스크|독소|위험|체크)/,
      /(?:독소\s*조항|불공정\s*조항)/,
    ],
    tool: "chain_document_review",
    extract: (query) => ({ text: query }),
    reason: "계약서/약관 검토 키워드 → 문서 리스크 검토 체인",
    priority: 6,
  },

  // ── 30. 명시적 법령명 (법, 령, 규칙으로 끝나는) ──
  // "등록면허세법" 같이 법명 자체에 다른 패턴 키워드가 포함된 경우
  // 법명 패턴이 우선해야 하므로 priority를 신고/등록(16)보다 높게 설정.
  // "방법" 같은 일반 단어를 걸러내기 위해 블랙리스트로 필터링.
  // 의도 키워드(목차, 최근, 통합검색 등)가 동반되면 _skip하여 다음 패턴에 위임.
  {
    name: "explicit_law",
    patterns: [
      // "XX법", "XX시행령", "XX규칙" 등 법령명으로 끝나는 경우
      /(?<![가-힣])[가-힣]+(?:법|시행령|시행규칙|규칙|규정|령)\s*$/,
    ],
    tool: "search_law",
    extract: (query) => {
      const q = query.trim()
      // "방법", "변경법" 등 법령명이 아닌 일반 단어는 블랙리스트(NON_LAW_WORD_RE 공용)로 거른다
      if (NON_LAW_WORD_RE.test(q)) {
        // 단독 비법령어 → 다음 패턴으로 (없으면 chain_full_research 폴백)
        return { _skip: true }
      }
      const lastWord = q.split(/\s+/).pop() || ""
      if (NON_LAW_WORD_RE.test(lastWord)) {
        return { _skip: true }
      }
      return { query: q }
    },
    // 의도 키워드가 동반되면 양보한다. 여기에도 어휘를 베껴 적었더니 #122 가
    // amendment 에 "바뀐/달라진"을 추가했을 때 이 사본만 낡아 "바뀐 도로교통법"이 선점됐다.
    // 이제 수신 패턴의 정규식을 그대로 평가한다(#123)
    yieldsTo: [
      "law_tree", "search_all_explicit", "amendment",
      "statistics", "ordinance_compare", "english_law",
    ],
    reason: "법령명 패턴 → 법령 검색",
    priority: 3,
  },
]

// ────────────────────────────────────────
// 시나리오 패턴 — scenario-rules.ts 에서 파생 (#101)
// ────────────────────────────────────────

const SCENARIO_EXTRACTS: Record<string, (query: string) => Record<string, unknown>> = {
  time_travel: extractTimeTravel,
}

/** 시나리오 규칙에서 라우팅 패턴을 파생 — 어휘·우선순위 원본은 scenario-rules.ts 하나뿐이다 */
const scenarioPatterns: Pattern[] = ROUTABLE_SCENARIO_RULES.map((rule) => ({
  name: `scenario_${rule.scenario}`,
  patterns: rule.routeTriggers as RegExp[],
  tool: rule.hostChain,
  extract: SCENARIO_EXTRACTS[rule.scenario] ?? ((query: string) => ({ query })),
  reason: `${rule.scenario} 신호 → ${rule.hostChain} (${rule.scenario} 시나리오)`,
  priority: rule.precedence,
}))

/**
 * 우선순위 정렬된 전체 패턴 (모듈 로드 시 1회).
 * 동순위는 배열 순서로 갈린다. 시나리오 패턴을 앞에 둬 pri 9(delegation·impact)의
 * 분리 전 순서를 지켰다. 단 pri 3 은 순서가 뒤집혔다 —
 * 분리 전 `nts_interpretation` → `time_travel` 이었으나 지금은 `time_travel` 이 먼저다.
 * 영향 범위: 두 시점 표기와 국세청 세목이 한 쿼리에 같이 오는 경우
 * ("국세청 양도세 2024 vs 2026")가 이제 개정추적으로 간다.
 */
export const sortedRoutePatterns: Pattern[] =
  [...scenarioPatterns, ...routePatterns].sort((a, b) => a.priority - b.priority)

// ────────────────────────────────────────
// yieldsTo 해석 (#123)
// ────────────────────────────────────────

/**
 * 이름 → 그 이름을 가진 패턴 전부.
 * 시나리오 파생 패턴은 이름이 겹칠 수 있어(action_plan 은 두 단계로 선언된다) 배열로 담는다 —
 * Map<string, Pattern> 이면 뒤엣것이 앞엣것을 덮어써 가드가 엉뚱한 정규식을 보게 된다.
 */
const patternsByName = new Map<string, Pattern[]>()
for (const p of [...routePatterns, ...scenarioPatterns]) {
  const list = patternsByName.get(p.name)
  if (list) list.push(p)
  else patternsByName.set(p.name, [p])
}

// 오타·개명은 가드를 통째로 무력화한다(선점이 조용히 부활). 로드 시점에 터뜨린다.
for (const p of routePatterns) {
  for (const target of p.yieldsTo ?? []) {
    if (!patternsByName.has(target)) {
      throw new Error(`route-patterns: "${p.name}".yieldsTo 가 없는 패턴 "${target}" 을 가리킨다`)
    }
  }
}

/**
 * 지목한 수신 패턴이 이 쿼리를 **실제로 받아 가는가**.
 *
 * 수신 패턴의 정규식을 그대로 평가하므로 가드 어휘가 따로 낡지 않는다(#123).
 * 다만 정규식이 맞는 것만으로는 부족하다 — extract 가 `_fallback`/`_skip` 을 내면
 * 그 패턴도 이 질의를 처리하지 않으므로, 양보해 봐야 종합리서치로 굴러떨어져
 * 조문 조회 의도까지 함께 잃는다("민법 제38조 당시 시행"). 받아 갈 때만 양보한다.
 */
export function yieldsToOther(pattern: Pattern, query: string): boolean {
  for (const name of pattern.yieldsTo ?? []) {
    for (const receiver of patternsByName.get(name)!) {
      for (const re of receiver.patterns) {
        const m = query.match(re)
        if (!m) continue
        const params = receiver.extract(query, m)
        if (!params._fallback && !params._skip) return true
      }
    }
  }
  return false
}
