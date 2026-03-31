/**
 * Smart Query Router
 * 자연어 질의를 분석하여 최적의 도구/체인으로 라우팅
 *
 * 패턴 매칭 기반으로 의도를 파악하고, 필요한 파라미터를 자동 추출
 */

import { SEARCH_DETAIL_CHAINS } from "./tool-chain-config.js"
import { parseDateRange, type DateRange } from "./date-parser.js"

export interface RouteResult {
  /** 실행할 도구 이름 */
  tool: string
  /** 도구에 전달할 파라미터 */
  params: Record<string, unknown>
  /** 라우팅 근거 설명 */
  reason: string
  /** 후속 실행이 필요한 도구 (파이프라인) */
  pipeline?: Array<{ tool: string; params: Record<string, unknown> }>
  /** 자동 체인 여부 (search → detail 자동 연결) */
  autoChain?: boolean
  /** 자연어에서 추출된 날짜 범위 (검색 도구에 자동 적용) */
  dateRange?: DateRange
}

interface Pattern {
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
}

// ────────────────────────────────────────
// 조문 번호 추출 헬퍼
// ────────────────────────────────────────

function extractArticleNumber(query: string): string | undefined {
  const match = query.match(/제(\d+)조(?:의(\d+))?/)
  if (!match) return undefined
  return match[0] // "제38조" or "제10조의2"
}

/**
 * 쿼리에서 순수 법령명만 추출.
 *
 * 주의: replace 순서에 의존하지 않도록 한 번에 처리.
 * "등록면허세법"처럼 법령명 자체에 키워드가 포함된 경우 파괴하지 않기 위해
 * 단어 경계(\b에 해당하는 한글 패턴)를 고려하여 제거.
 */
function extractLawName(query: string): string {
  return query
    // 조문번호 (확정적 구문이라 먼저 제거)
    .replace(/제\d+조(?:의\d+)?/g, "")
    // 수식어: 단독 키워드만 제거 (법령명 일부인 경우 보존)
    // "별표 1", "별표" 등 독립적 사용만 제거
    .replace(/별표\s*\d*/g, "")
    .replace(/(?:^|\s)(판례|판결|사례|대법원|헌재|행정심판)(?:\s|$)/g, " ")
    .replace(/(?:^|\s)(해석례?|유권해석|질의회신)(?:\s|$)/g, " ")
    .replace(/(?:^|\s)(개정|이력|변경|연혁|신구대조)(?:\s|$)/g, " ")
    .replace(/(?:^|\s)(3단비교|위임|인용|체계)(?:\s|$)/g, " ")
    .replace(/(?:^|\s)(영문|영어|English)(?:\s|$)/gi, " ")
    .replace(/(?:^|\s)(서식|양식|별지|신청서)(?:\s|$)/g, " ")
    // 조례/규칙은 법령명 일부이므로 유지
    // 동사형 수식어 제거
    .replace(/(?:^|\s)(검색|조회|확인|알려줘|찾아줘|보여줘)(?:\s|$)/g, " ")
    // 정리
    .replace(/\s+/g, " ")
    .trim()
}

// ────────────────────────────────────────
// 복합 의도 감지 (다중 키워드 충돌 해결)
// ────────────────────────────────────────

/**
 * 절차/비용 의도가 처분/허가 의도보다 강한지 판단.
 * "신고 방법", "허가 절차 수수료" 같은 복합 쿼리에서
 * 절차 키워드가 있으면 procedure를 우선.
 */
function hasProcedureIntent(query: string): boolean {
  return /절차|방법|수수료|과태료|비용|신청\s*방법|어떻게/.test(query)
}

// ────────────────────────────────────────
// 패턴 정의
// ────────────────────────────────────────

const routePatterns: Pattern[] = [
  // ── 1. 특정 조문 조회 (최고 우선) ──
  {
    name: "specific_article",
    patterns: [
      /(.+?)\s*제(\d+)조(?:의(\d+))?\s*$/,
      /제(\d+)조(?:의(\d+))?\s*(.+)/,
    ],
    tool: "get_law_text",
    extract: (query) => {
      const jo = extractArticleNumber(query)
      const lawName = extractLawName(query)
      return { _searchQuery: lawName, jo, _needsMst: true }
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
      /[가-힣]+(시|군|구)\s+[가-힣]+\s*(조례|규칙)/,
    ],
    tool: "search_ordinance",
    extract: (query) => ({ query }),
    reason: "조례/자치법규 키워드 → 자치법규 검색",
    priority: 5,
  },

  // ── 4. 개정 이력/신구대조 ──
  {
    name: "amendment",
    patterns: [
      /개정|신구대조|변경\s*이력|연혁/,
    ],
    tool: "chain_amendment_track",
    extract: (query) => {
      const lawName = extractLawName(query)
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
    extract: (query) => ({ query: extractLawName(query) || query }),
    reason: "법체계/3단비교 키워드 → 법체계 체인",
    priority: 10,
  },

  // ── 6. 별표/서식 조회 ──
  {
    name: "annex",
    patterns: [
      // "XX법 별표", "XX령 서식" 등 법령명이 함께 있는 경우만 매칭
      /[가-힣]+(법|령|규칙|규정)\s*(별표|서식|양식|별지)/,
      // "별표" 단독은 매칭하되 법령명 추출이 비어있으면 chain_full_research로 폴백
    ],
    tool: "get_annexes",
    extract: (query) => {
      const lawName = extractLawName(query)
      if (!lawName) {
        // 법령명 없이 "별표"만 → 종합 리서치로 폴백
        return { _fallback: true, query }
      }
      return { lawName }
    },
    reason: "별표/서식 키워드 → 별표 조회",
    priority: 10,
  },

  // ── 7. 판례 검색 ──
  {
    name: "precedent",
    patterns: [
      /판례|판결|대법원\s*판/,
    ],
    tool: "search_precedents",
    extract: (query) => ({
      query: query.replace(/판례|판결|대법원/g, "").replace(/\s+/g, " ").trim(),
    }),
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
    extract: (query) => ({
      query: query.replace(/해석례?|유권해석|질의회신/g, "").replace(/\s+/g, " ").trim(),
    }),
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
    extract: (query) => ({
      query: query.replace(/헌재|헌법재판소?|결정례?/g, "").replace(/\s+/g, " ").trim(),
    }),
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
    extract: (query) => ({
      query: query.replace(/행정심판례?|행심/g, "").replace(/\s+/g, " ").trim(),
    }),
    reason: "행정심판 키워드 → 행정심판례 검색",
    priority: 10,
  },

  // ── 11. 조세심판 ──
  {
    name: "tax_tribunal",
    patterns: [
      /조세\s*심판|세금\s*심판/,
    ],
    tool: "search_tax_tribunal_decisions",
    extract: (query) => ({
      query: query.replace(/조세심판원?|세금심판|결정례?/g, "").replace(/\s+/g, " ").trim(),
    }),
    reason: "조세심판 키워드 → 조세심판 결정례 검색",
    priority: 10,
  },

  // ── 12. 영문 법령 ──
  {
    name: "english_law",
    patterns: [
      /영문|영어|English/i,
    ],
    tool: "search_english_law",
    extract: (query) => ({
      query: query.replace(/영문|영어|English|법령/gi, "").replace(/\s+/g, " ").trim(),
    }),
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
    extract: (query) => ({
      query: query.replace(/법률?용어|법령용어|용어정의|뜻이?|뭐야|의$/g, "").replace(/\s+/g, " ").trim(),
    }),
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
    extract: (query) => ({
      query: query.replace(/관세청?|해석례?|질의|회신/g, "").replace(/\s+/g, " ").trim(),
    }),
    reason: "관세 해석 키워드 → 관세 해석례 검색",
    priority: 9,
  },

  // ── 20. 공정위 결정문 ──
  {
    name: "ftc",
    patterns: [
      /공정위|공정거래\s*위원회?|시장지배|불공정\s*거래|담합/,
    ],
    tool: "search_ftc_decisions",
    extract: (query) => ({
      query: query.replace(/공정거래위원회?|공정위|결정문?/g, "").replace(/\s+/g, " ").trim(),
    }),
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
    extract: (query) => ({
      query: query.replace(/개인정보보호위원회?|개인정보위|결정문?/g, "").replace(/\s+/g, " ").trim(),
    }),
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
    extract: (query) => ({
      query: query.replace(/중앙노동위원회?|노동위|결정문?/g, "").replace(/\s+/g, " ").trim(),
    }),
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
    extract: (query) => ({
      query: query.replace(/생활법령|AI검색/g, "").replace(/\s+/g, " ").trim() || query,
    }),
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
    extract: (query) => ({
      query: query.replace(/법률?용어로?|일상용어|쉬운말|법적표현/g, "").replace(/\s+/g, " ").trim(),
    }),
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
      const lawName = extractLawName(query)
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
    extract: (query) => ({
      query: query.replace(/통합검색/g, "").replace(/\s+/g, " ").trim(),
    }),
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

  // ── 30. 명시적 법령명 (법, 령, 규칙으로 끝나는) ──
  // "등록면허세법" 같이 법명 자체에 다른 패턴 키워드가 포함된 경우
  // 법명 패턴이 우선해야 하므로 priority를 신고/등록(16)보다 높게 설정.
  // "방법" 같은 일반 단어를 걸러내기 위해 블랙리스트로 필터링.
  // 의도 키워드(목차, 최근, 통합검색 등)가 동반되면 _skip하여 다음 패턴에 위임.
  {
    name: "explicit_law",
    patterns: [
      // "XX법", "XX시행령", "XX규칙" 등 법령명으로 끝나는 경우
      /[가-힣]+(법|시행령|시행규칙|규칙|규정|령)\s*$/,
    ],
    tool: "search_law",
    extract: (query) => {
      const q = query.trim()
      // "방법", "변경법" 등 법령명이 아닌 일반 단어 블랙리스트
      const nonLawSuffixes = /^(방법|변경법|입법|사법|문법|용법|어법|수법|기법|활법|진법|심법|산법)$/
      if (nonLawSuffixes.test(q)) {
        // 단독 비법령어 → 다음 패턴으로 (없으면 chain_full_research 폴백)
        return { _skip: true }
      }
      const lastWord = q.split(/\s+/).pop() || ""
      if (nonLawSuffixes.test(lastWord)) {
        return { _skip: true }
      }
      // 의도 키워드가 동반되면 이 패턴은 양보 → 더 구체적인 패턴이 처리
      if (/목차|편장절|체계도|통합\s*검색|최근\s*개정|개정\s*현황|법령\s*통계|조례\s*비교|영문|영어|English/i.test(q)) {
        return { _skip: true }
      }
      return { query: q }
    },
    reason: "법령명 패턴 → 법령 검색",
    priority: 3,
  },
]

// 모듈 로드 시 한 번만 정렬
const sortedPatterns = [...routePatterns].sort((a, b) => a.priority - b.priority)

// ────────────────────────────────────────
// 라우터 본체
// ────────────────────────────────────────

/**
 * 자연어 질의를 분석하여 최적의 도구로 라우팅
 */
export function routeQuery(query: string): RouteResult {
  const q = query.trim()

  // 빈 쿼리
  if (!q) {
    return {
      tool: "search_all",
      params: { query: "" },
      reason: "빈 쿼리 → 통합검색",
    }
  }

  // 자연어 날짜 조건 추출 (검색어에서 시간 표현 분리)
  const dateParsed = parseDateRange(q)
  const dateRange = dateParsed.range

  // 날짜 표현이 제거된 순수 검색어로 패턴 매칭
  const routeInput = dateParsed.cleanQuery || q
  const result = _matchRoute(routeInput)

  // 날짜 범위가 있으면 결과에 첨부
  if (dateRange) {
    result.dateRange = dateRange
  }
  return result
}

/** 패턴 매칭 내부 함수 (routeQuery에서만 호출) */
function _matchRoute(q: string): RouteResult {
  for (const pattern of sortedPatterns) {
    for (const regex of pattern.patterns) {
      const match = q.match(regex)
      if (match) {
        const params = pattern.extract(q, match)

        // _skip 플래그: 이 패턴은 매칭되었으나 의도가 다름 → 다음 패턴으로 진행
        // break로 inner loop(regex 목록) 전체를 빠져나가야 outer loop(패턴 목록)이 다음으로 진행
        if (params._skip) {
          break
        }

        // _fallback 플래그: 법령명 없이 키워드만 → 종합 리서치
        if (params._fallback) {
          delete params._fallback
          return {
            tool: "chain_full_research",
            params: { query: q },
            reason: `${pattern.reason} (법령명 미지정 → 종합 리서치로 전환)`,
          }
        }

        // _reroute 플래그: 복합 의도에서 더 적합한 도구로 재라우팅
        if (params._reroute) {
          const rerouteTool = params._reroute as string
          delete params._reroute
          return {
            tool: rerouteTool,
            params,
            reason: `${pattern.reason} → ${rerouteTool}로 재라우팅`,
          }
        }

        // _needsMst 플래그: 법령 검색이 먼저 필요한 경우 파이프라인 구성
        if (params._needsMst) {
          const searchQuery = (params._searchQuery as string) || q
          delete params._needsMst
          delete params._searchQuery

          // 내부 플래그 제거 후 남은 파라미터를 파이프라인에 전달
          const pipeParams = { ...params }

          return {
            tool: "search_law",
            params: { query: searchQuery },
            reason: `${pattern.reason} (법령 검색 → 조문 조회 자동 연결)`,
            pipeline: [
              {
                tool: pattern.tool,
                params: pipeParams,
              },
            ],
          }
        }

        // 검색 도구에 상세조회 체인이 설정되어 있으면 자동 파이프라인 추가
        const chain = SEARCH_DETAIL_CHAINS[pattern.tool]
        if (chain) {
          return {
            tool: pattern.tool,
            params,
            reason: pattern.reason,
            pipeline: [{ tool: chain.detailTool, params: {} }],
            autoChain: true,
          }
        }

        return {
          tool: pattern.tool,
          params,
          reason: pattern.reason,
        }
      }
    }
  }

  // 기본 폴백: 종합 리서치 체인
  return {
    tool: "chain_full_research",
    params: { query: q },
    reason: "패턴 미매칭 → 종합 리서치 (AI검색+법령+판례+해석례 병렬)",
  }
}

/**
 * 쿼리 의도 분석 결과 (디버깅/로깅용)
 */
export function explainRoute(query: string): string {
  const result = routeQuery(query)
  let explanation = `질의: "${query}"\n`
  explanation += `도구: ${result.tool}\n`
  explanation += `근거: ${result.reason}\n`
  explanation += `파라미터: ${JSON.stringify(result.params, null, 2)}\n`

  if (result.dateRange) {
    explanation += `날짜범위: ${result.dateRange.from} ~ ${result.dateRange.to}\n`
  }

  if (result.pipeline) {
    explanation += `파이프라인:\n`
    for (const step of result.pipeline) {
      explanation += `  → ${step.tool}(${JSON.stringify(step.params)})\n`
    }
  }

  return explanation
}
