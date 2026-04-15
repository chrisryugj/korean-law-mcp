/**
 * MCP 도구 레지스트리
 * 모든 도구 등록 및 핸들러 관리
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import type { LawApiClient } from "./lib/api-client.js"
import type { McpTool } from "./lib/types.js"
import { formatToolError } from "./lib/errors.js"
import { type ToolProfile, filterToolsByProfile } from "./lib/tool-profiles.js"
import { discoverTools, DiscoverToolsSchema, executeTool, ExecuteToolSchema, setAllToolsRef } from "./tools/meta-tools.js"
import { searchDecisions, SearchDecisionsSchema, getDecisionText, GetDecisionTextSchema } from "./tools/unified-decisions.js"

// Tool imports
import { searchLaw, SearchLawSchema } from "./tools/search.js"
import { getLawText, GetLawTextSchema } from "./tools/law-text.js"
import { parseJoCode, ParseJoCodeSchema, getLawAbbreviations, GetLawAbbreviationsSchema } from "./tools/utils.js"
import { compareOldNew, CompareOldNewSchema } from "./tools/comparison.js"
import { getThreeTier, GetThreeTierSchema } from "./tools/three-tier.js"
import { searchAdminRule, SearchAdminRuleSchema, getAdminRule, GetAdminRuleSchema, compareAdminRuleOldNew, CompareAdminRuleOldNewSchema } from "./tools/admin-rule.js"
import { getArticleDetail, GetArticleDetailSchema } from "./tools/article-detail.js"
import { getAnnexes, GetAnnexesSchema } from "./tools/annex.js"
import { getOrdinance, GetOrdinanceSchema } from "./tools/ordinance.js"
import { searchOrdinance, SearchOrdinanceSchema } from "./tools/ordinance-search.js"
import { compareArticles, CompareArticlesSchema } from "./tools/article-compare.js"
import { getLawTree, GetLawTreeSchema } from "./tools/law-tree.js"
import { searchAll, SearchAllSchema } from "./tools/search-all.js"
import { suggestLawNames, SuggestLawNamesSchema } from "./tools/autocomplete.js"
import { searchPrecedents, searchPrecedentsSchema, getPrecedentText, getPrecedentTextSchema } from "./tools/precedents.js"
import { searchInterpretations, searchInterpretationsSchema, getInterpretationText, getInterpretationTextSchema } from "./tools/interpretations.js"
import { getBatchArticles, GetBatchArticlesSchema } from "./tools/batch-articles.js"
import { getArticleWithPrecedents, GetArticleWithPrecedentsSchema } from "./tools/article-with-precedents.js"
import { getArticleHistory, ArticleHistorySchema } from "./tools/article-history.js"
import { getLawHistory, LawHistorySchema } from "./tools/law-history.js"
import { summarizePrecedent, SummarizePrecedentSchema } from "./tools/precedent-summary.js"
import { extractPrecedentKeywords, ExtractKeywordsSchema } from "./tools/precedent-keywords.js"
import { findSimilarPrecedents, FindSimilarPrecedentsSchema } from "./tools/similar-precedents.js"
import { getLawStatistics, LawStatisticsSchema } from "./tools/law-statistics.js"
import { parseArticleLinks, ParseArticleLinksSchema } from "./tools/article-link-parser.js"
import { getExternalLinks, ExternalLinksSchema } from "./tools/external-links.js"
import { advancedSearch, AdvancedSearchSchema } from "./tools/advanced-search.js"
import { searchTaxTribunalDecisions, searchTaxTribunalDecisionsSchema, getTaxTribunalDecisionText, getTaxTribunalDecisionTextSchema } from "./tools/tax-tribunal-decisions.js"
import { searchCustomsInterpretations, searchCustomsInterpretationsSchema, getCustomsInterpretationText, getCustomsInterpretationTextSchema } from "./tools/customs-interpretations.js"
import { searchConstitutionalDecisions, searchConstitutionalDecisionsSchema, getConstitutionalDecisionText, getConstitutionalDecisionTextSchema } from "./tools/constitutional-decisions.js"
import { searchAdminAppeals, searchAdminAppealsSchema, getAdminAppealText, getAdminAppealTextSchema } from "./tools/admin-appeals.js"
import { searchTreaties, searchTreatiesSchema, getTreatyText, getTreatyTextSchema } from "./tools/treaties.js"
import { searchEnglishLaw, searchEnglishLawSchema, getEnglishLawText, getEnglishLawTextSchema } from "./tools/english-law.js"
import { searchLegalTerms, searchLegalTermsSchema } from "./tools/legal-terms.js"
import { searchAiLaw, searchAiLawSchema } from "./tools/life-law.js"
import { getLegalTermKB, getLegalTermKBSchema, getLegalTermDetail, getLegalTermDetailSchema, getDailyTerm, getDailyTermSchema, getDailyToLegal, getDailyToLegalSchema, getLegalToDaily, getLegalToDailySchema, getTermArticles, getTermArticlesSchema, getRelatedLaws, getRelatedLawsSchema } from "./tools/knowledge-base.js"
import { searchFtcDecisions, searchFtcDecisionsSchema, getFtcDecisionText, getFtcDecisionTextSchema, searchPipcDecisions, searchPipcDecisionsSchema, getPipcDecisionText, getPipcDecisionTextSchema, searchNlrcDecisions, searchNlrcDecisionsSchema, getNlrcDecisionText, getNlrcDecisionTextSchema, searchAcrDecisions, searchAcrDecisionsSchema, getAcrDecisionText, getAcrDecisionTextSchema } from "./tools/committee-decisions.js"
import { searchSchoolRules, searchSchoolRulesSchema, getSchoolRuleText, getSchoolRuleTextSchema, searchPublicCorpRules, searchPublicCorpRulesSchema, getPublicCorpRuleText, getPublicCorpRuleTextSchema, searchPublicInstitutionRules, searchPublicInstitutionRulesSchema, getPublicInstitutionRuleText, getPublicInstitutionRuleTextSchema } from "./tools/institutional-rules.js"
import { searchAppealReviewDecisions, searchAppealReviewDecisionsSchema, getAppealReviewDecisionText, getAppealReviewDecisionTextSchema, searchAcrSpecialAppeals, searchAcrSpecialAppealsSchema, getAcrSpecialAppealText, getAcrSpecialAppealTextSchema } from "./tools/special-admin-appeals.js"
import { getHistoricalLaw, getHistoricalLawSchema, searchHistoricalLaw, searchHistoricalLawSchema } from "./tools/historical-law.js"
import { getLawSystemTree, getLawSystemTreeSchema } from "./tools/law-system-tree.js"
import { getLinkedOrdinances, LinkedOrdinancesSchema, getLinkedOrdinanceArticles, LinkedOrdinanceArticlesSchema, getDelegatedLaws, DelegatedLawsSchema, getLinkedLawsFromOrdinance, LinkedLawsFromOrdinanceSchema } from "./tools/law-linkage.js"
import { analyzeDocument, AnalyzeDocumentSchema } from "./tools/document-analysis.js"
// Chain tool imports
import {
  chainLawSystem, chainLawSystemSchema,
  chainActionBasis, chainActionBasisSchema,
  chainDisputePrep, chainDisputePrepSchema,
  chainAmendmentTrack, chainAmendmentTrackSchema,
  chainOrdinanceCompare, chainOrdinanceCompareSchema,
  chainFullResearch, chainFullResearchSchema,
  chainProcedureDetail, chainProcedureDetailSchema,
  chainDocumentReview, chainDocumentReviewSchema,
  chainArticleHistory, chainArticleHistorySchema,
  chainHistoricalArticle, chainHistoricalArticleSchema,
} from "./tools/chains.js"

/**
 * 모든 MCP 도구 정의
 */
export const allTools: McpTool[] = [
  // === 법령 검색/조회 ===
  {
    name: "search_law",
    description: "[법령검색] 법령명 키워드검색 → lawId, mst 획득. 약칭 자동변환. 법령 조회 전 식별자 확보용.",
    schema: SearchLawSchema,
    handler: searchLaw
  },
  {
    name: "get_law_text",
    description: "[법령조회] 조문 전문 조회. mst/lawId 필수, jo로 특정 조문만 가능.",
    schema: GetLawTextSchema,
    handler: getLawText
  },
  {
    name: "get_article_detail",
    description: "[법령조회] 조항호목 단위 정밀 조회. 제38조 제2항 제3호 같은 세부 단위 지정 가능. mst/lawId + jo 필수, hang/ho/mok 선택.",
    schema: GetArticleDetailSchema,
    handler: getArticleDetail
  },
  {
    name: "search_all",
    description: "[통합검색] 법령+행정규칙+자치법규 동시검색. 도메인 불명확 시 사용.",
    schema: SearchAllSchema,
    handler: searchAll
  },
  {
    name: "advanced_search",
    description: "[고급검색] 법령종류/부처/시행일 필터 검색. 복합 조건 시.",
    schema: AdvancedSearchSchema,
    handler: advancedSearch
  },
  {
    name: "suggest_law_names",
    description: "[자동완성] 법령명 일부 입력 시 후보 목록 제안. 정확한 법령명을 모를 때 사용.",
    schema: SuggestLawNamesSchema,
    handler: suggestLawNames
  },

  // === 행정규칙 ===
  {
    name: "search_admin_rule",
    description: "[행정규칙] 훈령/예규/고시/지침 검색. knd 파라미터로 종류 필터 가능(1=훈령, 2=예규, 3=고시).",
    schema: SearchAdminRuleSchema,
    handler: searchAdminRule
  },
  {
    name: "get_admin_rule",
    description: "[행정규칙] 행정규칙 전문 조회.",
    schema: GetAdminRuleSchema,
    handler: getAdminRule
  },
  {
    name: "compare_admin_rule_old_new",
    description: "[행정규칙] 행정규칙 신구법 비교. query로 검색, id로 본문 대조표 조회.",
    schema: CompareAdminRuleOldNewSchema,
    handler: compareAdminRuleOldNew
  },

  // === 자치법규 ===
  {
    name: "search_ordinance",
    description: "[자치법규] 조례/규칙 검색. 지역명 포함 권장.",
    schema: SearchOrdinanceSchema,
    handler: searchOrdinance
  },
  {
    name: "get_ordinance",
    description: "[자치법규] 조례/규칙 전문 조회. jo 파라미터로 특정 조문 본문 조회 가능.",
    schema: GetOrdinanceSchema,
    handler: getOrdinance
  },

  // === 법령-자치법규 연계 ===
  {
    name: "get_linked_ordinances",
    description: "[연계] 법령 기준 자치법규 연계 목록. 특정 법령과 관련된 전국 조례/규칙 조회.",
    schema: LinkedOrdinancesSchema,
    handler: getLinkedOrdinances
  },
  {
    name: "get_linked_ordinance_articles",
    description: "[연계] 법령-자치법규 조문 연계. 법령 조문과 자치법규 조문 간 대응 관계 조회.",
    schema: LinkedOrdinanceArticlesSchema,
    handler: getLinkedOrdinanceArticles
  },
  {
    name: "get_delegated_laws",
    description: "[연계] 위임법령 목록. 소관부처별 위임법령(시행령/시행규칙 미제정) 조회.",
    schema: DelegatedLawsSchema,
    handler: getDelegatedLaws
  },
  {
    name: "get_linked_laws_from_ordinance",
    description: "[연계] 자치법규 기준 상위법령 조회. 조례/규칙의 근거 법령 확인.",
    schema: LinkedLawsFromOrdinanceSchema,
    handler: getLinkedLawsFromOrdinance
  },

  // === 비교/분석 ===
  {
    name: "compare_old_new",
    description: "[비교] 신구법 대조표 조회.",
    schema: CompareOldNewSchema,
    handler: compareOldNew
  },
  {
    name: "get_three_tier",
    description: "[비교] 3단비교(법률-시행령-시행규칙) 위임조문/인용조문.",
    schema: GetThreeTierSchema,
    handler: getThreeTier
  },
  {
    name: "compare_articles",
    description: "[비교] 두 법령 조문 비교.",
    schema: CompareArticlesSchema,
    handler: compareArticles
  },

  // === 부가정보 ===
  {
    name: "get_annexes",
    description: "[별표] 별표/서식 조회. lawName+'별표N'으로 내용 추출. 금액/기준은 별표에 있는 경우 많음.",
    schema: GetAnnexesSchema,
    handler: getAnnexes
  },
  {
    name: "get_law_tree",
    description: "[체계] 법령 목차 구조(편·장·절) 조회. 내부 체계 파악용.",
    schema: GetLawTreeSchema,
    handler: getLawTree
  },
  {
    name: "get_law_system_tree",
    description: "[체계] 상위법·하위법·관련법령 관계 조회. 법령 간 위임 관계 파악용.",
    schema: getLawSystemTreeSchema,
    handler: getLawSystemTree
  },
  {
    name: "get_law_statistics",
    description: "[통계] 최근 개정 법령 TOP N 조회. 지정 기간(일) 내 개정된 법령 목록 반환.",
    schema: LawStatisticsSchema,
    handler: getLawStatistics
  },
  {
    name: "get_external_links",
    description: "[링크] 법령 외부 참조 링크.",
    schema: ExternalLinksSchema,
    handler: (_apiClient, input) => getExternalLinks(input)
  },
  {
    name: "parse_article_links",
    description: "[분석] 조문 내 법령 참조 추출.",
    schema: ParseArticleLinksSchema,
    handler: parseArticleLinks
  },

  // === 이력 ===
  {
    name: "get_article_history",
    description: "[이력] 조문별 개정 이력.",
    schema: ArticleHistorySchema,
    handler: getArticleHistory
  },
  {
    name: "get_law_history",
    description: "[이력] 법령 변경이력 목록.",
    schema: LawHistorySchema,
    handler: getLawHistory
  },
  {
    name: "get_historical_law",
    description: "[이력] 특정 시점 연혁법령 조회.",
    schema: getHistoricalLawSchema,
    handler: getHistoricalLaw
  },
  {
    name: "search_historical_law",
    description: "[이력] 연혁법령 검색.",
    schema: searchHistoricalLawSchema,
    handler: searchHistoricalLaw
  },

  // === 판례 ===
  {
    name: "search_precedents",
    description: "[판례] 대법원 판례 검색.",
    schema: searchPrecedentsSchema,
    handler: searchPrecedents
  },
  {
    name: "get_precedent_text",
    description: "[판례] 판례 전문 조회.",
    schema: getPrecedentTextSchema,
    handler: getPrecedentText
  },
  {
    name: "summarize_precedent",
    description: "[판례] 판례 요약 생성.",
    schema: SummarizePrecedentSchema,
    handler: summarizePrecedent
  },
  {
    name: "extract_precedent_keywords",
    description: "[판례] 판례 키워드 추출.",
    schema: ExtractKeywordsSchema,
    handler: extractPrecedentKeywords
  },
  {
    name: "find_similar_precedents",
    description: "[판례] 유사 판례 검색.",
    schema: FindSimilarPrecedentsSchema,
    handler: findSimilarPrecedents
  },

  // === 해석례 ===
  {
    name: "search_interpretations",
    description: "[해석례] 법령해석례 검색.",
    schema: searchInterpretationsSchema,
    handler: searchInterpretations
  },
  {
    name: "get_interpretation_text",
    description: "[해석례] 해석례 전문 조회.",
    schema: getInterpretationTextSchema,
    handler: getInterpretationText
  },

  // === 조세심판/관세해석 ===
  {
    name: "search_tax_tribunal_decisions",
    description: "[조세심판] 조세심판원 결정례 검색. 관세·소득세·법인세·부가세 등 세목별 검색 가능.",
    schema: searchTaxTribunalDecisionsSchema,
    handler: searchTaxTribunalDecisions
  },
  {
    name: "get_tax_tribunal_decision_text",
    description: "[조세심판] 조세심판 결정례 전문.",
    schema: getTaxTribunalDecisionTextSchema,
    handler: getTaxTribunalDecisionText
  },
  {
    name: "search_customs_interpretations",
    description: "[관세] 관세청 법령해석(관세 해석례) 검색. 관세법·FTA특례법·대외무역법 해석례.",
    schema: searchCustomsInterpretationsSchema,
    handler: searchCustomsInterpretations
  },
  {
    name: "get_customs_interpretation_text",
    description: "[관세] 관세 해석례 전문 조회. 질의요지·회답·이유·관련법령 포함.",
    schema: getCustomsInterpretationTextSchema,
    handler: getCustomsInterpretationText
  },

  // === 헌재/행심 ===
  {
    name: "search_constitutional_decisions",
    description: "[헌재] 헌법재판소 결정례 검색.",
    schema: searchConstitutionalDecisionsSchema,
    handler: searchConstitutionalDecisions
  },
  {
    name: "get_constitutional_decision_text",
    description: "[헌재] 헌재 결정례 전문.",
    schema: getConstitutionalDecisionTextSchema,
    handler: getConstitutionalDecisionText
  },
  {
    name: "search_admin_appeals",
    description: "[행심] 행정심판례 검색.",
    schema: searchAdminAppealsSchema,
    handler: searchAdminAppeals
  },
  {
    name: "get_admin_appeal_text",
    description: "[행심] 행정심판례 전문.",
    schema: getAdminAppealTextSchema,
    handler: getAdminAppealText
  },

  // === 위원회 결정문 ===
  {
    name: "search_ftc_decisions",
    description: "[공정위] 공정거래위원회 결정문 검색.",
    schema: searchFtcDecisionsSchema,
    handler: searchFtcDecisions
  },
  {
    name: "get_ftc_decision_text",
    description: "[공정위] 공정위 결정문 전문.",
    schema: getFtcDecisionTextSchema,
    handler: getFtcDecisionText
  },
  {
    name: "search_pipc_decisions",
    description: "[개인정보위] 개인정보보호위원회 결정문 검색.",
    schema: searchPipcDecisionsSchema,
    handler: searchPipcDecisions
  },
  {
    name: "get_pipc_decision_text",
    description: "[개인정보위] 개인정보위 결정문 전문.",
    schema: getPipcDecisionTextSchema,
    handler: getPipcDecisionText
  },
  {
    name: "search_nlrc_decisions",
    description: "[노동위] 중앙노동위원회 결정문 검색.",
    schema: searchNlrcDecisionsSchema,
    handler: searchNlrcDecisions
  },
  {
    name: "get_nlrc_decision_text",
    description: "[노동위] 노동위 결정문 전문.",
    schema: getNlrcDecisionTextSchema,
    handler: getNlrcDecisionText
  },
  {
    name: "search_acr_decisions",
    description: "[권익위] 국민권익위원회 결정문 검색.",
    schema: searchAcrDecisionsSchema,
    handler: searchAcrDecisions
  },
  {
    name: "get_acr_decision_text",
    description: "[권익위] 국민권익위 결정문 전문.",
    schema: getAcrDecisionTextSchema,
    handler: getAcrDecisionText
  },

  // === 학칙/공단/공공기관 규정 ===
  {
    name: "search_school_rules",
    description: "[학칙] 학칙(대학교·고등학교 등) 검색.",
    schema: searchSchoolRulesSchema,
    handler: searchSchoolRules
  },
  {
    name: "get_school_rule_text",
    description: "[학칙] 학칙 본문 조회.",
    schema: getSchoolRuleTextSchema,
    handler: getSchoolRuleText
  },
  {
    name: "search_public_corp_rules",
    description: "[공사공단] 지방공사공단 규정 검색.",
    schema: searchPublicCorpRulesSchema,
    handler: searchPublicCorpRules
  },
  {
    name: "get_public_corp_rule_text",
    description: "[공사공단] 지방공사공단 규정 본문 조회.",
    schema: getPublicCorpRuleTextSchema,
    handler: getPublicCorpRuleText
  },
  {
    name: "search_public_institution_rules",
    description: "[공공기관] 공공기관 규정 검색.",
    schema: searchPublicInstitutionRulesSchema,
    handler: searchPublicInstitutionRules
  },
  {
    name: "get_public_institution_rule_text",
    description: "[공공기관] 공공기관 규정 본문 조회.",
    schema: getPublicInstitutionRuleTextSchema,
    handler: getPublicInstitutionRuleText
  },

  // === 특별행정심판 ===
  {
    name: "search_appeal_review_decisions",
    description: "[소청심사] 소청심사위원회 재결례 검색. 공무원 징계(파면·해임·감봉 등) 불복.",
    schema: searchAppealReviewDecisionsSchema,
    handler: searchAppealReviewDecisions
  },
  {
    name: "get_appeal_review_decision_text",
    description: "[소청심사] 소청심사위원회 재결례 전문.",
    schema: getAppealReviewDecisionTextSchema,
    handler: getAppealReviewDecisionText
  },
  {
    name: "search_acr_special_appeals",
    description: "[권익위심판] 국민권익위 특별행정심판 재결례 검색.",
    schema: searchAcrSpecialAppealsSchema,
    handler: searchAcrSpecialAppeals
  },
  {
    name: "get_acr_special_appeal_text",
    description: "[권익위심판] 국민권익위 특별행정심판 재결례 전문.",
    schema: getAcrSpecialAppealTextSchema,
    handler: getAcrSpecialAppealText
  },

  // === 조약 ===
  {
    name: "search_treaties",
    description: "[조약] 조약(양자/다자) 검색. 국가코드·체결일·발효일 필터 가능.",
    schema: searchTreatiesSchema,
    handler: searchTreaties
  },
  {
    name: "get_treaty_text",
    description: "[조약] 조약 본문 조회. 한글/영문 선택 가능.",
    schema: getTreatyTextSchema,
    handler: getTreatyText
  },

  // === 영문법령/용어 ===
  {
    name: "search_english_law",
    description: "[영문] 영문 법령 검색.",
    schema: searchEnglishLawSchema,
    handler: searchEnglishLaw
  },
  {
    name: "get_english_law_text",
    description: "[영문] 영문 법령 전문.",
    schema: getEnglishLawTextSchema,
    handler: getEnglishLawText
  },
  {
    name: "search_legal_terms",
    description: "[용어사전] 법령용어 정의·해설 검색.",
    schema: searchLegalTermsSchema,
    handler: searchLegalTerms
  },

  // === 생활법령/AI검색 ===
  {
    name: "search_ai_law",
    description: "[AI검색] 자연어로 관련 조문 의미검색. 법령명 몰라도 사용 가능. 법령명을 알면 search_law가 더 정확.",
    schema: searchAiLawSchema,
    handler: searchAiLaw
  },

  // === 법령용어 지식베이스 ===
  {
    name: "get_legal_term_kb",
    description: "[지식베이스] 법령용어 검색. 동음이의어·용어관계 포함.",
    schema: getLegalTermKBSchema,
    handler: getLegalTermKB
  },
  {
    name: "get_legal_term_detail",
    description: "[지식베이스] 법령용어 상세정보.",
    schema: getLegalTermDetailSchema,
    handler: getLegalTermDetail
  },
  {
    name: "get_daily_term",
    description: "[지식베이스] 일상용어(월세, 뺑소니 등)로 검색하여 대응하는 법령용어를 찾을 때 사용.",
    schema: getDailyTermSchema,
    handler: getDailyTerm
  },
  {
    name: "get_daily_to_legal",
    description: "[지식베이스] 일상용어→법령용어 매핑.",
    schema: getDailyToLegalSchema,
    handler: getDailyToLegal
  },
  {
    name: "get_legal_to_daily",
    description: "[지식베이스] 법령용어→일상용어 매핑.",
    schema: getLegalToDailySchema,
    handler: getLegalToDaily
  },
  {
    name: "get_term_articles",
    description: "[지식베이스] 용어 사용 조문 목록.",
    schema: getTermArticlesSchema,
    handler: getTermArticles
  },
  {
    name: "get_related_laws",
    description: "[지식베이스] 용어 관련 법령 목록.",
    schema: getRelatedLawsSchema,
    handler: getRelatedLaws
  },

  // === 유틸리티 ===
  {
    name: "parse_jo_code",
    description: "[유틸] 조문번호 ↔ JO코드 변환.",
    schema: ParseJoCodeSchema,
    handler: (_apiClient, input) => parseJoCode(input)
  },
  {
    name: "get_law_abbreviations",
    description: "[유틸] 법령 약칭 전체 목록 조회. stdDt/endDt로 기간 필터 가능.",
    schema: GetLawAbbreviationsSchema,
    handler: getLawAbbreviations
  },
  {
    name: "get_batch_articles",
    description: "[배치] 여러 조문 일괄 조회. mst+articles 또는 laws 배열.",
    schema: GetBatchArticlesSchema,
    handler: getBatchArticles
  },
  {
    name: "get_article_with_precedents",
    description: "[통합] 조문 + 관련 판례 동시 조회.",
    schema: GetArticleWithPrecedentsSchema,
    handler: getArticleWithPrecedents
  },

  // === 체인 도구 (다단계 자동 실행) ===
  {
    name: "chain_law_system",
    description: "[⛓체인] 법령 구조·체계 질문 시 사용. 법령검색→3단비교(법률·시행령·시행규칙)→조문→별표 자동 연쇄. scenario='delegation'이면 위임입법 미이행 감시, 'impact'이면 개정 영향도 분석 추가. 예: '건축법 체계', '관세법 위임입법 현황', '국민건강보험법 영향도 분석'.",
    schema: chainLawSystemSchema,
    handler: chainLawSystem
  },
  {
    name: "chain_action_basis",
    description: "[⛓체인] 허가·인가·처분·기준 질문 시 사용. 3단비교→해석례→판례→행정심판 병렬. scenario='penalty'이면 처분기준표(별표)+감경판례+벌칙개정이력 추가. 예: '건축허가 거부 근거', '식품위생법 과태료 감경', '영업정지 처분 기준'.",
    schema: chainActionBasisSchema,
    handler: chainActionBasis
  },
  {
    name: "chain_dispute_prep",
    description: "[⛓체인] 불복·소송·심판 질문 시 사용. 판례→행정심판→도메인 결정례 병렬. 예: '과태료 불복 방법', '징계처분 취소소송 판례'.",
    schema: chainDisputePrepSchema,
    handler: chainDisputePrep
  },
  {
    name: "chain_amendment_track",
    description: "[⛓체인] 법령 개정·변경·연혁 질문 시 사용. 신구대조+조문이력 자동 연쇄. maxAmendments(기본 1, 최대 20)로 최근 N회 개정 신구대조 일괄 반환. fromDate(YYYYMMDD)로 특정 날짜 이후 모든 개정 조회 가능. scenario='timeline'이면 개정 구간별 판례·해석례 시계열 매핑 추가. 예: '민법 최근 3회 개정', '관세법 2010년 이후 개정이력', '근로기준법 개정이력 시계열'.",
    schema: chainAmendmentTrackSchema,
    handler: chainAmendmentTrack
  },
  {
    name: "chain_ordinance_compare",
    description: "[⛓체인] 자치법규(조례·규칙) 검색·조회·비교 시 사용. 상위법령→위임체계→전국 조례검색 자동 연쇄. scenario='compliance'이면 상위법 적합성 검증(헌재·행심 위법판결+근거분석) 추가. 예: '광진구 복무 조례', '조례 상위법 위반 검증'.",
    schema: chainOrdinanceCompareSchema,
    handler: chainOrdinanceCompare
  },
  {
    name: "chain_full_research",
    description: "[⛓체인] 복합 질문·종합 조사 시 사용. AI검색→법령→판례→해석례 병렬 수집. scenario='customs'이면 관세·통관 종합(관세3법+해석례+FTA조약+세율표+조세심판) 추가. 예: '음주운전 처벌 기준', '수입 통관 법적 체크', 'FTA 원산지 규정'.",
    schema: chainFullResearchSchema,
    handler: chainFullResearch
  },
  {
    name: "chain_procedure_detail",
    description: "[⛓체인] 신청·절차·비용·서식 질문 시 사용. 법령→3단비교→별표/서식 자동 연쇄. scenario='manual'이면 공무원 처리 매뉴얼(행정규칙+자치법규 특칙+해석례) 추가. 예: '건축허가 절차', '건축허가 처리 방법 매뉴얼'.",
    schema: chainProcedureDetailSchema,
    handler: chainProcedureDetail
  },
  {
    name: "chain_document_review",
    description: "[⛓체인] 계약서·약관·협정서 검토 시 사용. 리스크분석→법령검색→판례검색 자동 연쇄. 문서 텍스트를 입력하면 리스크+근거법령+관련판례 제공.",
    schema: chainDocumentReviewSchema,
    handler: chainDocumentReview
  },
  {
    name: "chain_article_history",
    description: "[⛓체인] 특정 조문의 시계열 개정 연혁 조회. 법령명+조문번호+기간을 입력하면 조문이력→신구대조표(개정이유 포함) 자동 연쇄. 예: '근로기준법 제60조 2010년 이후 개정 내역'.",
    schema: chainArticleHistorySchema,
    handler: chainArticleHistory
  },
  {
    name: "chain_historical_article",
    description: "[⛓체인] 특정 날짜 기준 과거 시점 조문 조회. 법령명+조문번호+기준일자 입력 시 연혁버전 자동 선택→해당 시점 조문 반환. 예: '근로기준법 제60조 2015년 1월 기준'.",
    schema: chainHistoricalArticleSchema,
    handler: chainHistoricalArticle
  },

  // === 문서 분석 ===
  {
    name: "analyze_document",
    description: "[문서분석] 계약서/약관/협정서 텍스트의 조항별 법적 리스크 분석. 문서 유형 자동 분류, 위험 조항 식별, 관련 법령 검색 힌트 제공.",
    schema: AnalyzeDocumentSchema,
    handler: analyzeDocument
  },

  // === 메타 도구 (lite 프로필용) ===
  {
    name: "discover_tools",
    description: "[메타] 위 체인/직접 도구로 처리 불가능할 때 사용. 73개 전문 도구(조세심판·관세·헌재·행정심판·공정위·개인정보위·노동위·학칙·조약·영문법령·용어사전 등)를 카테고리별 검색. 결과로 나온 도구명을 execute_tool에 전달.",
    schema: DiscoverToolsSchema,
    handler: discoverTools
  },
  {
    name: "execute_tool",
    description: "[메타] discover_tools로 찾은 전문 도구를 프록시 실행. tool_name에 도구명, params에 파라미터 객체 전달. 예: execute_tool(tool_name='search_tax_tribunal_decisions', params={query:'부가세'}).",
    schema: ExecuteToolSchema,
    handler: executeTool
  },

  // === 통합 도구 (v3) ===
  {
    name: "search_decisions",
    description: "[통합검색] 판례·해석례·헌재·행심·조세심판·관세·공정위·개인정보위·노동위·권익위·소청심사·학칙·공사공단·공공기관·조약·영문법령 등 17개 도메인 통합 검색. domain 파라미터로 선택.",
    schema: SearchDecisionsSchema,
    handler: searchDecisions
  },
  {
    name: "get_decision_text",
    description: "[통합조회] 17개 도메인(판례·결정례·재결례·학칙·조약·영문법령 등) 전문 조회. domain+id로 지정.",
    schema: GetDecisionTextSchema,
    handler: getDecisionText
  },
]

/**
 * ZodEffects(.refine(), .transform() 등)를 벗겨내고 내부 ZodObject를 반환
 */
function toMcpInputSchema(schema: unknown) {
  // Zod v4: z.toJSONSchema()로 직접 변환 (zod-to-json-schema는 Zod v4 미지원)
  const rawSchema = z.toJSONSchema(schema as z.ZodType) as any

  if (rawSchema?.type === "object" && rawSchema?.properties) {
    const props = { ...rawSchema.properties }
    const required = Array.isArray(rawSchema.required)
      ? rawSchema.required.filter((k: string) => k !== "apiKey")
      : []
    return {
      type: "object",
      properties: props,
      required,
      additionalProperties: rawSchema.additionalProperties ?? false
    }
  }

  return rawSchema
}

/**
 * v3 통합 프로필 — 15개 도구 노출, 나머지는 execute_tool로 접근
 *
 * 노출 기준:
 *   1) 체인 도구가 fallback으로 자주 호출하는 종착 도구
 *   2) discover_tools → execute_tool 왕복으로 평균 5초+ 손실 발생
 *   3) 그 외는 execute_tool 경유 유지
 *
 * ⚠️ get_annexes 제거 금지:
 *   헬스장 환불 케이스(trace ld-1775959823220, 79s)에서 별표 3의2를 가져오기 위해
 *   discover_tools × 2 + execute_tool 헛발질로 ~15초 손실. 직노출로 해결.
 */
const V3_EXPOSED = new Set([
  "chain_full_research", "chain_law_system", "chain_action_basis",
  "chain_dispute_prep", "chain_amendment_track", "chain_ordinance_compare",
  "chain_procedure_detail", "chain_document_review",
  "chain_article_history", "chain_historical_article",
  "search_law", "get_law_text", "get_three_tier",
  "get_annexes",
  "search_decisions", "get_decision_text",
  "discover_tools", "execute_tool",
])

// 이름 기반 O(1) 조회용 Map
const toolMap = new Map<string, McpTool>()

export function registerTools(server: Server, apiClient: LawApiClient, profile: ToolProfile = "full") {
  // Map 초기화
  toolMap.clear()
  for (const tool of allTools) toolMap.set(tool.name, tool)

  // 메타 도구가 전체 도구 목록 참조할 수 있도록 주입
  setAllToolsRef(allTools)

  // v3: 14개만 노출
  const exposedTools = allTools.filter(t => V3_EXPOSED.has(t.name))

  // ListTools 핸들러 — 프로필에 맞는 도구만 노출
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: exposedTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: toMcpInputSchema(tool.schema)
    }))
  }))

  // CallTool 핸들러 — 전체 도구 실행 가능 (execute_tool 프록시 지원)
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    const tool = toolMap.get(name)
    if (!tool) {
      return {
        content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
        isError: true
      }
    }

    try {
      const input = tool.schema.parse(args)
      const result = await tool.handler(apiClient, input)
      return {
        content: result.content.map(c => ({ type: "text" as const, text: c.text })),
        isError: result.isError
      }
    } catch (error) {
      const errResult = formatToolError(error, name)
      return {
        content: errResult.content.map(c => ({ type: "text" as const, text: c.text })),
        isError: true
      }
    }
  })
}
