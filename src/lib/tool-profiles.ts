/**
 * 도구 카테고리 + 별칭 — discover_tools 자연어 매칭용.
 *
 * (lite/full 프로필은 v3.5.1에서 제거됨: V3_EXPOSED 도입 후 실질 미사용.
 *  tool-registry.ts가 V3_EXPOSED 16개로 고정 노출 → 프로필 분기 의미 상실)
 */

/**
 * 카테고리/도구명 별칭 — discover_tools가 사용자 자연어 입력을 매칭하기 위한 힌트.
 * 한국어 법률 실무에서 흔히 쓰이는 비공식 용어와 도구를 연결.
 *
 * 예시: "조세심판원" → search_tax_tribunal_decisions
 *       "김영란법" → search_law (약칭은 search-normalizer가 처리)
 *       "하자" → search_precedents (민사 분쟁 키워드)
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
  "문서검토": ["analyze_document", "chain_document_review", "계약서 검토", "약관 검토"],
  "처분기준": ["chain_action_basis", "과태료 기준", "과징금 기준", "영업정지 기간"],
  "절차매뉴얼": ["chain_procedure_detail", "처리 절차", "신청 방법", "수수료"],
}

/** 도구 카테고리 매핑 (discover_tools용) */
export const TOOL_CATEGORIES: Record<string, string[]> = {
  "법령검색": ["search_law", "search_all", "advanced_search", "suggest_law_names", "search_ai_law"],
  "법령조회": ["get_law_text", "get_article_detail", "get_batch_articles", "get_article_with_precedents"],
  "행정규칙": ["search_admin_rule", "get_admin_rule", "compare_admin_rule_old_new"],
  "자치법규": ["search_ordinance", "get_ordinance"],
  "법령연계": ["get_linked_ordinances", "get_linked_ordinance_articles", "get_delegated_laws", "get_linked_laws_from_ordinance"],
  "비교분석": ["compare_old_new", "get_three_tier", "compare_articles"],
  "별표서식": ["get_annexes"],
  "법체계": ["get_law_tree", "get_law_system_tree"],
  "통계링크": ["get_law_statistics", "get_external_links", "parse_article_links"],
  "이력": ["get_article_history", "get_law_history", "get_historical_law", "search_historical_law"],
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
  "문서분석": ["analyze_document"],
  "유틸리티": ["parse_jo_code", "get_law_abbreviations"],
}

