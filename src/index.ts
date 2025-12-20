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
import { startHTTPServer } from "./server/http-server.js"

// API 클라이언트 초기화
const LAW_OC = process.env.LAW_OC || ""
const apiClient = new LawApiClient({ apiKey: LAW_OC })

// MCP 서버 생성
const server = new Server(
  {
    name: "korean-law",
    version: "1.3.0",
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
        description: "한국 법령을 검색합니다. 법령명 약칭도 자동으로 인식합니다 (예: '화관법' → '화학물질관리법')",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "검색할 법령명 (예: '관세법', 'fta특례법', '화관법')"
            },
            maxResults: {
              type: "number",
              description: "최대 결과 개수 (기본값: 20)",
              default: 20
            }
          },
          required: ["query"]
        }
      },
      {
        name: "get_law_text",
        description: "법령의 조문 전문을 조회합니다. 조문 번호는 한글('제38조') 또는 JO 코드('003800') 모두 사용 가능합니다.",
        inputSchema: {
          type: "object",
          properties: {
            mst: {
              type: "string",
              description: "법령일련번호 (search_law에서 획득)"
            },
            lawId: {
              type: "string",
              description: "법령ID (search_law에서 획득)"
            },
            jo: {
              type: "string",
              description: "조문 번호 (예: '제38조' 또는 '003800')"
            },
            efYd: {
              type: "string",
              description: "시행일자 (YYYYMMDD 형식)"
            }
          },
          required: []
        }
      },
      {
        name: "parse_jo_code",
        description: "조문 번호를 JO 코드와 한글 간 양방향 변환합니다 (예: '제38조' ↔ '003800')",
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
        description: "법령의 신구법 대조 (개정 전후 비교)를 조회합니다.",
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
        description: "법령의 3단비교 (법률→시행령→시행규칙 위임 관계)를 조회합니다.",
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
        description: "행정규칙(훈령, 예규, 고시 등)을 검색합니다.",
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
              description: "최대 결과 개수 (기본값: 20)",
              default: 20
            }
          },
          required: ["query"]
        }
      },
      {
        name: "get_admin_rule",
        description: "행정규칙의 상세 내용을 조회합니다.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "행정규칙ID (search_admin_rule에서 획득)"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "get_annexes",
        description: "법령의 별표 및 서식을 조회합니다.",
        inputSchema: {
          type: "object",
          properties: {
            lawName: {
              type: "string",
              description: "법령명 (예: '관세법')"
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
        description: "자치법규(조례, 규칙)를 조회합니다.",
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
        description: "자치법규(조례, 규칙)를 검색합니다. 지역별, 키워드별로 검색 가능합니다.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "검색할 자치법규명 (예: '서울', '환경')"
            },
            display: {
              type: "number",
              description: "페이지당 결과 개수 (기본값: 20, 최대: 100)",
              default: 20
            }
          },
          required: ["query"]
        }
      },
      {
        name: "compare_articles",
        description: "두 법령의 특정 조문을 비교합니다. 법률 실무에서 유용하게 사용할 수 있습니다.",
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
                  description: "조문 번호 (예: '제38조')"
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
                  description: "조문 번호 (예: '제25조')"
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
        description: "법령의 트리 구조를 시각화합니다. 법률→시행령→시행규칙의 계층 관계를 보여줍니다.",
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
        description: "법령, 행정규칙, 자치법규를 한번에 통합 검색합니다. 여러 유형의 법령을 동시에 찾고 싶을 때 사용합니다.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "검색할 키워드"
            },
            maxResults: {
              type: "number",
              description: "각 유형별 최대 결과 개수 (기본값: 10)",
              default: 10
            }
          },
          required: ["query"]
        }
      },
      {
        name: "suggest_law_names",
        description: "법령명 자동완성 제안. 부분 입력된 법령명으로 가능한 법령 목록을 제안합니다.",
        inputSchema: {
          type: "object",
          properties: {
            partial: {
              type: "string",
              description: "부분 입력된 법령명 (예: '관세', '환경')"
            }
          },
          required: ["partial"]
        }
      },
      {
        name: "search_precedents",
        description: "판례를 검색합니다. 키워드, 법원명, 사건번호로 검색 가능합니다.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "검색 키워드 (예: '자동차', '담보권')"
            },
            court: {
              type: "string",
              description: "법원명 필터 (예: '대법원', '서울고등법원')"
            },
            caseNumber: {
              type: "string",
              description: "사건번호 (예: '2009느합133')"
            },
            display: {
              type: "number",
              description: "페이지당 결과 개수 (기본값: 20, 최대: 100)",
              default: 20
            },
            page: {
              type: "number",
              description: "페이지 번호 (기본값: 1)",
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
        description: "판례의 전문을 조회합니다.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "판례일련번호 (search_precedents에서 획득)"
            },
            caseName: {
              type: "string",
              description: "판례명 (선택사항, 검증용)"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "search_interpretations",
        description: "법령해석례를 검색합니다.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "검색 키워드 (예: '자동차', '근로기준법')"
            },
            display: {
              type: "number",
              description: "페이지당 결과 개수 (기본값: 20, 최대: 100)",
              default: 20
            },
            page: {
              type: "number",
              description: "페이지 번호 (기본값: 1)",
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
        description: "법령해석례의 전문을 조회합니다.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "법령해석례일련번호 (search_interpretations에서 획득)"
            },
            caseName: {
              type: "string",
              description: "안건명 (선택사항, 검증용)"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "get_batch_articles",
        description: "여러 조문을 한번에 조회합니다. 법령 전문을 가져온 뒤 지정한 조문들만 추출합니다.",
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
              description: "조문 번호 배열 (예: ['제38조', '제39조', '제40조'])"
            },
            efYd: {
              type: "string",
              description: "시행일자 (YYYYMMDD 형식)"
            }
          },
          required: ["articles"]
        }
      },
      {
        name: "get_article_with_precedents",
        description: "조문 조회와 함께 관련 판례를 자동으로 조회합니다. 법률 실무에서 조문의 해석과 적용례를 함께 확인할 때 유용합니다.",
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
              description: "조문 번호 (예: '제38조')"
            },
            efYd: {
              type: "string",
              description: "시행일자 (YYYYMMDD 형식)"
            },
            includePrecedents: {
              type: "boolean",
              description: "관련 판례 포함 여부 (기본값: true)",
              default: true
            }
          },
          required: ["jo"]
        }
      },
      {
        name: "get_article_history",
        description: "일자별 조문 개정 이력을 조회합니다. 특정 조문의 시간에 따른 변화를 추적할 때 유용합니다.",
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
              description: "페이지 번호 (기본값: 1)",
              default: 1
            }
          },
          required: []
        }
      },
      {
        name: "get_law_history",
        description: "특정 날짜에 변경된 법령의 이력을 조회합니다. 법령 개정 트렌드 분석에 유용합니다.",
        inputSchema: {
          type: "object",
          properties: {
            regDt: {
              type: "string",
              description: "법령 변경일자 (YYYYMMDD, 예: '20240101')"
            },
            org: {
              type: "string",
              description: "소관부처코드 (선택)"
            },
            display: {
              type: "number",
              description: "결과 개수 (기본값: 20, 최대: 100)",
              default: 20
            },
            page: {
              type: "number",
              description: "페이지 번호 (기본값: 1)",
              default: 1
            }
          },
          required: ["regDt"]
        }
      },
      {
        name: "summarize_precedent",
        description: "판례를 요약합니다. 판시사항, 판결요지, 주문 등 핵심 내용을 추출합니다.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "판례일련번호"
            },
            maxLength: {
              type: "number",
              description: "요약 최대 길이 (기본값: 500자)",
              default: 500
            }
          },
          required: ["id"]
        }
      },
      {
        name: "extract_precedent_keywords",
        description: "판례에서 핵심 키워드를 추출합니다. 법률 용어, 조문 번호 등을 빈도 기반으로 추출합니다.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "판례일련번호"
            },
            maxKeywords: {
              type: "number",
              description: "최대 키워드 개수 (기본값: 10)",
              default: 10
            }
          },
          required: ["id"]
        }
      },
      {
        name: "find_similar_precedents",
        description: "유사 판례를 검색합니다. 키워드 기반 유사도 계산으로 관련 판례를 찾습니다.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "검색 키워드 또는 판례 내용"
            },
            maxResults: {
              type: "number",
              description: "최대 결과 개수 (기본값: 5)",
              default: 5
            }
          },
          required: ["query"]
        }
      },
      {
        name: "get_law_statistics",
        description: "법령 통계를 조회합니다. 최근 개정 법령, 소관부처별/연도별 통계를 제공합니다.",
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
              description: "결과 개수 제한 (기본값: 10)",
              default: 10
            }
          },
          required: ["analysisType"]
        }
      },
      {
        name: "parse_article_links",
        description: "조문 내 다른 조문 참조를 파싱합니다. '제X조', '같은 조', '전항' 등을 자동 인식합니다.",
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
              description: "조문 번호 (예: '제38조')"
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
        description: "법령, 판례, 해석례의 외부 링크를 생성합니다 (법제처, 법원도서관 등).",
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
        description: "고급 검색 기능. 기간 필터링, 소관부처 필터링, AND/OR 복합 검색을 지원합니다.",
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
              description: "최대 결과 개수 (기본값: 20)",
              default: 20
            }
          },
          required: ["query"]
        }
      },
      {
        name: "search_tax_tribunal_decisions",
        description: "조세심판원 특별행정심판재결례를 검색합니다. 키워드, 재결구분, 일자별로 검색 가능합니다.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "검색 키워드 (예: '자동차', '부가가치세')"
            },
            display: {
              type: "number",
              description: "페이지당 결과 개수 (기본값: 20, 최대: 100)",
              default: 20
            },
            page: {
              type: "number",
              description: "페이지 번호 (기본값: 1)",
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
        description: "조세심판원 재결례의 전문을 조회합니다.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "특별행정심판재결례일련번호 (search_tax_tribunal_decisions에서 획득)"
            },
            decisionName: {
              type: "string",
              description: "재결례명 (선택사항, 검증용)"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "search_customs_interpretations",
        description: "관세청 법령해석을 검색합니다. 키워드, 질의기관, 해석기관별로 검색 가능합니다.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "검색 키워드 (예: '거래명세서', '세금')"
            },
            display: {
              type: "number",
              description: "페이지당 결과 개수 (기본값: 20, 최대: 100)",
              default: 20
            },
            page: {
              type: "number",
              description: "페이지 번호 (기본값: 1)",
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
        description: "관세청 법령해석의 전문을 조회합니다.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "법령해석일련번호 (search_customs_interpretations에서 획득)"
            },
            interpretationName: {
              type: "string",
              description: "해석명 (선택사항, 검증용)"
            }
          },
          required: ["id"]
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
