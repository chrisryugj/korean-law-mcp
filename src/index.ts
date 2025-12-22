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
// PlayMCP 등 외부에서 apiKey를 파라미터로 전달받을 수 있도록
// 환경변수는 선택사항으로 변경 (없어도 서버 시작 가능)
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
        description: `[STEP 1] 법령 검색 - 법령명으로 lawId와 mst를 획득합니다.

사용 시점:
- 사용자가 법령명/약칭 언급 시 (예: "관세법", "화관법")
- 조문 조회 전 반드시 실행 (get_law_text에 필요한 lawId, mst 획득)

특징:
- 약칭 자동 변환 (화관법 → 화학물질관리법, 산안법 → 산업안전보건법)
- 결과에서 lawId, mst 추출 → get_law_text에 전달 필수

워크플로우:
1. search_law로 법령 검색
2. 결과에서 lawId, mst 저장
3. get_law_text(lawId="...", mst="...", jo="제X조")로 조문 조회

검색 실패 시:
1. 키워드 단순화 ("관세법 시행령" → "관세법")
2. suggest_law_names로 자동완성 시도
3. search_all로 확장 검색

예시:
- search_law(query="관세법") → lawId, mst 획득
- search_law(query="화관법") → "화학물질관리법" 자동 변환`,
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
            },
            apiKey: {
              type: "string",
              description: "법제처 API 키 (선택). https://open.law.go.kr/LSO/openApi/guideList.do 에서 발급"
            }
          },
          required: ["query"]
        }
      },
      {
        name: "get_law_text",
        description: `[STEP 2] 법령 조문 조회 - search_law로 얻은 lawId/mst로 조문 내용을 가져옵니다.

사용 시점:
- search_law 실행 후 조문 내용 필요 시
- 특정 조문(제X조) 또는 전체 법령 조회

필수 파라미터:
- mst 또는 lawId (둘 중 하나 필수, search_law에서 획득)
- jo: 조문 번호 (선택, 생략 시 전체 법령 조회)

조문 번호 형식:
- 한글: "제38조", "제10조의2" (자동으로 JO 코드로 변환됨)
- JO 코드: "003800", "001002" (6자리 숫자)

워크플로우:
1. search_law로 lawId, mst 획득
2. get_law_text(lawId="...", mst="...", jo="제X조")
3. 조문 내용 확인

에러 처리:
- "조문 없음" 에러 시:
  1. jo 파라미터 생략하고 전체 법령 조회
  2. 응답 메시지의 "💡" 섹션에서 유효한 조문 범위 확인
  3. get_batch_articles로 여러 조문 한번에 조회

예시:
- get_law_text(mst="12345", jo="제38조") → 제38조 내용
- get_law_text(lawId="001234") → 전체 법령 조회`,
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
        description: `[유틸리티] 조문 번호 양방향 변환 - 한글 ↔ JO 코드 (6자리 숫자)

사용 시점:
- 조문 번호 형식 변환 필요 시 (get_law_text는 자동 변환하므로 직접 호출 불필요)
- 디버깅이나 조문 번호 표준화 시

변환 규칙:
- to_code: "제38조" → "003800", "제10조의2" → "001002"
- to_text: "003800" → "제38조", "001002" → "제10조의2"

JO 코드 형식:
- 6자리 숫자: AAAABB (AAAA=조문번호, BB=가지번호)
- 예: 003800 (제38조), 001002 (제10조의2)

주의:
- get_law_text는 자동 변환 기능 내장 (직접 호출 불필요)
- 수동 변환 필요 시에만 사용

예시:
- parse_jo_code(joText="제38조", direction="to_code") → "003800"
- parse_jo_code(joText="001002", direction="to_text") → "제10조의2"`,
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
        description: `[분석] 신구법 대조 - 법령 개정 전후 조문 변경 내용을 비교합니다.

사용 시점:
- 법령 개정 내용 확인 필요 시
- "최근 개정 사항" 질문 시
- 특정 공포일자 기준 신구법 비교

적용 대상:
- 법률, 시행령, 시행규칙 (모든 법령)
- 자치법규에는 적용 불가

필수 파라미터:
- mst 또는 lawId (search_law에서 획득)
- ld: 공포일자 (YYYYMMDD) - 특정 개정일 기준

워크플로우:
1. search_law로 법령 검색 → lawId, mst 획득
2. get_law_history로 최근 개정일 확인
3. compare_old_new(mst="...", ld="YYYYMMDD")

대안:
- 개정일 모를 경우: get_law_history로 최근 개정일 먼저 조회
- 조문별 연혁: get_article_history 사용

예시:
- compare_old_new(mst="12345", ld="20240101")
- compare_old_new(lawId="001234", ld="20240315", ln="123")`,
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
        description: `[분석] 3단비교 - 법률 → 시행령 → 시행규칙 위임 관계를 조회합니다.

사용 시점:
- 법률의 하위 법령 연결 구조 확인 시
- "이 법의 시행령은?" 질문 시
- 조문 간 위임/인용 관계 파악 시

적용 대상:
- 법률, 시행령, 시행규칙 (3단 계층 구조를 가진 법령)
- 행정규칙, 자치법규에는 적용 불가

knd 파라미터:
- "1": 인용조문 (다른 조문을 참조하는 관계)
- "2": 위임조문 (하위 법령에 권한을 위임하는 관계) - 기본값

워크플로우:
1. search_law로 법률 검색 → lawId, mst 획득
2. get_three_tier(mst="...", knd="2")
3. 결과에서 법률-시행령-시행규칙 연결 관계 확인

관련 도구:
- get_law_tree: 트리 구조 시각화
- compare_articles: 조문 간 비교

예시:
- get_three_tier(mst="12345", knd="2") → 위임 관계 조회
- get_three_tier(lawId="001234", knd="1") → 인용 관계 조회`,
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
        description: `[행정규칙] 검색 - 훈령, 예규, 고시, 공고 등 행정규칙을 검색합니다.

사용 시점:
- 부처 내부 규정 검색 시
- "○○고시", "○○예규" 검색 시
- 법령이 아닌 행정규칙 필요 시

행정규칙 종류 (knd):
- "1": 훈령 (상급기관 → 하급기관 지시)
- "2": 예규 (행정 업무 처리 기준)
- "3": 고시 (대외 공표 사항)
- "4": 공고 (알림 사항)
- "5": 일반 (기타 행정규칙)

법령 vs 행정규칙:
- 법령: 법률, 시행령, 시행규칙 (입법 절차)
- 행정규칙: 훈령, 예규, 고시 (행정 내부 규정)
- 별표/서식은 법령에만 존재 (get_annexes는 법령 전용)

워크플로우:
1. search_admin_rule(query="○○고시", knd="3")
2. 결과에서 ID 획득
3. get_admin_rule(id="...")로 상세 내용 조회

검색 실패 시:
- 법령 검색으로 전환: search_law(query="...")
- 통합 검색: search_all(query="...")

예시:
- search_admin_rule(query="환경영향평가", knd="3") → 고시 검색
- search_admin_rule(query="업무처리규정") → 전체 행정규칙 검색`,
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
        description: `[행정규칙] 상세 조회 - search_admin_rule로 얻은 ID로 행정규칙 전문을 조회합니다.

사용 시점:
- search_admin_rule 실행 후 상세 내용 필요 시
- 특정 행정규칙의 전문 확인 시

필수 파라미터:
- id: 행정규칙ID (search_admin_rule 결과에서 획득)

워크플로우:
1. search_admin_rule(query="○○고시") → ID 획득
2. get_admin_rule(id="...")

주의:
- 행정규칙에는 조문 번호 개념 없음 (전문만 제공)
- 별표/서식은 법령에만 존재 (get_annexes 사용)

예시:
- get_admin_rule(id="12345")`,
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
        description: `[별표/서식] 조회 - 법령/행정규칙/자치법규의 별표, 서식, 부칙 첨부 자료를 조회합니다.

사용 시점:
- "별표 1", "서식 3" 등 첨부 자료 필요 시
- 법령 본문에서 "별표 참조" 언급 시
- 부칙의 별표/서식 필요 시

적용 대상 (모든 법규 지원):
- 법률, 시행령, 시행규칙 (일반 법령)
- 훈령, 예규, 고시 (행정규칙)
- 조례, 규칙 (자치법규)

knd 파라미터:
- "1": 별표 (본칙 별표)
- "2": 서식 (본칙 서식)
- "3": 부칙별표
- "4": 부칙서식
- "5": 전체 (별표+서식 모두)

필수 파라미터:
- lawName: 법령명 정식 명칭 (약칭 불가)

워크플로우:
1. search_law/search_ordinance로 정식 법령명 확인
2. get_annexes(lawName="정식법령명", knd="1")

주의:
- 법령명은 정확한 한글 명칭 사용 (약칭 인식 안 됨)
- 자치법규는 지역명 포함 ("서울특별시 환경조례")

예시:
- get_annexes(lawName="관세법", knd="1") → 관세법 별표
- get_annexes(lawName="서울특별시 환경조례", knd="2") → 서울 환경조례 서식
- get_annexes(lawName="근로기준법 시행령", knd="5") → 전체 조회`,
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
        description: `[자치법규] 조회 - 조례, 규칙 전문을 조회합니다.

사용 시점:
- search_ordinance 실행 후 상세 내용 필요 시
- 지방자치단체의 조례/규칙 확인 시

적용 대상:
- 조례: 지방의회가 제정
- 규칙: 지방자치단체장이 제정
- 법령(법률/시행령/시행규칙)과는 별개

필수 파라미터:
- ordinSeq: 자치법규 일련번호 (search_ordinance에서 획득)

워크플로우:
1. search_ordinance(query="서울 환경") → ordinSeq 획득
2. get_ordinance(ordinSeq="...")

자치법규 vs 법령:
- 자치법규: 지역 단위 법규 (조례, 규칙)
- 법령: 국가 단위 법규 (법률, 시행령, 시행규칙)
- 3단비교, 신구법대조는 법령에만 적용

예시:
- get_ordinance(ordinSeq="12345")`,
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
        description: `[자치법규] 검색 - 조례, 규칙을 지역/키워드로 검색합니다.

사용 시점:
- 지방자치단체 법규 필요 시
- "서울시 조례", "부산 환경규칙" 등 검색 시
- 지역별 법규 비교 시

검색 키워드:
- 지역명: "서울", "부산", "경기도"
- 주제: "환경", "교통", "건축"
- 복합: "서울 환경", "부산 주차"

적용 대상:
- 조례: 지방의회 제정
- 규칙: 지방자치단체장 제정

워크플로우:
1. search_ordinance(query="서울 환경")
2. 결과에서 ordinSeq 획득
3. get_ordinance(ordinSeq="...")로 전문 조회

검색 실패 시:
- 키워드 단순화 ("서울시 환경조례" → "서울 환경")
- 통합 검색: search_all(query="...")

예시:
- search_ordinance(query="서울 환경") → 서울 환경 관련 조례
- search_ordinance(query="부산") → 부산 전체 자치법규`,
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
        description: `[분석] 조문 비교 - 두 법령의 특정 조문을 병렬 비교합니다.

사용 시점:
- 유사 법령 간 조문 차이 확인 시
- "관세법 vs FTA특례법" 비교 시
- 법령별 규정 차이 분석 시

워크플로우:
1. search_law로 두 법령 검색 → 각각 lawId, mst 획득
2. compare_articles(law1={mst:"...", jo:"제38조"}, law2={mst:"...", jo:"제25조"})

예시:
- 관세법 제38조 vs FTA특례법 제25조 비교
- 근로기준법 제2조 vs 파견법 제2조 비교`,
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
        description: `[분석] 법령 트리 - 법률→시행령→시행규칙 계층 구조를 시각화합니다.

사용 시점:
- 법령 체계 전체 구조 파악 시
- "이 법의 시행령/시행규칙은?" 질문 시
- get_three_tier의 시각화 버전

워크플로우:
1. search_law로 법령 검색 → lawId, mst 획득
2. get_law_tree(mst="...")

관련 도구:
- get_three_tier: 상세 위임 관계 (데이터)
- get_law_tree: 트리 구조 (시각화)

예시:
- get_law_tree(mst="12345")`,
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
        description: `[통합검색] 법령/행정규칙/자치법규를 한번에 검색합니다.

사용 시점:
- 검색 대상 유형 불명확 시
- 여러 유형 동시 검색 필요 시
- 초기 탐색 단계

검색 범위:
1. 법령 (법률, 시행령, 시행규칙)
2. 행정규칙 (훈령, 예규, 고시)
3. 자치법규 (조례, 규칙)

워크플로우:
1. search_all(query="환경") → 전체 검색
2. 결과에서 유형별로 분류
3. 특정 유형 상세 검색:
   - search_law: 법령만
   - search_admin_rule: 행정규칙만
   - search_ordinance: 자치법규만

검색 실패 시:
- 키워드 변경 후 재시도
- 특정 유형 검색으로 전환

예시:
- search_all(query="환경", maxResults=5) → 유형별 5개씩`,
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
        description: `[유틸리티] 법령명 자동완성 - 부분 입력으로 법령 목록 제안합니다.

사용 시점:
- 법령명 불확실 시
- search_law 실패 후 대안

워크플로우:
1. suggest_law_names(partial="관세") → 제안 목록
2. 정확한 법령명 선택
3. search_law(query="선택한 법령명")

예시:
- suggest_law_names(partial="관세") → "관세법", "관세법 시행령" 등`,
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
        description: `[판례] 검색 - 법원 판례를 키워드/법원명/사건번호로 검색합니다.

사용 시점:
- 법원 판결 검색 필요 시
- 특정 법령의 적용 사례 확인 시
- 사건번호로 판례 조회 시

검색 파라미터 (모두 선택):
- query: 키워드 (예: "자동차", "담보권")
- court: 법원명 필터 (예: "대법원", "서울고등법원")
- caseNumber: 사건번호 (예: "2009느합133")

판례 vs 법령해석례:
- 판례: 법원의 재판 결과 (search_precedents)
- 법령해석례: 행정기관의 법령 해석 (search_interpretations)

워크플로우:
1. search_precedents(query="자동차", court="대법원")
2. 결과에서 판례일련번호 획득
3. get_precedent_text(id="...")로 전문 조회

검색 실패 시:
1. 키워드 단순화 (복합 키워드 → 단일 키워드)
2. 법령해석례 검색: search_interpretations
3. 법령 검색: search_law

분석 도구:
- summarize_precedent: 판례 요약
- extract_precedent_keywords: 키워드 추출
- find_similar_precedents: 유사 판례 검색

예시:
- search_precedents(query="자동차") → 키워드 검색
- search_precedents(caseNumber="2009느합133") → 사건번호 검색
- search_precedents(query="부가세", court="대법원") → 필터링 검색`,
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
        description: `[판례] 전문 조회 - search_precedents로 얻은 ID로 판례 전문을 조회합니다.

사용 시점:
- search_precedents 실행 후 판례 상세 내용 필요 시

필수 파라미터:
- id: 판례일련번호 (search_precedents에서 획득)

응답 내용:
- 판시사항, 판결요지, 참조조문, 참조판례, 전문

워크플로우:
1. search_precedents(query="...") → 판례일련번호 획득
2. get_precedent_text(id="...")

분석 도구:
- summarize_precedent(id="..."): 판례 요약
- extract_precedent_keywords(id="..."): 키워드 추출

예시:
- get_precedent_text(id="12345")`,
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
        description: `[법령해석례] 검색 - 행정기관의 법령 해석 사례를 검색합니다.

사용 시점:
- 법령 적용 방법 확인 필요 시
- 행정기관의 공식 해석 필요 시
- 판례 검색 실패 시 대안

법령해석례 vs 판례:
- 법령해석례: 행정기관(법제처 등)의 법령 해석
- 판례: 법원의 재판 결과
- 조세심판 재결례: search_tax_tribunal_decisions
- 관세청 해석: search_customs_interpretations

워크플로우:
1. search_interpretations(query="자동차")
2. 결과에서 일련번호 획득
3. get_interpretation_text(id="...")로 전문 조회

검색 실패 시:
1. 키워드 단순화
2. 판례 검색: search_precedents
3. 법령 검색: search_law

전문 분야별:
- 조세 관련: search_tax_tribunal_decisions
- 관세 관련: search_customs_interpretations
- 일반 법령: search_interpretations

예시:
- search_interpretations(query="근로기준법")
- search_interpretations(query="환경", display=10)`,
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
        description: `[법령해석례] 전문 조회 - search_interpretations로 얻은 ID로 해석례 전문을 조회합니다.

사용 시점:
- search_interpretations 실행 후 상세 내용 필요 시

필수 파라미터:
- id: 법령해석례일련번호 (search_interpretations에서 획득)

워크플로우:
1. search_interpretations(query="...") → 일련번호 획득
2. get_interpretation_text(id="...")

예시:
- get_interpretation_text(id="12345")`,
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
        description: `[배치 조회] 여러 조문 한번에 조회 - 전문 가져온 후 지정 조문만 추출합니다.

사용 시점:
- 여러 조문 동시 확인 필요 시
- 조문 범위 조회 시 (제38조~제42조)
- get_law_text 반복 호출 대체

워크플로우:
1. search_law로 lawId, mst 획득
2. get_batch_articles(mst="...", articles=["제38조", "제39조", "제40조"])

주의:
- 조문 번호 배열 필수
- 한글 형식 사용 ("제38조")

예시:
- get_batch_articles(mst="12345", articles=["제38조", "제39조"])`,
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
        description: `[통합 조회] 조문+판례 통합 조회 - 조문 내용과 관련 판례를 한번에 가져옵니다.

사용 시점:
- 조문 해석과 적용 사례 동시 확인 시
- 법률 실무에서 조문+판례 세트 필요 시

워크플로우:
1. search_law로 lawId, mst 획득
2. get_article_with_precedents(mst="...", jo="제38조")
3. 조문 내용 + 관련 판례 동시 응답

대안:
- 조문만: get_law_text
- 판례만: search_precedents

예시:
- get_article_with_precedents(mst="12345", jo="제38조")
- get_article_with_precedents(lawId="001234", jo="제10조", includePrecedents=false)`,
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
        description: `[고급] 조문 연혁 - 특정 조문의 개정 이력을 시간 순으로 조회합니다.

사용 시점:
- 조문이 어떻게 변경되어 왔는지 확인 시
- 특정 기간 동안의 조문 변화 추적 시

파라미터 (모두 선택):
- lawId: 법령ID
- jo: 조문번호 (예: "제38조")
- regDt: 특정 개정일
- fromRegDt ~ toRegDt: 기간 검색

관련 도구:
- compare_old_new: 신구법 대조 (특정 개정일 기준)
- get_law_history: 법령 전체 개정 이력

예시:
- get_article_history(lawId="001234", jo="제38조")
- get_article_history(fromRegDt="20230101", toRegDt="20231231")`,
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
        description: `[고급] 법령 변경 이력 - 특정 날짜에 개정된 법령 목록을 조회합니다.

사용 시점:
- "2024년 1월 1일에 개정된 법령은?" 질문 시
- 특정 날짜 기준 법령 변경 현황 파악 시
- 법령 개정 트렌드 분석 시

필수 파라미터:
- regDt: 법령 변경일자 (YYYYMMDD)

관련 도구:
- get_article_history: 조문별 연혁
- get_law_statistics: 통계 분석

예시:
- get_law_history(regDt="20240101") → 2024.1.1 개정 법령 목록
- get_law_history(regDt="20240101", org="기획재정부")`,
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
        description: `[판례 분석] 요약 - 판례의 핵심 내용(판시사항, 판결요지, 주문)을 요약합니다.

사용 시점:
- 긴 판례 빠르게 파악 시
- 판례 핵심만 확인 필요 시

필수 파라미터:
- id: 판례일련번호 (search_precedents에서 획득)

워크플로우:
1. search_precedents → 판례일련번호 획득
2. summarize_precedent(id="...")

대안:
- get_precedent_text: 전문 조회

예시:
- summarize_precedent(id="12345", maxLength=300)`,
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
        description: `[판례 분석] 키워드 추출 - 판례에서 법률 용어, 조문 번호 등 핵심 키워드를 추출합니다.

사용 시점:
- 판례 주제 파악 시
- 유사 판례 검색 전 키워드 확인 시

필수 파라미터:
- id: 판례일련번호

워크플로우:
1. search_precedents → 판례일련번호 획득
2. extract_precedent_keywords(id="...")
3. 추출된 키워드로 find_similar_precedents 실행

예시:
- extract_precedent_keywords(id="12345", maxKeywords=10)`,
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
        description: `[판례 분석] 유사 판례 검색 - 키워드 기반 유사도로 관련 판례를 찾습니다.

사용 시점:
- 비슷한 사건 판례 필요 시
- 판례 간 비교 분석 시

워크플로우:
1. find_similar_precedents(query="자동차 사고")
2. 결과에서 판례일련번호 획득
3. get_precedent_text로 상세 확인

관련 도구:
- search_precedents: 일반 검색
- extract_precedent_keywords: 키워드 추출

예시:
- find_similar_precedents(query="자동차 사고", maxResults=5)`,
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
        description: `[통계] 법령 통계 - 최근 개정, 부처별, 연도별 법령 통계를 제공합니다.

사용 시점:
- 법령 개정 트렌드 분석 시
- "최근 30일 개정 법령" 질문 시
- 부처별/연도별 법령 현황 파악 시

analysisType:
- "recent_changes": 최근 N일 개정 법령
- "by_department": 소관부처별 통계
- "by_year": 제정연도별 통계

예시:
- get_law_statistics(analysisType="recent_changes", days=30)
- get_law_statistics(analysisType="by_department", limit=10)`,
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
        description: `[유틸리티] 조문 참조 파싱 - 조문 내 다른 조문 참조("제X조", "같은 조", "전항")를 자동 인식합니다.

사용 시점:
- 조문 내 참조 관계 파악 시
- 조문 간 연결 구조 확인 시

필수 파라미터:
- jo: 조문 번호

워크플로우:
1. get_law_text로 조문 조회
2. parse_article_links(jo="제38조")로 참조 분석

예시:
- parse_article_links(mst="12345", jo="제38조")`,
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
        description: `[유틸리티] 외부 링크 생성 - 법제처, 법원도서관 등 공식 사이트 링크를 생성합니다.

사용 시점:
- 공식 사이트 참조 필요 시
- 브라우저에서 직접 확인 시

linkType:
- "law": 법령 (법제처)
- "precedent": 판례 (법원도서관)
- "interpretation": 법령해석례 (법제처)

예시:
- get_external_links(linkType="law", lawId="001234")
- get_external_links(linkType="precedent", precedentId="12345")`,
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
        description: `[고급 검색] 필터링 검색 - 기간, 부처, AND/OR 연산자로 정밀 검색합니다.

사용 시점:
- 복합 조건 검색 필요 시
- 특정 기간 내 법령 필요 시
- 특정 부처 법령만 검색 시

필터 옵션:
- fromDate ~ toDate: 제정일 기간
- org: 소관부처코드
- operator: "AND" (모든 키워드 포함) / "OR" (하나라도 포함)
- searchType: law/admin_rule/ordinance/all

워크플로우:
1. advanced_search(query="환경 보호", fromDate="20230101", toDate="20231231")
2. 결과 확인
3. 특정 법령 상세 조회

대안:
- 단순 검색: search_law, search_all
- 자동완성: suggest_law_names

예시:
- advanced_search(query="환경", fromDate="20230101", toDate="20231231")
- advanced_search(query="교통 안전", operator="AND", searchType="law")`,
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
        description: `[조세심판] 재결례 검색 - 조세심판원의 특별행정심판 재결례를 검색합니다.

사용 시점:
- 조세 관련 분쟁 사례 필요 시
- 국세/지방세 심판 결정 확인 시
- 세무 법령 적용 사례 필요 시

검색 파라미터 (모두 선택):
- query: 키워드 (예: "부가가치세", "법인세")
- cls: 재결구분코드
- dpaYd: 처분일자 범위 (YYYYMMDD~YYYYMMDD)
- rslYd: 의결일자 범위 (YYYYMMDD~YYYYMMDD)

관련 분야:
- 조세: search_tax_tribunal_decisions (이 도구)
- 관세: search_customs_interpretations
- 일반 법령해석: search_interpretations

워크플로우:
1. search_tax_tribunal_decisions(query="부가가치세")
2. 결과에서 재결례일련번호 획득
3. get_tax_tribunal_decision_text(id="...")로 전문 조회

예시:
- search_tax_tribunal_decisions(query="부가가치세")
- search_tax_tribunal_decisions(query="법인세", rslYd="20230101~20231231")`,
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
        description: `[조세심판] 재결례 전문 조회 - search_tax_tribunal_decisions로 얻은 ID로 재결례 전문을 조회합니다.

사용 시점:
- search_tax_tribunal_decisions 실행 후 상세 내용 필요 시

필수 파라미터:
- id: 재결례일련번호 (search_tax_tribunal_decisions에서 획득)

워크플로우:
1. search_tax_tribunal_decisions(query="...") → 재결례일련번호 획득
2. get_tax_tribunal_decision_text(id="...")

예시:
- get_tax_tribunal_decision_text(id="12345")`,
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
        description: `[관세청] 법령해석 검색 - 관세청의 법령 해석 사례를 검색합니다.

사용 시점:
- 관세 관련 법령 적용 방법 확인 시
- 관세청 공식 해석 필요 시
- FTA, 원산지, 관세평가 등 관세 특화 사항 시

검색 파라미터 (모두 선택):
- query: 키워드 (예: "거래명세서", "원산지")
- inq: 질의기관코드
- rpl: 해석기관코드
- explYd: 해석일자 범위 (YYYYMMDD~YYYYMMDD)

관련 분야:
- 조세: search_tax_tribunal_decisions
- 관세: search_customs_interpretations (이 도구)
- 일반 법령해석: search_interpretations

워크플로우:
1. search_customs_interpretations(query="원산지")
2. 결과에서 해석일련번호 획득
3. get_customs_interpretation_text(id="...")로 전문 조회

예시:
- search_customs_interpretations(query="거래명세서")
- search_customs_interpretations(query="FTA", explYd="20230101~20231231")`,
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
        description: `[관세청] 법령해석 전문 조회 - search_customs_interpretations로 얻은 ID로 해석 전문을 조회합니다.

사용 시점:
- search_customs_interpretations 실행 후 상세 내용 필요 시

필수 파라미터:
- id: 법령해석일련번호 (search_customs_interpretations에서 획득)

워크플로우:
1. search_customs_interpretations(query="...") → 해석일련번호 획득
2. get_customs_interpretation_text(id="...")

예시:
- get_customs_interpretation_text(id="12345")`,
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
