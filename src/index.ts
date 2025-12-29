#!/usr/bin/env node

/**
 * Korean Law MCP Server
 * 국가법령정보센터 API 기반 MCP 서버
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"

import { LawApiClient } from "./lib/api-client.js"
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
// v1.5.0 - New API tools
import { searchConstitutionalDecisions, searchConstitutionalDecisionsSchema, getConstitutionalDecisionText, getConstitutionalDecisionTextSchema } from "./tools/constitutional-decisions.js"
import { searchAdminAppeals, searchAdminAppealsSchema, getAdminAppealText, getAdminAppealTextSchema } from "./tools/admin-appeals.js"
import { searchEnglishLaw, searchEnglishLawSchema, getEnglishLawText, getEnglishLawTextSchema } from "./tools/english-law.js"
import { searchLegalTerms, searchLegalTermsSchema } from "./tools/legal-terms.js"
import { searchAiLaw, searchAiLawSchema } from "./tools/life-law.js"
// v1.6.0 - Knowledge Base APIs
import { getLegalTermKB, getLegalTermKBSchema, getLegalTermDetail, getLegalTermDetailSchema, getDailyTerm, getDailyTermSchema, getDailyToLegal, getDailyToLegalSchema, getLegalToDaily, getLegalToDailySchema, getTermArticles, getTermArticlesSchema, getRelatedLaws, getRelatedLawsSchema } from "./tools/knowledge-base.js"
import { searchFtcDecisions, searchFtcDecisionsSchema, getFtcDecisionText, getFtcDecisionTextSchema, searchPipcDecisions, searchPipcDecisionsSchema, getPipcDecisionText, getPipcDecisionTextSchema, searchNlrcDecisions, searchNlrcDecisionsSchema, getNlrcDecisionText, getNlrcDecisionTextSchema } from "./tools/committee-decisions.js"
import { getHistoricalLaw, getHistoricalLawSchema, searchHistoricalLaw, searchHistoricalLawSchema } from "./tools/historical-law.js"
import { getLawSystemTree, getLawSystemTreeSchema } from "./tools/law-system-tree.js"
import { startHTTPServer } from "./server/http-server.js"

// API 클라이언트 초기화
// PlayMCP 등 외부에서 apiKey를 파라미터로 전달받을 수 있도록
// 환경변수는 선택사항으로 변경 (없어도 서버 시작 가능)
const LAW_OC = process.env.LAW_OC || ""
const apiClient = new LawApiClient({ apiKey: LAW_OC })

// MCP 서버 생성
const server = new Server(
  {
    name: "korean-law",
    version: "1.6.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
)

// ListTools 핸들러
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search_law",
        description: `[법령] 검색 → lawId, mst 획득. 약칭 자동변환(화관법→화학물질관리법). get_law_text 전 필수 실행.`,
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "검색할 법령명 (약칭 가능)"
            },
            maxResults: {
              type: "number",
              description: "결과 수 (기본:20)",
              default: 20
            }
          },
          required: ["query"]
        }
      },
      {
        name: "get_law_text",
        description: `[법령] 조문 조회. mst/lawId 필수(search_law에서). jo 생략시 목차 반환(20조 초과 법령). 한글 조문번호 자동변환(제38조→003800).`,
        inputSchema: {
          type: "object",
          properties: {
            mst: {
              type: "string",
              description: "법령일련번호"
            },
            lawId: {
              type: "string",
              description: "법령ID"
            },
            jo: {
              type: "string",
              description: "조문 번호 제X조 또는 6자리코드"
            },
            efYd: {
              type: "string",
              description: "시행일자 (YYYYMMDD)"
            }
          },
          required: []
        }
      },
      {
        name: "parse_jo_code",
        description: `[유틸] 조문번호 변환. to_code: 제38조→003800, to_text: 003800→제38조. (get_law_text는 자동변환하므로 직접 호출 불필요)`,
        inputSchema: {
          type: "object",
          properties: {
            joText: {
              type: "string",
              description: "변환할 조문 번호"
            },
            direction: {
              type: "string",
              enum: ["to_code", "to_text"],
              description: "변환 방향 (기본값: to_code)",
              default: "to_code"
            }
          },
          required: ["joText"]
        }
      },
      {
        name: "compare_old_new",
        description: `[법령] 신구법 대조 - 개정 전후 조문 비교. mst/lawId + ld(공포일 YYYYMMDD) 필요. 자치법규 미지원.`,
        inputSchema: {
          type: "object",
          properties: {
            mst: {
              type: "string",
              description: "법령일련번호"
            },
            lawId: {
              type: "string",
              description: "법령ID"
            },
            ld: {
              type: "string",
              description: "공포일자 (YYYYMMDD)"
            },
            ln: {
              type: "string",
              description: "공포번호"
            }
          },
          required: []
        }
      },
      {
        name: "get_three_tier",
        description: `[법령] 3단비교 - 법률→시행령→시행규칙 위임/인용 관계. knd=1(인용), knd=2(위임, 기본값). 행정규칙/자치법규 미지원.`,
        inputSchema: {
          type: "object",
          properties: {
            mst: {
              type: "string",
              description: "법령일련번호"
            },
            lawId: {
              type: "string",
              description: "법령ID"
            },
            knd: {
              type: "string",
              enum: ["1", "2"],
              description: "1=인용조문, 2=위임조문 (기본값: 2)",
              default: "2"
            }
          },
          required: []
        }
      },
      {
        name: "search_admin_rule",
        description: `[행정규칙] 검색(훈령/예규/고시/공고). knd=1훈령,2예규,3고시,4공고,5일반. → get_admin_rule로 전문 조회.`,
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "검색할 행정규칙명"
            },
            knd: {
              type: "string",
              description: "행정규칙 종류 (1=훈령, 2=예규, 3=고시, 4=공고, 5=일반)"
            },
            maxResults: {
              type: "number",
              description: "결과 수 (기본:20)",
              default: 20
            }
          },
          required: ["query"]
        }
      },
      {
        name: "get_admin_rule",
        description: `[행정규칙] 전문 조회. id 필수.`,
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "행정규칙ID"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "get_annexes",
        description: `[법령] 별표/서식 조회. lawName 필수(정식명칭, 약칭 불가). knd=1별표,2서식,3부칙별표,4부칙서식,5전체.`,
        inputSchema: {
          type: "object",
          properties: {
            lawName: {
              type: "string",
              description: "법령명 "
            },
            knd: {
              type: "string",
              enum: ["1", "2", "3", "4", "5"],
              description: "1=별표, 2=서식, 3=부칙별표, 4=부칙서식, 5=전체"
            }
          },
          required: ["lawName"]
        }
      },
      {
        name: "get_ordinance",
        description: `[자치법규] 전문 조회. ordinSeq 필수.`,
        inputSchema: {
          type: "object",
          properties: {
            ordinSeq: {
              type: "string",
              description: "자치법규 일련번호"
            }
          },
          required: ["ordinSeq"]
        }
      },
      {
        name: "search_ordinance",
        description: `[자치법규] 검색. 지역명+주제 조합 가능. → get_ordinance로 전문 조회.`,
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "검색할 자치법규명 지역+주제"
            },
            display: {
              type: "number",
              description: "결과 수 (기본:20)",
              default: 20
            }
          },
          required: ["query"]
        }
      },
      {
        name: "compare_articles",
        description: `[법령] 조문 비교. law1, law2 각각 {mst/lawId, jo} 지정.`,
        inputSchema: {
          type: "object",
          properties: {
            law1: {
              type: "object",
              description: "첫 번째 법령 정보",
              properties: {
                mst: {
                  type: "string",
                  description: "법령일련번호"
                },
                lawId: {
                  type: "string",
                  description: "법령ID"
                },
                jo: {
                  type: "string",
                  description: "조문 번호 제X조"
                }
              },
              required: ["jo"]
            },
            law2: {
              type: "object",
              description: "두 번째 법령 정보",
              properties: {
                mst: {
                  type: "string",
                  description: "법령일련번호"
                },
                lawId: {
                  type: "string",
                  description: "법령ID"
                },
                jo: {
                  type: "string",
                  description: "조문 번호 제X조"
                }
              },
              required: ["jo"]
            }
          },
          required: ["law1", "law2"]
        }
      },
      {
        name: "get_law_tree",
        description: `[법령] 계층 트리 시각화. 법률→시행령→시행규칙 구조 표시. get_three_tier의 시각화 버전.`,
        inputSchema: {
          type: "object",
          properties: {
            mst: {
              type: "string",
              description: "법령일련번호"
            },
            lawId: {
              type: "string",
              description: "법령ID"
            }
          },
          required: []
        }
      },
      {
        name: "search_all",
        description: `[검색] 통합검색 - 법령+행정규칙+자치법규 동시 검색. 검색 대상 유형 불명확할 때 사용.`,
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "검색할 키워드"
            },
            maxResults: {
              type: "number",
              description: "각 유형별 결과 수 (기본:10)",
              default: 10
            }
          },
          required: ["query"]
        }
      },
      {
        name: "suggest_law_names",
        description: `[유틸] 법령명 자동완성. 부분 입력으로 후보 목록 제안. search_law 실패 시 대안.`,
        inputSchema: {
          type: "object",
          properties: {
            partial: {
              type: "string",
              description: "부분 입력된 법령명"
            }
          },
          required: ["partial"]
        }
      },
      {
        name: "search_precedents",
        description: `[판례] 검색(키워드/법원/사건번호). → get_precedent_text로 전문 조회. 법령해석은 search_interpretations.`,
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "검색 키워드"
            },
            court: {
              type: "string",
              description: "법원명 필터 예: 대법원"
            },
            caseNumber: {
              type: "string",
              description: "사건번호 예: 2009느합133"
            },
            display: {
              type: "number",
              description: "결과 수 (기본:20)",
              default: 20
            },
            page: {
              type: "number",
              description: "페이지 (기본:1)",
              default: 1
            },
            sort: {
              type: "string",
              enum: ["lasc", "ldes", "dasc", "ddes", "nasc", "ndes"],
              description: "정렬 옵션"
            }
          },
          required: []
        }
      },
      {
        name: "get_precedent_text",
        description: `[판례] 전문 조회. id 필수(search_precedents에서). 판시사항/판결요지/참조조문/전문 포함.`,
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "판례일련번호"
            },
            caseName: {
              type: "string",
              description: "판례명"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "search_interpretations",
        description: `[해석례] 검색(법제처 등 행정기관 해석). → get_interpretation_text로 전문. 조세는 search_tax_tribunal_decisions.`,
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "검색 키워드"
            },
            display: {
              type: "number",
              description: "결과 수 (기본:20)",
              default: 20
            },
            page: {
              type: "number",
              description: "페이지 (기본:1)",
              default: 1
            },
            sort: {
              type: "string",
              enum: ["lasc", "ldes", "dasc", "ddes", "nasc", "ndes"],
              description: "정렬 옵션"
            }
          },
          required: ["query"]
        }
      },
      {
        name: "get_interpretation_text",
        description: `[해석례] 전문 조회. id 필수(search_interpretations에서).`,
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "법령해석례ID"
            },
            caseName: {
              type: "string",
              description: "안건명"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "get_batch_articles",
        description: `[법령] 다중 조문 조회. articles 배열로 조문 지정. get_law_text 반복 호출 대체.`,
        inputSchema: {
          type: "object",
          properties: {
            mst: {
              type: "string",
              description: "법령일련번호"
            },
            lawId: {
              type: "string",
              description: "법령ID"
            },
            articles: {
              type: "array",
              items: {
                type: "string"
              },
              description: "조문 번호 배열 (예: ['제1조', '제2조'])"
            },
            efYd: {
              type: "string",
              description: "시행일자 (YYYYMMDD)"
            }
          },
          required: ["articles"]
        }
      },
      {
        name: "get_article_with_precedents",
        description: `[법령] 조문+판례 통합 조회. jo 필수. includePrecedents=false로 조문만 조회 가능.`,
        inputSchema: {
          type: "object",
          properties: {
            mst: {
              type: "string",
              description: "법령일련번호"
            },
            lawId: {
              type: "string",
              description: "법령ID"
            },
            jo: {
              type: "string",
              description: "조문 번호 제X조"
            },
            efYd: {
              type: "string",
              description: "시행일자 (YYYYMMDD)"
            },
            includePrecedents: {
              type: "boolean",
              description: "관련 판례 포함 여부 (기본:true)",
              default: true
            }
          },
          required: ["jo"]
        }
      },
      {
        name: "get_article_history",
        description: `[연혁] 조문별 개정 조회. lawId+jo 또는 기간(fromRegDt~toRegDt) 지정.`,
        inputSchema: {
          type: "object",
          properties: {
            lawId: {
              type: "string",
              description: "법령ID (선택)"
            },
            jo: {
              type: "string",
              description: "조문번호 (예: '제38조', 선택)"
            },
            regDt: {
              type: "string",
              description: "조문 개정일 (YYYYMMDD, 선택)"
            },
            fromRegDt: {
              type: "string",
              description: "조회기간 시작일 (YYYYMMDD, 선택)"
            },
            toRegDt: {
              type: "string",
              description: "조회기간 종료일 (YYYYMMDD, 선택)"
            },
            org: {
              type: "string",
              description: "소관부처코드 (선택)"
            },
            page: {
              type: "number",
              description: "페이지 (기본:1)",
              default: 1
            }
          },
          required: []
        }
      },
      {
        name: "get_law_history",
        description: `[연혁] 특정일 개정 법령 목록. regDt(YYYYMMDD) 필수. 조문별은 get_article_history.`,
        inputSchema: {
          type: "object",
          properties: {
            regDt: {
              type: "string",
              description: "법령 변경일자 예: 20240101"
            },
            org: {
              type: "string",
              description: "소관부처코드 (선택)"
            },
            display: {
              type: "number",
              description: "결과 수 (기본:20)",
              default: 20
            },
            page: {
              type: "number",
              description: "페이지 (기본:1)",
              default: 1
            }
          },
          required: ["regDt"]
        }
      },
      {
        name: "summarize_precedent",
        description: `[판례] 요약(판시사항/판결요지/주문). id 필수. 전문은 get_precedent_text.`,
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "판례일련번호"
            },
            maxLength: {
              type: "number",
              description: "요약 최대 길이 (기본:500자)",
              default: 500
            }
          },
          required: ["id"]
        }
      },
      {
        name: "extract_precedent_keywords",
        description: `[판례] 키워드 추출(법률용어/조문번호). id 필수. → find_similar_precedents에 활용.`,
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "판례일련번호"
            },
            maxKeywords: {
              type: "number",
              description: "최대 키워드 개수 (기본:10)",
              default: 10
            }
          },
          required: ["id"]
        }
      },
      {
        name: "find_similar_precedents",
        description: `[판례] 유사 검색(키워드 기반 유사도). query 필수.`,
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "검색 키워드 또는 판례 내용"
            },
            maxResults: {
              type: "number",
              description: "결과 수 (기본:5)",
              default: 5
            }
          },
          required: ["query"]
        }
      },
      {
        name: "get_law_statistics",
        description: `[통계] 법령 통계. analysisType=recent_changes(최근N일)/by_department(부처별)/by_year(연도별). 특정 법령 이력은 get_law_history.`,
        inputSchema: {
          type: "object",
          properties: {
            analysisType: {
              type: "string",
              enum: ["recent_changes", "by_department", "by_year"],
              description: "통계 유형: recent_changes (최근 개정), by_department (소관부처별), by_year (제정년도별)"
            },
            days: {
              type: "number",
              description: "최근 변경 분석 기간 (일 단위, 기본값: 30)",
              default: 30
            },
            limit: {
              type: "number",
              description: "결과 개수 제한 (기본:10)",
              default: 10
            }
          },
          required: ["analysisType"]
        }
      },
      {
        name: "parse_article_links",
        description: `[유틸] 조문 참조 파싱("제X조", "같은 조", "전항" 등 자동 인식). jo 필수.`,
        inputSchema: {
          type: "object",
          properties: {
            mst: {
              type: "string",
              description: "법령일련번호"
            },
            lawId: {
              type: "string",
              description: "법령ID"
            },
            jo: {
              type: "string",
              description: "조문 번호 제X조"
            },
            efYd: {
              type: "string",
              description: "시행일자 (YYYYMMDD)"
            }
          },
          required: ["jo"]
        }
      },
      {
        name: "get_external_links",
        description: `[유틸] 외부 링크 생성(법제처/법원도서관). linkType=law/precedent/interpretation.`,
        inputSchema: {
          type: "object",
          properties: {
            linkType: {
              type: "string",
              enum: ["law", "precedent", "interpretation"],
              description: "링크 유형: law (법령), precedent (판례), interpretation (해석례)"
            },
            lawId: {
              type: "string",
              description: "법령ID (법령 링크 생성 시)"
            },
            mst: {
              type: "string",
              description: "법령일련번호 (법령 링크 생성 시)"
            },
            precedentId: {
              type: "string",
              description: "판례일련번호 (판례 링크 생성 시)"
            },
            interpretationId: {
              type: "string",
              description: "법령해석례일련번호 (해석례 링크 생성 시)"
            }
          },
          required: ["linkType"]
        }
      },
      {
        name: "advanced_search",
        description: `[검색] 고급 검색 - 기간/부처/AND|OR 필터. searchType=law/admin_rule/ordinance/all.`,
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "검색 키워드"
            },
            searchType: {
              type: "string",
              enum: ["law", "admin_rule", "ordinance", "all"],
              description: "검색 대상: law (법령), admin_rule (행정규칙), ordinance (자치법규), all (전체)",
              default: "law"
            },
            fromDate: {
              type: "string",
              description: "제정일 시작 (YYYYMMDD)"
            },
            toDate: {
              type: "string",
              description: "제정일 종료 (YYYYMMDD)"
            },
            org: {
              type: "string",
              description: "소관부처코드"
            },
            operator: {
              type: "string",
              enum: ["AND", "OR"],
              description: "키워드 결합 연산자",
              default: "AND"
            },
            maxResults: {
              type: "number",
              description: "결과 수 (기본:20)",
              default: 20
            }
          },
          required: ["query"]
        }
      },
      {
        name: "search_tax_tribunal_decisions",
        description: `[조세] 심판원 재결례 검색. → get_tax_tribunal_decision_text로 전문. 관세는 search_customs_interpretations.`,
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "검색 키워드"
            },
            display: {
              type: "number",
              description: "결과 수 (기본:20)",
              default: 20
            },
            page: {
              type: "number",
              description: "페이지 (기본:1)",
              default: 1
            },
            cls: {
              type: "string",
              description: "재결구분코드"
            },
            gana: {
              type: "string",
              description: "사전식 검색 (ga, na, da 등)"
            },
            dpaYd: {
              type: "string",
              description: "처분일자 범위 (YYYYMMDD~YYYYMMDD, 예: '20200101~20201231')"
            },
            rslYd: {
              type: "string",
              description: "의결일자 범위 (YYYYMMDD~YYYYMMDD, 예: '20200101~20201231')"
            },
            sort: {
              type: "string",
              enum: ["lasc", "ldes", "dasc", "ddes", "nasc", "ndes"],
              description: "정렬 옵션"
            }
          },
          required: []
        }
      },
      {
        name: "get_tax_tribunal_decision_text",
        description: `[조세] 심판원 재결례 전문. id 필수(search_tax_tribunal_decisions에서).`,
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "재결례ID"
            },
            decisionName: {
              type: "string",
              description: "재결례명"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "search_customs_interpretations",
        description: `[관세] 해석 검색(FTA/원산지/관세평가 등). → get_customs_interpretation_text로 전문.`,
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "검색 키워드"
            },
            display: {
              type: "number",
              description: "결과 수 (기본:20)",
              default: 20
            },
            page: {
              type: "number",
              description: "페이지 (기본:1)",
              default: 1
            },
            inq: {
              type: "number",
              description: "질의기관코드"
            },
            rpl: {
              type: "number",
              description: "해석기관코드"
            },
            gana: {
              type: "string",
              description: "사전식 검색 (ga, na, da 등)"
            },
            explYd: {
              type: "string",
              description: "해석일자 범위 (YYYYMMDD~YYYYMMDD, 예: '20200101~20201231')"
            },
            sort: {
              type: "string",
              enum: ["lasc", "ldes", "dasc", "ddes"],
              description: "정렬 옵션"
            }
          },
          required: []
        }
      },
      {
        name: "get_customs_interpretation_text",
        description: `[관세] 해석 전문. id 필수(search_customs_interpretations에서).`,
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "해석례ID"
            },
            interpretationName: {
              type: "string",
              description: "해석명"
            }
          },
          required: ["id"]
        }
      },
      // v1.5.0 - New API tools
      {
        name: "search_constitutional_decisions",
        description: `[헌재] 결정례 검색(위헌/합헌/헌법소원). → get_constitutional_decision_text로 전문.`,
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "검색 키워드"
            },
            caseNumber: {
              type: "string",
              description: "사건번호 예: 2020헌바123"
            },
            display: {
              type: "number",
              description: "결과 수 (기본:20)",
              default: 20
            },
            page: {
              type: "number",
              description: "페이지 (기본:1)",
              default: 1
            },
            sort: {
              type: "string",
              enum: ["lasc", "ldes", "dasc", "ddes", "nasc", "ndes"],
              description: "정렬 옵션: lasc/ldes (법령명순), dasc/ddes (날짜순), nasc/ndes (사건번호순)"
            }
          },
          required: []
        }
      },
      {
        name: "get_constitutional_decision_text",
        description: `[헌재] 결정례 전문. id 필수(search_constitutional_decisions에서).`,
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "헌재결정ID"
            },
            caseName: {
              type: "string",
              description: "사건명"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "search_admin_appeals",
        description: `[행심] 검색(취소/무효/과태료감경). → get_admin_appeal_text로 전문.`,
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "검색 키워드"
            },
            display: {
              type: "number",
              description: "결과 수 (기본:20)",
              default: 20
            },
            page: {
              type: "number",
              description: "페이지 (기본:1)",
              default: 1
            },
            sort: {
              type: "string",
              enum: ["lasc", "ldes", "dasc", "ddes", "nasc", "ndes"],
              description: "정렬 옵션: lasc/ldes (법령명순), dasc/ddes (날짜순), nasc/ndes (사건번호순)"
            }
          },
          required: []
        }
      },
      {
        name: "get_admin_appeal_text",
        description: `[행심] 전문. id 필수(search_admin_appeals에서).`,
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "행정심판ID"
            },
            caseName: {
              type: "string",
              description: "사건명"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "search_english_law",
        description: `[영문] 법령 검색(영문/한글 모두 가능). 약 1,800건 영문 번역. → get_english_law_text로 조문.`,
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "법령명 검색어 (영문/한글)"
            },
            display: {
              type: "number",
              description: "결과 수 (기본:20)",
              default: 20
            },
            page: {
              type: "number",
              description: "페이지 (기본:1)",
              default: 1
            },
            sort: {
              type: "string",
              enum: ["lasc", "ldes", "dasc", "ddes"],
              description: "정렬 옵션: lasc/ldes (법령명순), dasc/ddes (날짜순)"
            }
          },
          required: []
        }
      },
      {
        name: "get_english_law_text",
        description: `[영문] 조문 조회. lawId/mst/lawName 중 하나 필요.`,
        inputSchema: {
          type: "object",
          properties: {
            lawId: {
              type: "string",
              description: "법령ID"
            },
            mst: {
              type: "string",
              description: "법령일련번호"
            },
            lawName: {
              type: "string",
              description: "법령명 영문/한글"
            }
          },
          required: []
        }
      },
      {
        name: "search_legal_terms",
        description: `[용어] 법령용어 검색(선의/악의/하자/채권 등). 용어 의미와 관련 법령 확인.`,
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "검색할 법령용어"
            },
            display: {
              type: "number",
              description: "결과 수 (기본:20)",
              default: 20
            },
            page: {
              type: "number",
              description: "페이지 (기본:1)",
              default: 1
            }
          },
          required: ["query"]
        }
      },
      {
        name: "search_ai_law",
        description: `[AI검색] 자연어로 법령 검색. 정확한 법령명 모를 때 사용. 예: "음주운전 처벌", "임대차 보증금". 법령명 알면 search_law 사용.`,
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "자연어 질문/상황"
            },
            search: {
              type: "string",
              enum: ["0", "1", "2", "3"],
              description: "검색범위: 0=법령조문, 1=법령별표서식, 2=행정규칙조문, 3=행정규칙별표서식",
              default: "0"
            },
            display: {
              type: "number",
              description: "결과 수 (기본:20)",
              default: 20
            },
            page: {
              type: "number",
              description: "페이지 (기본:1)",
              default: 1
            }
          },
          required: ["query"]
        }
      },
      {
        name: "search_ftc_decisions",
        description: `[공정위] 결정문 검색(담합/불공정거래/하도급). → get_ftc_decision_text로 전문.`,
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "검색 키워드"
            },
            display: {
              type: "number",
              description: "결과 수 (기본:20)",
              default: 20
            },
            page: {
              type: "number",
              description: "페이지 (기본:1)",
              default: 1
            },
            sort: {
              type: "string",
              enum: ["lasc", "ldes", "dasc", "ddes"],
              description: "정렬 옵션: lasc/ldes (법령명순), dasc/ddes (날짜순)"
            }
          },
          required: []
        }
      },
      {
        name: "get_ftc_decision_text",
        description: `[공정위] 결정문 전문. id 필수(search_ftc_decisions에서).`,
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "결정문ID"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "search_pipc_decisions",
        description: `[개보위] 결정문 검색(침해/유출/과징금). → get_pipc_decision_text로 전문.`,
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "검색 키워드"
            },
            display: {
              type: "number",
              description: "결과 수 (기본:20)",
              default: 20
            },
            page: {
              type: "number",
              description: "페이지 (기본:1)",
              default: 1
            },
            sort: {
              type: "string",
              enum: ["lasc", "ldes", "dasc", "ddes"],
              description: "정렬 옵션: lasc/ldes (법령명순), dasc/ddes (날짜순)"
            }
          },
          required: []
        }
      },
      {
        name: "get_pipc_decision_text",
        description: `[개보위] 결정문 전문. id 필수(search_pipc_decisions에서).`,
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "결정문ID"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "search_nlrc_decisions",
        description: `[노동위] 결정문 검색(부당해고/부당노동행위). → get_nlrc_decision_text로 전문.`,
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "검색 키워드"
            },
            display: {
              type: "number",
              description: "결과 수 (기본:20)",
              default: 20
            },
            page: {
              type: "number",
              description: "페이지 (기본:1)",
              default: 1
            },
            sort: {
              type: "string",
              enum: ["lasc", "ldes", "dasc", "ddes"],
              description: "정렬 옵션: lasc/ldes (법령명순), dasc/ddes (날짜순)"
            }
          },
          required: []
        }
      },
      {
        name: "get_nlrc_decision_text",
        description: `[노동위] 결정문 전문. id 필수(search_nlrc_decisions에서).`,
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "결정문ID"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "get_historical_law",
        description: `[연혁] 특정 시점 법령 조회. date(YYYYMMDD) 필수 + lawId/mst/lawName 중 하나.`,
        inputSchema: {
          type: "object",
          properties: {
            lawId: {
              type: "string",
              description: "법령ID"
            },
            mst: {
              type: "string",
              description: "법령일련번호"
            },
            lawName: {
              type: "string",
              description: "법령명"
            },
            date: {
              type: "string",
              description: "조회 시점 날짜 (YYYYMMDD 형식, 예: 20200101"
            },
            jo: {
              type: "string",
              description: "특정 조문 번호 (예: '제38조', 선택사항)"
            }
          },
          required: ["date"]
        }
      },
      {
        name: "search_historical_law",
        description: `[연혁] 버전 목록. lawId/lawName으로 검색 → get_historical_law로 특정 버전 조회.`,
        inputSchema: {
          type: "object",
          properties: {
            lawId: {
              type: "string",
              description: "법령ID"
            },
            lawName: {
              type: "string",
              description: "법령명"
            },
            display: {
              type: "number",
              description: "결과 수 (기본:20)",
              default: 20
            },
            page: {
              type: "number",
              description: "페이지 (기본:1)",
              default: 1
            }
          },
          required: []
        }
      },
      {
        name: "get_law_system_tree",
        description: `[법령] 체계도 - 상하위법/관련법 트리 구조. lawId/mst/lawName 중 하나 필요.`,
        inputSchema: {
          type: "object",
          properties: {
            lawId: {
              type: "string",
              description: "법령ID"
            },
            mst: {
              type: "string",
              description: "법령일련번호"
            },
            lawName: {
              type: "string",
              description: "법령명"
            }
          },
          required: []
        }
      },
      // v1.6.0 - Knowledge Base APIs
      {
        name: "get_legal_term_kb",
        description: `[지식베이스] 법령용어 조회. 용어 정의/연계정보 포함. 상세 정의는 get_legal_term_detail.`,
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "검색할 법령용어" },
            display: { type: "number", description: "결과 수 (기본:20)", default: 20 },
            page: { type: "number", description: "페이지 (기본:1)", default: 1 }
          },
          required: ["query"]
        }
      },
      {
        name: "get_legal_term_detail",
        description: `[지식베이스] 법령용어 상세 정의. 정의/출처/분류 포함.`,
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "조회할 법령용어명" }
          },
          required: ["query"]
        }
      },
      {
        name: "get_daily_term",
        description: `[지식베이스] 일상용어 검색. 일상 표현→법률 용어 매핑 확인.`,
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "일상용어 (예: '월세', '뺑소니')" },
            display: { type: "number", description: "결과 수 (기본:20)", default: 20 },
            page: { type: "number", description: "페이지 (기본:1)", default: 1 }
          },
          required: ["query"]
        }
      },
      {
        name: "get_daily_to_legal",
        description: `[지식베이스] 일상용어→법령용어 연계. 예: '월세'→'임대차'.`,
        inputSchema: {
          type: "object",
          properties: {
            dailyTerm: { type: "string", description: "일상용어" }
          },
          required: ["dailyTerm"]
        }
      },
      {
        name: "get_legal_to_daily",
        description: `[지식베이스] 법령용어→일상용어 연계. 예: '임대차'→'월세', '전세'.`,
        inputSchema: {
          type: "object",
          properties: {
            legalTerm: { type: "string", description: "법령용어" }
          },
          required: ["legalTerm"]
        }
      },
      {
        name: "get_term_articles",
        description: `[지식베이스] 용어→조문 연계. 해당 용어가 사용된 법령 조문 목록.`,
        inputSchema: {
          type: "object",
          properties: {
            term: { type: "string", description: "검색할 법령용어" },
            display: { type: "number", description: "결과 수 (기본:20)", default: 20 }
          },
          required: ["term"]
        }
      },
      {
        name: "get_related_laws",
        description: `[지식베이스] 관련법령 조회. 특정 법령과 연관된 법령 목록.`,
        inputSchema: {
          type: "object",
          properties: {
            lawId: { type: "string", description: "법령ID" },
            lawName: { type: "string", description: "법령명" },
            display: { type: "number", description: "결과 수 (기본:20)", default: 20 }
          },
          required: []
        }
      }
    ]
  }
})

// CallTool 핸들러
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params

    switch (name) {
      case "search_law": {
        const input = SearchLawSchema.parse(args)
        return await searchLaw(apiClient, input)
      }

      case "get_law_text": {
        const input = GetLawTextSchema.parse(args)
        return await getLawText(apiClient, input)
      }

      case "parse_jo_code": {
        const input = ParseJoCodeSchema.parse(args)
        return await parseJoCode(input)
      }

      case "compare_old_new": {
        const input = CompareOldNewSchema.parse(args)
        return await compareOldNew(apiClient, input)
      }

      case "get_three_tier": {
        const input = GetThreeTierSchema.parse(args)
        return await getThreeTier(apiClient, input)
      }

      case "search_admin_rule": {
        const input = SearchAdminRuleSchema.parse(args)
        return await searchAdminRule(apiClient, input)
      }

      case "get_admin_rule": {
        const input = GetAdminRuleSchema.parse(args)
        return await getAdminRule(apiClient, input)
      }

      case "get_annexes": {
        const input = GetAnnexesSchema.parse(args)
        return await getAnnexes(apiClient, input)
      }

      case "get_ordinance": {
        const input = GetOrdinanceSchema.parse(args)
        return await getOrdinance(apiClient, input)
      }

      case "search_ordinance": {
        const input = SearchOrdinanceSchema.parse(args)
        return await searchOrdinance(apiClient, input)
      }

      case "compare_articles": {
        const input = CompareArticlesSchema.parse(args)
        return await compareArticles(apiClient, input)
      }

      case "get_law_tree": {
        const input = GetLawTreeSchema.parse(args)
        return await getLawTree(apiClient, input)
      }

      case "search_all": {
        const input = SearchAllSchema.parse(args)
        return await searchAll(apiClient, input)
      }

      case "suggest_law_names": {
        const input = SuggestLawNamesSchema.parse(args)
        return await suggestLawNames(apiClient, input)
      }

      case "search_precedents": {
        const input = searchPrecedentsSchema.parse(args)
        return await searchPrecedents(apiClient, input)
      }

      case "get_precedent_text": {
        const input = getPrecedentTextSchema.parse(args)
        return await getPrecedentText(apiClient, input)
      }

      case "search_interpretations": {
        const input = searchInterpretationsSchema.parse(args)
        return await searchInterpretations(apiClient, input)
      }

      case "get_interpretation_text": {
        const input = getInterpretationTextSchema.parse(args)
        return await getInterpretationText(apiClient, input)
      }

      case "get_batch_articles": {
        const input = GetBatchArticlesSchema.parse(args)
        return await getBatchArticles(apiClient, input)
      }

      case "get_article_with_precedents": {
        const input = GetArticleWithPrecedentsSchema.parse(args)
        return await getArticleWithPrecedents(apiClient, input)
      }

      case "get_article_history": {
        const input = ArticleHistorySchema.parse(args)
        return await getArticleHistory(apiClient, input)
      }

      case "get_law_history": {
        const input = LawHistorySchema.parse(args)
        return await getLawHistory(apiClient, input)
      }

      case "summarize_precedent": {
        const input = SummarizePrecedentSchema.parse(args)
        return await summarizePrecedent(apiClient, input)
      }

      case "extract_precedent_keywords": {
        const input = ExtractKeywordsSchema.parse(args)
        return await extractPrecedentKeywords(apiClient, input)
      }

      case "find_similar_precedents": {
        const input = FindSimilarPrecedentsSchema.parse(args)
        return await findSimilarPrecedents(apiClient, input)
      }

      case "get_law_statistics": {
        const input = LawStatisticsSchema.parse(args)
        return await getLawStatistics(apiClient, input)
      }

      case "parse_article_links": {
        const input = ParseArticleLinksSchema.parse(args)
        return await parseArticleLinks(apiClient, input)
      }

      case "get_external_links": {
        const input = ExternalLinksSchema.parse(args)
        return await getExternalLinks(input)
      }

      case "advanced_search": {
        const input = AdvancedSearchSchema.parse(args)
        return await advancedSearch(apiClient, input)
      }

      case "search_tax_tribunal_decisions": {
        const input = searchTaxTribunalDecisionsSchema.parse(args)
        return await searchTaxTribunalDecisions(apiClient, input)
      }

      case "get_tax_tribunal_decision_text": {
        const input = getTaxTribunalDecisionTextSchema.parse(args)
        return await getTaxTribunalDecisionText(apiClient, input)
      }

      case "search_customs_interpretations": {
        const input = searchCustomsInterpretationsSchema.parse(args)
        return await searchCustomsInterpretations(apiClient, input)
      }

      case "get_customs_interpretation_text": {
        const input = getCustomsInterpretationTextSchema.parse(args)
        return await getCustomsInterpretationText(apiClient, input)
      }

      // v1.5.0 - New API tools
      case "search_constitutional_decisions": {
        const input = searchConstitutionalDecisionsSchema.parse(args)
        return await searchConstitutionalDecisions(apiClient, input)
      }

      case "get_constitutional_decision_text": {
        const input = getConstitutionalDecisionTextSchema.parse(args)
        return await getConstitutionalDecisionText(apiClient, input)
      }

      case "search_admin_appeals": {
        const input = searchAdminAppealsSchema.parse(args)
        return await searchAdminAppeals(apiClient, input)
      }

      case "get_admin_appeal_text": {
        const input = getAdminAppealTextSchema.parse(args)
        return await getAdminAppealText(apiClient, input)
      }

      case "search_english_law": {
        const input = searchEnglishLawSchema.parse(args)
        return await searchEnglishLaw(apiClient, input)
      }

      case "get_english_law_text": {
        const input = getEnglishLawTextSchema.parse(args)
        return await getEnglishLawText(apiClient, input)
      }

      case "search_legal_terms": {
        const input = searchLegalTermsSchema.parse(args)
        return await searchLegalTerms(apiClient, input)
      }

      case "search_ai_law": {
        const input = searchAiLawSchema.parse(args)
        return await searchAiLaw(apiClient, input)
      }

      case "search_ftc_decisions": {
        const input = searchFtcDecisionsSchema.parse(args)
        return await searchFtcDecisions(apiClient, input)
      }

      case "get_ftc_decision_text": {
        const input = getFtcDecisionTextSchema.parse(args)
        return await getFtcDecisionText(apiClient, input)
      }

      case "search_pipc_decisions": {
        const input = searchPipcDecisionsSchema.parse(args)
        return await searchPipcDecisions(apiClient, input)
      }

      case "get_pipc_decision_text": {
        const input = getPipcDecisionTextSchema.parse(args)
        return await getPipcDecisionText(apiClient, input)
      }

      case "search_nlrc_decisions": {
        const input = searchNlrcDecisionsSchema.parse(args)
        return await searchNlrcDecisions(apiClient, input)
      }

      case "get_nlrc_decision_text": {
        const input = getNlrcDecisionTextSchema.parse(args)
        return await getNlrcDecisionText(apiClient, input)
      }

      case "get_historical_law": {
        const input = getHistoricalLawSchema.parse(args)
        return await getHistoricalLaw(apiClient, input)
      }

      case "search_historical_law": {
        const input = searchHistoricalLawSchema.parse(args)
        return await searchHistoricalLaw(apiClient, input)
      }

      case "get_law_system_tree": {
        const input = getLawSystemTreeSchema.parse(args)
        return await getLawSystemTree(apiClient, input)
      }

      // v1.6.0 - Knowledge Base APIs
      case "get_legal_term_kb": {
        const input = getLegalTermKBSchema.parse(args)
        return await getLegalTermKB(apiClient, input)
      }

      case "get_legal_term_detail": {
        const input = getLegalTermDetailSchema.parse(args)
        return await getLegalTermDetail(apiClient, input)
      }

      case "get_daily_term": {
        const input = getDailyTermSchema.parse(args)
        return await getDailyTerm(apiClient, input)
      }

      case "get_daily_to_legal": {
        const input = getDailyToLegalSchema.parse(args)
        return await getDailyToLegal(apiClient, input)
      }

      case "get_legal_to_daily": {
        const input = getLegalToDailySchema.parse(args)
        return await getLegalToDaily(apiClient, input)
      }

      case "get_term_articles": {
        const input = getTermArticlesSchema.parse(args)
        return await getTermArticles(apiClient, input)
      }

      case "get_related_laws": {
        const input = getRelatedLawsSchema.parse(args)
        return await getRelatedLaws(apiClient, input)
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  } catch (error) {
    if (error instanceof Error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${error.message}`,
          },
        ],
        isError: true,
      }
    }
    throw error
  }
})

// 서버 시작
async function main() {
  // CLI 인자 파싱
  const args = process.argv.slice(2)
  const modeIndex = args.indexOf("--mode")
  const portIndex = args.indexOf("--port")

  const mode = modeIndex >= 0 ? args[modeIndex + 1] : "stdio"
  const port = portIndex >= 0 ? parseInt(args[portIndex + 1]) : 3000

  if (mode === "http") {
    // HTTP 모드 (리모트 배포용) - Streamable HTTP
    console.error("Starting Korean Law MCP server in HTTP mode...")
    await startHTTPServer(server, 8000)
  } else {
    // STDIO 모드 (로컬 Claude Desktop용)
    const transport = new StdioServerTransport()
    await server.connect(transport)
    console.error("✓ Korean Law MCP server running on stdio")
    console.error("✓ API Key:", LAW_OC ? "Configured" : "✗ Missing")
  }
}

main().catch((error) => {
  console.error("Fatal error:", error)
  process.exit(1)
})
