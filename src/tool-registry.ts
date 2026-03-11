/**
 * MCP 도구 레지스트리
 * 모든 도구 등록 및 핸들러 관리
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { zodToJsonSchema } from "zod-to-json-schema"
import type { LawApiClient } from "./lib/api-client.js"
import type { McpTool } from "./lib/types.js"
import { formatToolError } from "./lib/errors.js"

// Tool imports
import { searchLaw, SearchLawSchema } from "./tools/search.js"
import { getLawText, GetLawTextSchema } from "./tools/law-text.js"
import { parseJoCode, ParseJoCodeSchema } from "./tools/utils.js"
import { compareOldNew, CompareOldNewSchema } from "./tools/comparison.js"
import { getThreeTier, GetThreeTierSchema } from "./tools/three-tier.js"
import { searchAdminRule, SearchAdminRuleSchema, getAdminRule, GetAdminRuleSchema } from "./tools/admin-rule.js"
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
import { searchEnglishLaw, searchEnglishLawSchema, getEnglishLawText, getEnglishLawTextSchema } from "./tools/english-law.js"
import { searchLegalTerms, searchLegalTermsSchema } from "./tools/legal-terms.js"
import { searchAiLaw, searchAiLawSchema } from "./tools/life-law.js"
import { getLegalTermKB, getLegalTermKBSchema, getLegalTermDetail, getLegalTermDetailSchema, getDailyTerm, getDailyTermSchema, getDailyToLegal, getDailyToLegalSchema, getLegalToDaily, getLegalToDailySchema, getTermArticles, getTermArticlesSchema, getRelatedLaws, getRelatedLawsSchema } from "./tools/knowledge-base.js"
import { searchFtcDecisions, searchFtcDecisionsSchema, getFtcDecisionText, getFtcDecisionTextSchema, searchPipcDecisions, searchPipcDecisionsSchema, getPipcDecisionText, getPipcDecisionTextSchema, searchNlrcDecisions, searchNlrcDecisionsSchema, getNlrcDecisionText, getNlrcDecisionTextSchema } from "./tools/committee-decisions.js"
import { getHistoricalLaw, getHistoricalLawSchema, searchHistoricalLaw, searchHistoricalLawSchema } from "./tools/historical-law.js"
import { getLawSystemTree, getLawSystemTreeSchema } from "./tools/law-system-tree.js"
// Chain tool imports
import {
  chainLawSystem, chainLawSystemSchema,
  chainActionBasis, chainActionBasisSchema,
  chainDisputePrep, chainDisputePrepSchema,
  chainAmendmentTrack, chainAmendmentTrackSchema,
  chainOrdinanceCompare, chainOrdinanceCompareSchema,
  chainFullResearch, chainFullResearchSchema,
  chainProcedureDetail, chainProcedureDetailSchema,
} from "./tools/chains.js"

/**
 * 모든 MCP 도구 정의
 */
export const allTools: McpTool[] = [
  // === 법령 검색/조회 ===
  {
    name: "search_law",
    description: "[법령검색] 법령명으로 검색하여 lawId, mst를 획득하는 기본 도구. 약칭 자동변환(화관법→화학물질관리법). 법령 조회·비교 전 반드시 이 도구로 식별자를 먼저 확보할 것. 법령명을 아는 경우 사용.",
    schema: SearchLawSchema,
    handler: searchLaw
  },
  {
    name: "get_law_text",
    description: "[법령조회] 현행법령 조문 전문 조회. search_law로 획득한 mst/lawId 필수. jo 파라미터로 특정 조문만 조회 가능. 전체 법령 또는 특정 조문 내용이 필요할 때 사용.",
    schema: GetLawTextSchema,
    handler: getLawText
  },
  {
    name: "search_all",
    description: "[통합검색] 법령+행정규칙+자치법규를 동시 검색하여 어떤 영역에 관련 규정이 있는지 빠르게 파악. 결과는 요약본이므로 상세 조회 시 개별 검색 도구 사용 필요. 검색 대상 영역이 불명확할 때 먼저 사용.",
    schema: SearchAllSchema,
    handler: searchAll
  },
  {
    name: "advanced_search",
    description: "[고급검색] 법령구분·소관부처·시행일 기간 등 복합 조건 검색. 단순 키워드가 아닌 기간이나 부처 필터가 필요할 때 사용. 단순 법령명 검색은 search_law가 더 적합.",
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

  // === 자치법규 ===
  {
    name: "search_ordinance",
    description: "[자치법규] 조례/규칙 검색. 공무원 휴직/복무/징계 등 결과 없으면 상위법령(지방공무원법)을 search_law로 검색 권장.",
    schema: SearchOrdinanceSchema,
    handler: searchOrdinance
  },
  {
    name: "get_ordinance",
    description: "[자치법규] 조례/규칙 전문 조회.",
    schema: GetOrdinanceSchema,
    handler: getOrdinance
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
    description: "[별표] 법령 별표/서식 목록 조회 및 내용 추출. lawName만 입력하면 목록 반환, bylSeq 또는 lawName에 '별표N'을 함께 입력하면 해당 별표 텍스트 추출. 수수료·과태료·서식 확인 시 사용.",
    schema: GetAnnexesSchema,
    handler: getAnnexes
  },
  {
    name: "get_law_tree",
    description: "[체계] 법령의 편·장·절·관 목차 구조(내부 체계) 조회. 법령 내 조문이 어떤 장/절에 속하는지 확인할 때 사용. 상위/하위 법령 관계는 get_law_system_tree 사용.",
    schema: GetLawTreeSchema,
    handler: getLawTree
  },
  {
    name: "get_law_system_tree",
    description: "[체계] 법령체계도 -- 상위법(모법)·하위법(시행령/시행규칙)·관련법령 관계 조회. 법령 간 위임 관계를 파악할 때 사용. 법령 내부 목차는 get_law_tree 사용.",
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
    description: "[용어사전] 법령용어 정의·해설 검색. 특정 법률 용어의 뜻을 찾을 때 사용. 용어 간 연계(일상어↔법령어)는 지식베이스 도구 사용.",
    schema: searchLegalTermsSchema,
    handler: searchLegalTerms
  },

  // === 생활법령/AI검색 ===
  {
    name: "search_ai_law",
    description: "[AI검색] 법제처 AI 엔진 기반 자연어 법령 검색. 일상 질문('음주운전 처벌')이나 상황 설명으로 관련 조문을 직접 찾아줌. lawTypes로 법률/대통령령 등 필터 가능. 법령명을 모르고 상황만 아는 경우 최적. 법령명을 아는 경우 search_law가 더 정확.",
    schema: searchAiLawSchema,
    handler: searchAiLaw
  },

  // === 법령용어 지식베이스 ===
  {
    name: "get_legal_term_kb",
    description: "[지식베이스] 법령용어 검색 -- 동음이의어·용어관계·조문연계 메타정보 포함. 용어의 관계망을 탐색할 때 사용. 단순 정의만 필요하면 search_legal_terms가 빠름.",
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
    name: "get_batch_articles",
    description: "[배치] 여러 조문 일괄 조회. 단일 법령(mst+articles) 또는 복수 법령(laws 배열)을 한번에 조회. 예: laws=[{mst:'123',articles:['제1조','제2조']},{mst:'456',articles:['제3조']}]",
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
    description: "[체인] 법체계 파악 -- 법령 검색→3단비교(법률·시행령·시행규칙)→조문 조회를 한번에. 수수료/과태료 키워드 시 별표 자동 포함. 예: chain_law_system(query='관세법', articles=['제38조'])",
    schema: chainLawSystemSchema,
    handler: chainLawSystem
  },
  {
    name: "chain_action_basis",
    description: "[체인] 처분/허가 근거 확인 -- 법령체계→해석례→판례→행정심판을 한번에 조회. 예: chain_action_basis(query='건축허가 거부 근거')",
    schema: chainActionBasisSchema,
    handler: chainActionBasis
  },
  {
    name: "chain_dispute_prep",
    description: "[체인] 불복/쟁송 대비 -- 판례+행정심판+전문결정례(조세심판/노동위/개인정보위) 병렬 검색. 예: chain_dispute_prep(query='징계처분 감경', domain='labor')",
    schema: chainDisputePrepSchema,
    handler: chainDisputePrep
  },
  {
    name: "chain_amendment_track",
    description: "[체인] 개정 추적 -- 신구대조표+조문별 개정이력 자동 조회. 예: chain_amendment_track(query='지방세특례제한법')",
    schema: chainAmendmentTrackSchema,
    handler: chainAmendmentTrack
  },
  {
    name: "chain_ordinance_compare",
    description: "[체인] 조례 비교 연구 -- 상위법 위임체계 확인→전국 조례 검색→비교. 조례 제·개정 시 필수. 예: chain_ordinance_compare(query='주민자치회', parentLaw='지방자치법')",
    schema: chainOrdinanceCompareSchema,
    handler: chainOrdinanceCompare
  },
  {
    name: "chain_full_research",
    description: "[체인] 종합 리서치 -- AI검색→법령본문→판례→해석례를 한번에 종합 조회. 자연어 질문에 최적이며 개별 도구를 순차 호출할 필요 없음. 법령+판례+해석을 모두 봐야 할 때 사용. 예: chain_full_research(query='기간제 근로자 2년 초과 사용')",
    schema: chainFullResearchSchema,
    handler: chainFullResearch
  },
  {
    name: "chain_procedure_detail",
    description: "[체인] 절차/비용/서식 안내 -- 법령체계→별표(수수료/과태료)→서식(신청서) 자동 조회. 예: chain_procedure_detail(query='여권발급 절차 수수료')",
    schema: chainProcedureDetailSchema,
    handler: chainProcedureDetail
  },
]

/**
 * ZodEffects(.refine(), .transform() 등)를 벗겨내고 내부 ZodObject를 반환
 */
function unwrapZodEffects(schema: unknown): unknown {
  let current: any = schema
  // ZodEffects 체인을 따라가며 innerType 추출 (최대 10단계)
  for (let i = 0; i < 10; i++) {
    if (current?._def?.typeName === "ZodEffects" && current._def.schema) {
      // zod v3: _def.schema 에 내부 스키마 존재
      current = current._def.schema
    } else if (typeof current?.innerType === "function") {
      // 일부 zod 버전에서는 innerType() 메서드로 접근
      current = current.innerType()
    } else {
      break
    }
  }
  return current
}

function toMcpInputSchema(schema: unknown) {
  // .refine()이 적용된 스키마(ZodEffects)는 zodToJsonSchema가
  // 내부 객체 구조를 제대로 노출하지 못할 수 있으므로 먼저 unwrap
  const unwrapped = unwrapZodEffects(schema)
  const rawSchema = zodToJsonSchema(unwrapped as any, { $refStrategy: "none" }) as any

  // 일부 커넥터는 $schema/$ref가 포함된 스키마를 축약 처리해 선택 파라미터를 누락시키므로
  // MCP에서 필요한 핵심 필드만 노출합니다.
  if (rawSchema?.type === "object" && rawSchema?.properties) {
    return {
      type: "object",
      properties: rawSchema.properties,
      required: Array.isArray(rawSchema.required) ? rawSchema.required : [],
      additionalProperties: rawSchema.additionalProperties ?? false
    }
  }

  return rawSchema
}

/**
 * 서버에 모든 도구 등록
 */
export function registerTools(server: Server, apiClient: LawApiClient) {
  // ListTools 핸들러
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: toMcpInputSchema(tool.schema)
    }))
  }))

  // CallTool 핸들러
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    const tool = allTools.find(t => t.name === name)
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
