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
import { verifyCitations, VerifyCitationsSchema } from "./tools/verify-citations.js"
import { impactMap, ImpactMapSchema } from "./tools/impact-map.js"
import { citeCheck, CiteCheckSchema } from "./tools/cite-check.js"
import { applicableLaw, ApplicableLawSchema } from "./tools/applicable-law.js"
// 통합 진입점 (v4.4.0 — 노출 도구 수 축소용)
import { legalResearch, LegalResearchSchema } from "./tools/legal-research.js"
import { legalAnalysis, LegalAnalysisSchema } from "./tools/legal-analysis.js"
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

  // === 통합 진입점 (v4.4.0) ===
  // legal_research/legal_analysis가 아래 chain_*/킬러피처 12개를 대체 노출.
  // 원본 도구는 allTools에 유지 — 직접 CallTool/execute_tool 하위호환.
  {
    name: "legal_research",
    description: "[⛓리서치] 다단계 법령 리서치 통합 — 여러 API를 병렬로 엮는 복합 질문 전용. task: full_research=도메인·법령명 불명확한 자연어 질문 폴백(기본값, 예 '음주운전 처벌 기준') | law_system=법률·시행령·시행규칙 3단+위임+별표(예 '관세법 체계') | action_basis=처분·허가의 법적 근거+해석례+판례+행심(예 '영업정지 근거') | dispute_prep=불복·소송 준비, 판례+심판례+도메인 결정례(예 '과세처분 불복') | amendment_track=개정 이력+신구대조+연혁(예 '2023년 개정 뭐 바뀜') | ordinance_compare=조례 전국 비교+상위법 적합성(예 '서울시 주차 조례') | procedure_detail=절차·수수료·별표서식(예 '건축허가 절차') | document_review=계약서·약관 조항 리스크+근거법령(text 필수). 단일 조회로 답이 되면 search_law/get_law_text 쓸 것.",
    schema: LegalResearchSchema,
    handler: legalResearch
  },
  {
    name: "legal_analysis",
    description: "[정밀분석] 검증·분석 4종 통합. mode: verify_citations=텍스트 속 조문 인용('민법 제750조' 등)이 실존하는지 법제처 DB 교차검증, LLM 환각 방지(text 필수) | cite_check=판례 생사 확인 — 사건번호로 후속 인용 역추적+변경·폐기 감지, 한국형 Citator(caseNumber 필수) | applicable_law=사건 시점에 시행되던 법령 버전+그 시점 조문+부칙 경과조치, 행위시법 판단(lawName+date 필수, jo 선택) | impact_map=한 조문을 인용한 판례·헌재·해석례·행심·조례 역방향 그래프+mermaid(lawName+jo 필수)",
    schema: LegalAnalysisSchema,
    handler: legalAnalysis
  },

  // === 체인 도구 (다단계 자동 실행) ===
  // 사용 원칙: 단일 조회(search_law/get_law_text)로 답이 되면 체인 쓰지 말 것.
  // 체인은 "여러 API를 병렬로 엮어야 하는" 복합 질문 전용.
  {
    name: "chain_law_system",
    description: "[⛓체인] 법령 전체 구조 종합. 1개 법령의 법률·시행령·시행규칙 3단 + 위임조문 + 하위법령 + 별표까지 한 번에. 예: '관세법 체계 알려줘', '이 법 하위법령 뭐 있어?', '위임관계 보여줘'. scenario=delegation: 위임은 있는데 미제정된 하위법령 감시(감사원용). scenario=impact: 법령 개정 시 연쇄 영향받는 하위법령/조례 탐지(입법영향평가용). 단순 법령명 검색만 필요하면 search_law 쓸 것.",
    schema: chainLawSystemSchema,
    handler: chainLawSystem
  },
  {
    name: "chain_action_basis",
    description: "[⛓체인] 행정처분·허가·인가의 법적 근거 종합. 3단비교+해석례+판례+행심 병렬 조회. 예: '음식점 영업정지 근거', '건축허가 요건', '과징금 부과 기준 + 감경 판례'. scenario=penalty: 과태료/과징금/영업정지 금액·기간 별표 + 1·2·3차 위반 기준 + 감경 판례 + 행심 인용률까지. 공무원 처분 담당자/피처분자 모두 타겟. 단순 판례 검색이면 search_precedents 쓸 것.",
    schema: chainActionBasisSchema,
    handler: chainActionBasis
  },
  {
    name: "chain_dispute_prep",
    description: "[⛓체인] 불복·소송·심판 준비. 대법원 판례 + 행정심판례 + 해당 도메인 결정례(조세심판·공정위·노동위 등) 병렬 수집. 예: '과세처분 불복 방법', '해고 부당노동 구제', '공정위 과징금 취소소송'. 소송/심판 전략 준비용. 단일 도메인만 보면 search_decisions 쓸 것.",
    schema: chainDisputePrepSchema,
    handler: chainDisputePrep
  },
  {
    name: "chain_amendment_track",
    description: "[⛓체인] 법령·조문 개정 이력 종합. 신구대조표 + 조문별 개정이력 + 연혁법령. 예: '개인정보보호법 2023년 개정 뭐 바뀌었어', '이 조문 언제부터 적용'. scenario=timeline: 제정~현재 구간별로 판례/해석례 시계열 매핑(소급적용 쟁점용). 단순 최신 법령 조회는 get_law_text 쓸 것.",
    schema: chainAmendmentTrackSchema,
    handler: chainAmendmentTrack
  },
  {
    name: "chain_ordinance_compare",
    description: "[⛓체인] 자치법규(조례·규칙) 종합 분석. 상위법령 + 위임체계 + 전국 동일유형 조례 비교. 예: '서울시 주차 조례 전국 비교', '광진구 조례가 상위법 위임 범위 안인가'. scenario=compliance: 상위법 적합성 검증(지자체 법제심사용) — 위헌/위법 판결 선례 + 권익위 심판례까지. 특정 조례 단건 조회는 get_ordinance 쓸 것.",
    schema: chainOrdinanceCompareSchema,
    handler: chainOrdinanceCompare
  },
  {
    name: "chain_full_research",
    description: "[⛓체인] 도메인·법령명이 불명확한 복합 질문 전용. AI검색 + 법령검색 + 판례 + 해석례 병렬. 예: '음주운전 처벌 기준', '퇴직금 중간정산', '상가 권리금 받는 법'. 일반인 자연어 질문용 폴백 체인. scenario=customs: 관세 3법(관세/FTA특례/대외무역) + 관세청 해석 + FTA 조약 + 조세심판 관세건. 법령명을 알면 search_law → get_law_text가 더 정확.",
    schema: chainFullResearchSchema,
    handler: chainFullResearch
  },
  {
    name: "chain_procedure_detail",
    description: "[⛓체인] 행정 절차·비용·서식 종합. 법적 근거(법률·시행령·시행규칙) + 처리기한 + 별표/별지서식 + 수수료. 예: '건축허가 처리 절차', '법인설립 신고서', '영업허가 수수료'. scenario=manual: 일선 공무원용 처리 매뉴얼 — 훈령/예규/고시(내부지침) + 우리 지자체 조례 특칙 + FAQ 성격 해석례까지 포함. 단일 별표 조회는 get_annexes 쓸 것.",
    schema: chainProcedureDetailSchema,
    handler: chainProcedureDetail
  },
  {
    name: "chain_document_review",
    description: "[⛓체인] 계약서·약관·협정서 조항별 리스크 검토. analyze_document + 근거법령 자동검색 + 관련 판례. 예: '이 임대차계약서 위험한 조항 있어?', '비밀유지약정 독소조항 체크'. 문서 본문을 text로 넘기면 조항 파싱 → 리스크 탐지 → 관련 법령/판례 매핑. 단순 리스크 분석만이면 analyze_document 쓸 것.",
    schema: chainDocumentReviewSchema,
    handler: chainDocumentReview
  },

  // === 문서 분석 ===
  {
    name: "analyze_document",
    description: "[문서분석] 계약서/약관/협정서 텍스트의 조항별 법적 리스크 분석. 문서 유형 자동 분류, 위험 조항 식별, 관련 법령 검색 힌트 제공.",
    schema: AnalyzeDocumentSchema,
    handler: analyzeDocument
  },

  // === 인용 검증 (killer feature) ===
  {
    name: "verify_citations",
    description: "[인용검증] LLM 환각 방지 — 사용자/AI가 쓴 텍스트에서 '민법 제750조', '상법 제401조의2 제2항' 등 조문 인용을 추출하고 법제처 DB에 실제로 존재하는지 교차검증. 법률 답변 신뢰도 체크, 계약서 인용 검증, 법률 문서 교정용. text만 넘기면 자동 파싱 + 병렬 조회.",
    schema: VerifyCitationsSchema,
    handler: verifyCitations
  },

  // === 영향 그래프 (v4.0 killer feature) ===
  {
    name: "impact_map",
    description: "[영향그래프] 조문 한 줄의 파급효과 그래프. 특정 조문(예: 민법 제103조)을 인용한 모든 판례·헌재·해석례·행심·자치법규를 역방향 탐색 + 그 조문이 인용한 다른 법령(정방향) + mermaid 시각화. lawName + jo 필수. 다른 chain은 query 단방향이지만 이 도구는 '한 조문 → 영향받는 모든 곳' 역방향.",
    schema: ImpactMapSchema,
    handler: impactMap
  },

  // === 판례 인용 추적 (v4.3 killer feature) ===
  {
    name: "cite_check",
    description: "[판례생사] 한국형 Shepard's Citator — 사건번호(예: 2013다61381)로 ① 그 판례를 인용한 후속 판례 역추적(본문검색) ② 전원합의체 후속 판결의 변경·폐기 문구 정밀 스캔 ③ 계속인용/변경가능성 판정. '이 판례 아직 유효한가' 확인용. 변경·폐기된 판례 인용 사고 방지.",
    schema: CiteCheckSchema,
    handler: citeCheck
  },

  // === 행위시법 판단 (v4.3 killer feature) ===
  {
    name: "applicable_law",
    description: "[행위시법] '사건 시점(예: 2023.5.10)에 적용되는 법은?' — 기준일에 시행 중이던 법령 버전(MST) 특정 + 그 시점 조문 본문 + 현행과 비교 + 이후 개정 부칙의 적용례·경과조치 자동 발췌 + 행위시법/처분시법 법리 안내. lawName + date 필수, jo 선택. LLM이 현행법으로 오답하는 것 방지.",
    schema: ApplicableLawSchema,
    handler: applicableLaw
  },

  // === 메타 도구 (lite 프로필용) ===
  {
    name: "discover_tools",
    description: "[메타] 위 도구로 안 되는 경우. 전문도구(조세심판·관세·헌재·행심·공정위·개인정보위·노동위·학칙·조약·영문법령·용어 등 80+개) 카테고리 검색",
    schema: DiscoverToolsSchema,
    handler: discoverTools
  },
  {
    name: "execute_tool",
    description: "[메타] discover_tools 결과 도구를 프록시 실행. tool_name + params",
    schema: ExecuteToolSchema,
    handler: executeTool
  },

  // === 통합 도구 (v3) ===
  {
    name: "search_decisions",
    description: "[통합검색] 18개 도메인(판례·해석례·헌재·행심·조세심판·관세·국세청·공정위·개인정보위·노동위·권익위·소청심사·학칙·공사공단·공공기관·조약·영문법령) 통합 검색. domain으로 선택. 판례 본문까지 필요하면 domain='precedent', options.includeText=true, options.detailLimit=N. 세무 관련 국세청 직접 회신 해석은 domain='nts'.",
    schema: SearchDecisionsSchema,
    handler: searchDecisions
  },
  {
    name: "get_decision_text",
    description: "[통합조회] 18개 도메인 전문 조회. domain+id. full=false(기본) 시 본문 계단식 축약",
    schema: GetDecisionTextSchema,
    handler: getDecisionText
  },
]

/**
 * Zod 스키마 → MCP 광고용 JSON Schema 변환 (apiKey 숨김 포함)
 */
export function toMcpInputSchema(schema: unknown) {
  // Zod v4: z.toJSONSchema()로 직접 변환 (zod-to-json-schema는 Zod v4 미지원)
  // io:"input" 필수 — 기본 "output" 모드는 .default() 필드를 required로 직렬화함
  // (legal_research.task, search_law.display가 required로 광고되던 버그, v4.4.1)
  const rawSchema = z.toJSONSchema(schema as z.ZodType, { io: "input" }) as any

  if (rawSchema?.type === "object" && rawSchema?.properties) {
    // apiKey는 HTTP 헤더(session-state)로 전달되는 게 정식 경로 — 광고 스키마에서 숨김.
    // Zod parse는 여전히 수용하므로 인자로 넘기는 기존 클라이언트도 동작.
    const props = { ...rawSchema.properties }
    delete props.apiKey
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
 * v4.4.0 통합 프로필 — 9개 도구 노출, 나머지는 execute_tool로 접근
 *
 * 노출 기준:
 *   1) 체인 도구가 fallback으로 자주 호출하는 종착 도구
 *   2) discover_tools → execute_tool 왕복으로 평균 5초+ 손실 발생
 *   3) 그 외는 execute_tool 경유 유지
 *
 * v4.4.0 통폐합: chain_* 8개 → legal_research(task), 킬러피처 4개
 * (verify_citations/cite_check/applicable_law/impact_map) → legal_analysis(mode).
 * 원본 12개는 allTools에 유지 — CallTool 직접 호출/execute_tool 하위호환.
 *
 * ⚠️ get_annexes 제거 금지:
 *   헬스장 환불 케이스(trace ld-1775959823220, 79s)에서 별표 3의2를 가져오기 위해
 *   discover_tools × 2 + execute_tool 헛발질로 ~15초 손실. 직노출로 해결.
 */
const V3_EXPOSED = new Set([
  "legal_research",   // v4.4.0: chain_* 8개 통합 (task 파라미터)
  "legal_analysis",   // v4.4.0: verify_citations/cite_check/applicable_law/impact_map 통합 (mode 파라미터)
  "search_law", "get_law_text",
  "get_annexes",
  "search_decisions", "get_decision_text",
  "discover_tools", "execute_tool",
])

// 이름 기반 O(1) 조회용 Map
// allTools는 정적 — 모듈 로드 시 1회만 구성 (HTTP 모드에서 요청마다 재구성 방지)
const toolMap = new Map<string, McpTool>(allTools.map(tool => [tool.name, tool]))

// 메타 도구가 전체 도구 목록 참조할 수 있도록 주입
setAllToolsRef(allTools)

// V3_EXPOSED만 노출 (나머지는 execute_tool 경유)
const exposedTools = allTools.filter(t => V3_EXPOSED.has(t.name))

/** 노출/전체 도구 수 — 헬스체크 등 표기용 파생값 (하드코딩 금지) */
export const TOOL_COUNTS = { exposed: exposedTools.length, total: allTools.length }

export function registerTools(server: Server, apiClient: LawApiClient) {
  // ListTools 핸들러
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
