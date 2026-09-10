/**
 * 도구 노출 정책 + 카테고리/별칭 — discover_tools 자연어 매칭용.
 *
 * "어떤 도구를 직접 노출하는가"(V3_EXPOSED)와 "어떤 의도가 어떤 도구로 가는가"를
 * 한 곳에 둔다. 갈라 놓으면 카테고리는 1-hop 진입점을 앞세우는데 안내 문구는
 * 2-hop 을 말하는 어긋남이 생긴다.
 *
 * (lite/full 프로필은 v3.5.1에서 제거됨: V3_EXPOSED 도입 후 실질 미사용.)
 */

/**
 * ListTools 로 직접 노출하는 도구 — 나머지는 execute_tool 경유(2-hop).
 *
 * tool-registry 가 노출 필터로 쓰고, discover_tools 가 말미 안내를 가르는 데 쓴다.
 * 두 곳이 각자 목록을 들면 "1-hop 도구를 돌려주면서 execute_tool 로 실행하라"고
 * 안내하는 어긋남이 생긴다 — 그래서 여기 한 곳에 둔다.
 *
 * ⚠️ get_annexes 제거 금지: 헬스장 환불 케이스(trace ld-1775959823220, 79s)에서
 *    별표 3의2를 가져오려 discover_tools × 2 + execute_tool 헛발질로 ~15초 손실.
 */
export const V3_EXPOSED = new Set([
  "legal_research",   // v4.4.0: chain_* 8개 통합 (task 파라미터)
  "legal_analysis",   // v4.4.0: verify_citations/cite_check/applicable_law/impact_map 통합 (mode 파라미터)
  "search_law", "get_law_text",
  "get_annexes",
  "search_decisions", "get_decision_text",
  "ordinance_radar",  // v4.7.0: 조례 정비 레이더 (조례 담당 공무원 킬러기능)
  "discover_tools", "execute_tool",
])

/**
 * discover_tools 말미 안내 — 돌려준 도구가 무엇인지에 따라 갈린다.
 *
 * 결과와 무관하게 "execute_tool로 실행하세요"만 말하면, 1-hop 진입점을 앞세운
 * 카테고리 구성과 안내가 서로 어긋나 노출 도구에까지 굳이 2-hop 을 태운다.
 */
export function describeCallPath(listed: Set<string>): string {
  const exposed = [...listed].filter(name => V3_EXPOSED.has(name))
  if (exposed.length === 0) return "execute_tool로 실행하세요."
  const direct = `${exposed.join(", ")}는 그대로 호출하세요.`
  return exposed.length === listed.size ? direct : `${direct} 나머지는 execute_tool 경유입니다.`
}

/**
 * 카테고리/도구명 별칭 — discover_tools가 사용자 자연어 입력을 매칭하기 위한 힌트.
 * 한국어 법률 실무에서 흔히 쓰이는 비공식 용어와 도구를 연결.
 *
 * 예시: "조세심판원" → search_tax_tribunal_decisions
 *       "김영란법" → search_law (약칭은 search-normalizer가 처리)
 *       "하자" → search_precedents (민사 분쟁 키워드)
 *
 * ⚠️ 키는 반드시 TOOL_CATEGORIES에 실재하는 카테고리명이어야 한다.
 *    resolveAliasToCategory가 이 키로 TOOL_CATEGORIES를 조회하므로, 없는 키는
 *    "별칭은 해석되는데 결과는 0건"인 무음 실패가 된다 (#102).
 *    src/tools/meta-tools.test.ts의 정합 테스트가 이 불변식을 지킨다.
 */
export const TOOL_ALIASES: Record<string, string[]> = {
  // 카테고리명 별칭
  "조세심판": ["조세심판원", "세금심판", "세금 이의", "조세불복", "조세심판례"],
  "관세": ["관세청", "통관", "FTA", "원산지", "관세해석", "수출입"],
  "헌재": ["헌법재판소", "위헌법률심판", "헌법소원", "헌재결정"],
  "행정심판": ["행심", "행정심판례", "행심판례", "취소재결"],
  "공정위": ["공정거래위원회", "공정거래", "독점규제", "담합", "공정거래법"],
  "개인정보위": ["개인정보보호위원회", "개인정보보호", "개인정보침해", "PIPC"],
  "노동위": ["중앙노동위원회", "지방노동위원회", "부당해고", "부당노동행위", "NLRC"],
  "권익위": ["국민권익위원회", "반부패", "청탁금지법", "ACR"],
  "소청심사": ["소청심사위원회", "공무원 징계 불복", "파면 불복", "해임 불복"],
  "학칙": ["대학 학칙", "고등학교 학칙", "교칙", "학사규정"],
  "공사공단": ["지방공사", "지방공단", "지방공기업"],
  "공공기관": ["공공기관 규정", "공기업 규정", "공공기관 내규"],
  "조약": ["국제조약", "양자조약", "다자조약", "협정", "treaty"],
  "영문법령": ["영문 법률", "영어 법령", "English law", "영문 조문"],
  "자치법규": ["조례", "규칙", "지자체 법규", "시 조례", "구 조례", "도 조례"],
  "별표서식": ["별표", "서식", "별지", "양식", "신청서"],
  "용어": ["법률용어", "법령용어", "용어 정의", "법적 용어", "법률 사전"],
  "판례": ["대법원", "판결문", "판례검색", "대법원 판례"],
  "해석례": ["법제처 해석", "유권해석", "질의회신"],
  // 도구 의도 별칭
  "인용검증": ["verify_citations", "조문 실존 확인", "환각 검증"],
  "판례생사": ["cite_check", "판례 유효성", "판례 변경 여부", "인용 추적", "citator"],
  "행위시법": ["applicable_law", "당시 법령", "적용 법령 판단", "경과조치", "부칙"],
  "영향그래프": ["impact_map", "조문 영향", "파급효과", "인용한 판례"],
  "문서분석": ["analyze_document", "chain_document_review", "계약서 검토", "약관 검토"],
  "처분기준": ["chain_action_basis", "과태료 기준", "과징금 기준", "영업정지 기간"],
  "절차매뉴얼": ["chain_procedure_detail", "처리 절차", "신청 방법", "수수료"],
}

/** 도구 카테고리 매핑 (discover_tools용) */
export const TOOL_CATEGORIES: Record<string, string[]> = {
  "법령검색": ["search_law", "search_law_bulk", "search_all", "advanced_search", "suggest_law_names", "search_ai_law"],
  "법령조회": ["get_law_text", "get_article_detail", "get_batch_articles", "get_article_with_precedents"],
  "행정규칙": ["search_admin_rule", "get_admin_rule", "compare_admin_rule_old_new"],
  "자치법규": ["search_ordinance", "get_ordinance", "ordinance_radar", "chain_ordinance_compare"],
  "법령연계": ["get_linked_ordinances", "get_linked_ordinance_articles", "get_delegated_laws", "get_linked_laws_from_ordinance"],
  "비교분석": ["compare_old_new", "get_three_tier", "compare_articles"],
  "별표서식": ["get_annexes"],
  "법체계": ["get_law_tree", "get_law_system_tree", "chain_law_system"],
  "통계링크": ["get_law_statistics", "get_external_links", "parse_article_links"],
  "이력": ["get_article_history", "get_law_history", "get_historical_law", "search_historical_law", "chain_amendment_track"],
  "결정례통합": ["search_decisions", "get_decision_text"],
  "판례": ["search_precedents", "get_precedent_text", "summarize_precedent", "extract_precedent_keywords", "find_similar_precedents"],
  "해석례": ["search_interpretations", "get_interpretation_text"],
  "조세심판": ["search_tax_tribunal_decisions", "get_tax_tribunal_decision_text"],
  "관세": ["search_customs_interpretations", "get_customs_interpretation_text"],
  "헌재": ["search_constitutional_decisions", "get_constitutional_decision_text"],
  "행정심판": ["search_admin_appeals", "get_admin_appeal_text"],
  "공정위": ["search_ftc_decisions", "get_ftc_decision_text"],
  "개인정보위": ["search_pipc_decisions", "get_pipc_decision_text"],
  "노동위": ["search_nlrc_decisions", "get_nlrc_decision_text"],
  "권익위": ["search_acr_decisions", "get_acr_decision_text"],
  "소청심사": ["search_appeal_review_decisions", "get_appeal_review_decision_text"],
  "권익위심판": ["search_acr_special_appeals", "get_acr_special_appeal_text"],
  "학칙": ["search_school_rules", "get_school_rule_text"],
  "공사공단": ["search_public_corp_rules", "get_public_corp_rule_text"],
  "공공기관": ["search_public_institution_rules", "get_public_institution_rule_text"],
  "조약": ["search_treaties", "get_treaty_text"],
  "영문법령": ["search_english_law", "get_english_law_text"],
  "용어": ["search_legal_terms", "get_legal_term_kb", "get_legal_term_detail", "get_daily_term", "get_daily_to_legal", "get_legal_to_daily", "get_term_articles", "get_related_laws"],
  "종합리서치": ["legal_research", "chain_full_research"],
  "불복준비": ["chain_dispute_prep"],
  // 별칭이 직접 겨냥하는 의도 카테고리 3종은 1-hop 진입점(legal_research)을 앞세운다 (#110).
  // chain_*는 하위호환으로 병기 — execute_tool 경유 2-hop이지만 파라미터가 단순하다.
  "문서분석": ["legal_research", "analyze_document", "chain_document_review"],
  "처분기준": ["legal_research", "chain_action_basis"],
  "절차매뉴얼": ["legal_research", "chain_procedure_detail"],
  // legal_analysis 의 네 mode 에 대응하는 카테고리도 같은 정책을 따른다 —
  // 별칭이 곧 mode 의도라 1-hop 진입점이 답이고, 원본 도구는 하위호환 병기다.
  "정밀분석": ["legal_analysis"],
  "인용검증": ["legal_analysis", "verify_citations"],
  "판례생사": ["legal_analysis", "cite_check"],
  "행위시법": ["legal_analysis", "applicable_law"],
  "영향그래프": ["legal_analysis", "impact_map"],
  "유틸리티": ["parse_jo_code", "get_law_abbreviations"],
}

