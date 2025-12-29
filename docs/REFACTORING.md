# Korean Law MCP Server 리팩토링 가이드

## 진행 상황 요약

| Phase | 작업 | 상태 |
|-------|------|------|
| 1.1 | fetch-with-retry.ts 생성 | ✅ 완료 |
| 1.2 | api-client.ts에 fetchWithRetry 적용 | ✅ 완료 |
| 1.3 | http-server.ts 세션 관리 개선 | ✅ 완료 |
| 2.1 | types.ts에 McpTool 인터페이스 | ✅ 완료 |
| 2.2 | tool-registry.ts 생성 | ✅ 완료 |
| 2.3 | index.ts 간소화 (1,761→55줄) | ✅ 완료 |
| 3.1 | xml-parser.ts 생성 | ✅ 완료 |
| 3.2 | 주요 도구 XML 파싱 리팩토링 | ✅ 완료 |
| 3.3 | knowledge-base.ts 분리 (641→520줄) | ✅ 완료 |
| 3.4 | Schema 검증 보완 | ❌ 대기 |
| 4.1 | errors.ts 생성 | ✅ 완료 |
| 4.2 | schemas.ts 생성 (날짜/응답크기) | ✅ 완료 |
| 4.3 | 남은 6개 도구 XML 리팩토링 | ❌ 선택적 |

---

## Phase 1: Critical Runtime Fixes (✅ 완료)

### 1.1 fetch-with-retry.ts
**파일**: `src/lib/fetch-with-retry.ts`

```typescript
// 주요 기능
- 타임아웃: 30초 (기본값)
- 재시도: 3회 (429, 503, 504 상태코드)
- Exponential backoff
```

### 1.2 api-client.ts 수정
**파일**: `src/lib/api-client.ts`

```diff
+ import { fetchWithRetry } from "./fetch-with-retry.js"
+ import { currentSessionId, getSessionApiKey } from "./session-state.js"

- const response = await fetch(url)
+ const response = await fetchWithRetry(url)
```

### 1.3 세션 관리 개선
**파일**: `src/server/http-server.ts`, `src/lib/session-state.ts`

```typescript
// session-state.ts - 세션 상태 관리 (순환 의존성 방지)
export let currentSessionId: string | undefined
export function setCurrentSessionId(sessionId: string | undefined)
export function setSessionApiKey(sessionId: string, apiKey: string)
export function getSessionApiKey(sessionId: string): string | undefined
export function deleteSession(sessionId: string)

// http-server.ts - 세션 정리
- process.env.LAW_OC = apiKeyFromHeader  // 제거됨 (race condition)
+ setSessionApiKey(sessionId, apiKeyFromHeader)  // 세션별 API 키

// 30분 idle 세션 자동 정리
setInterval(() => {
  for (const [sessionId, session] of sessions) {
    if (now - session.lastAccess > 30 * 60 * 1000) {
      session.transport.close()
      sessions.delete(sessionId)
      deleteSession(sessionId)
    }
  }
}, 5 * 60 * 1000)
```

---

## Phase 2: 아키텍처 리팩토링 (✅ 완료)

### 2.1 McpTool 인터페이스
**파일**: `src/lib/types.ts`

```typescript
export interface ToolResponse {
  content: Array<{ type: string; text: string }>
  isError?: boolean
}

export interface McpTool {
  name: string
  description: string
  schema: z.ZodSchema
  handler: (apiClient: LawApiClient, input: any) => Promise<ToolResponse>
}
```

### 2.2 tool-registry.ts
**파일**: `src/tool-registry.ts` (~470줄)

```typescript
// 모든 도구 정의
export const allTools: McpTool[] = [
  { name: "search_law", description: "...", schema: SearchLawSchema, handler: searchLaw },
  // ... 58개 도구
]

// 서버에 등록
export function registerTools(server: Server, apiClient: LawApiClient) {
  server.setRequestHandler(ListToolsRequestSchema, ...)
  server.setRequestHandler(CallToolRequestSchema, ...)
}
```

### 2.3 index.ts 간소화
**파일**: `src/index.ts` (1,761줄 → 55줄, **-97%**)

```typescript
import { registerTools } from "./tool-registry.js"

const server = new Server({ name: "korean-law", version: "1.6.0" }, ...)
registerTools(server, apiClient)

// 서버 시작 로직만 남음
```

---

## Phase 3: 코드 통합 (✅ 완료)

### 3.1 xml-parser.ts (✅ 완료)
**파일**: `src/lib/xml-parser.ts`

```typescript
// 공통 XML 파싱 유틸리티
export function extractTag(content: string, tag: string): string
export function parseSearchXML<T>(xml, rootTag, itemTag, fieldExtractor): {totalCnt, page, items}

// 도메인별 파서 (6개)
export function parsePrecedentXML(xml: string)       // 판례 (PrecSearch/prec)
export function parseInterpretationXML(xml: string)  // 해석례 (Expc/expc)
export function parseAdminAppealXML(xml: string)     // 행정심판 (Decc/decc)
export function parseConstitutionalXML(xml: string)  // 헌재결정 (DetcSearch/Detc)
export function parseTaxTribunalXML(xml: string)     // 조세심판 (Decc/decc)
export function parseCustomsXML(xml: string)         // 관세해석 (CgmExpc/cgmExpc)
```

### 3.2 도구별 XML 파싱 리팩토링 (✅ 완료)
**완료된 파일** (5개):
- ✅ `precedents.ts` - 281→226줄 (-20%)
- ✅ `interpretations.ts` - 로컬 함수 제거
- ✅ `admin-appeals.ts` - 257→201줄 (-22%)
- ✅ `constitutional-decisions.ts` - 253→201줄 (-21%)
- ✅ `tax-tribunal-decisions.ts` - 290→230줄 (-21%)

**남은 파일** (6개, 선택적 - 각각 200줄 미만):
- `customs-interpretations.ts` - CgmExpc/cgmExpc 고유 구조
- `committee-decisions.ts` - 3개 위원회별 구조
- `legal-terms.ts`, `life-law.ts`, `ordinance-search.ts`, `english-law.ts`

### 3.3 knowledge-base.ts 분리 (✅ 완료)
**변경**: 641줄 → 520줄 (-19%)

**생성된 파일**:
- `src/tools/kb-utils.ts` - 공통 헬퍼 (extractTag, parseKBXML, fallbackTermSearch)

**적용된 변경**:
- knowledge-base.ts에서 kb-utils.ts import
- 중복 코드 제거

### 3.4 Schema 검증 보완 (❌ 대기)
**대상**: 선택적 필수 조합이 있는 스키마들

```typescript
// article-history.ts - refine 추가 필요
export const ArticleHistorySchema = z.object({
  lawId: z.string().optional(),
  lawName: z.string().optional(),
  fromRegDt: z.string().optional(),
}).refine(
  data => data.lawId || data.lawName || data.fromRegDt,
  { message: "lawId, lawName, fromRegDt 중 하나는 필수" }
)
```

---

## Phase 4: Production Hardening (✅ 완료)

### 4.1 errors.ts (✅ 완료)
**파일**: `src/lib/errors.ts`

```typescript
export class LawApiError extends Error {
  code: ErrorCode
  suggestions: string[]
  format(): string  // 사용자 친화적 포맷
}

export const ErrorCodes = {
  NOT_FOUND: 'LAW_NOT_FOUND',
  INVALID_PARAM: 'INVALID_PARAMETER',
  API_ERROR: 'EXTERNAL_API_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  TIMEOUT: 'REQUEST_TIMEOUT',
  PARSE_ERROR: 'PARSE_ERROR'
}

export function formatToolError(error: unknown, context?: string): ToolResponse
export function notFoundError(lawName: string, suggestions?: string[]): LawApiError
export function apiError(status: number, endpoint?: string): LawApiError
export function invalidParamError(param: string, expected: string): LawApiError
```

### 4.2 schemas.ts (✅ 완료)
**파일**: `src/lib/schemas.ts`

```typescript
// 날짜 검증 (YYYYMMDD, 윤년 지원)
export const dateSchema = z.string()
  .regex(/^\d{8}$/, "날짜 형식: YYYYMMDD")
  .refine(isValidDate, "유효하지 않은 날짜")

export const optionalDateSchema = dateSchema.optional()
export const paginationSchema = z.object({ display, page })

// 응답 크기 제한
export const MAX_RESPONSE_SIZE = 50000
export function truncateResponse(text: string, maxSize?: number): string
```

### 4.3 응답 크기 제한 전역 적용 (❌ 대기)
**현재**: `law-text.ts`만 적용

**계획**: 모든 전문 조회 도구에 `truncateResponse()` 적용
- get_precedent_text, get_interpretation_text
- get_admin_appeal_text, get_constitutional_decision_text
- 등

---

## 변경된 파일 목록

### 신규 파일
| 파일 | 줄 수 | 설명 |
|------|-------|------|
| `src/lib/fetch-with-retry.ts` | ~80 | 재시도/타임아웃 |
| `src/lib/session-state.ts` | ~25 | 세션 상태 관리 |
| `src/lib/xml-parser.ts` | ~200 | 공통 XML 파싱 (6개 파서) |
| `src/lib/errors.ts` | ~110 | 에러 표준화 |
| `src/lib/schemas.ts` | ~65 | 날짜/응답크기 검증 |
| `src/tool-registry.ts` | ~470 | 도구 등록 |
| `src/tools/kb-utils.ts` | ~150 | KB 공통 유틸 |

### 수정된 파일
| 파일 | 변경 | 설명 |
|------|------|------|
| `src/index.ts` | 1,761→55줄 | -97% |
| `src/lib/api-client.ts` | +15줄 | fetchWithRetry, 세션 API 키 |
| `src/lib/types.ts` | +18줄 | McpTool 인터페이스 |
| `src/server/http-server.ts` | ~50줄 변경 | 세션 관리 개선 |
| `src/tools/precedents.ts` | 281→226줄 | -20%, 공통 파서 |
| `src/tools/admin-appeals.ts` | 257→201줄 | -22%, 공통 파서 |
| `src/tools/constitutional-decisions.ts` | 253→201줄 | -21%, 공통 파서 |
| `src/tools/tax-tribunal-decisions.ts` | 290→230줄 | -21%, 공통 파서 |
| `src/tools/knowledge-base.ts` | 641→520줄 | -19%, kb-utils 분리 |

---

## 남은 작업 (선택적)

### 우선순위
1. **Phase 3.4** - Schema 검증 보완 (refine 추가)
2. **Phase 4.3** - 응답 크기 제한 전역 적용
3. **남은 6개 도구** - XML 파싱 리팩토링 (각각 200줄 미만이라 급하지 않음)

### 제약 조건
- **수정 금지**: `search-normalizer.ts`, `law-parser.ts` (LexDiff 코드)
- **파일 크기**: 200줄 미만 유지
- **Zod 스키마**: 모든 도구에 필수
