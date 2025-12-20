# Korean Law MCP - 개발자 가이드

> **v1.3.0** | 기여자를 위한 개발 가이드

이 문서는 Korean Law MCP Server에 기여하고자 하는 개발자를 위한 가이드입니다.

---

## 목차

1. [개발 환경 설정](#개발-환경-설정)
2. [프로젝트 구조](#프로젝트-구조)
3. [개발 워크플로우](#개발-워크플로우)
4. [새 도구 추가하기](#새-도구-추가하기)
5. [테스트 작성](#테스트-작성)
6. [코드 스타일](#코드-스타일)
7. [디버깅](#디버깅)
8. [배포](#배포)
9. [기여 가이드라인](#기여-가이드라인)

---

## 개발 환경 설정

### 요구사항

- **Node.js**: 18.0.0 이상
- **npm**: 9.0.0 이상
- **Git**: 2.30.0 이상
- **TypeScript**: 5.7.0 (프로젝트 종속성에 포함)

### 초기 설정

```bash
# 1. 저장소 클론
git clone https://github.com/chrisryugj/korean-law-mcp.git
cd korean-law-mcp

# 2. 종속성 설치
npm install

# 3. 환경 변수 설정
cp .env.example .env
# .env 파일에서 LAW_OC=your-api-key 설정

# 4. 빌드
npm run build

# 5. 로컬 테스트
LAW_OC=your-api-key node build/index.js
```

### API 키 발급

1. [법제처 Open API 신청 페이지](https://www.law.go.kr/DRF/lawService.do) 접속
2. 회원가입 및 로그인
3. "인증키 신청" 클릭
4. 발급받은 키를 `.env` 파일에 저장

---

## 프로젝트 구조

```
korean-law-mcp/
├── src/                      # TypeScript 소스 코드
│   ├── index.ts              # MCP 서버 진입점 (29개 도구 등록)
│   ├── lib/                  # 공통 라이브러리
│   │   ├── api-client.ts     # API 클라이언트 (Singleton)
│   │   ├── cache.ts          # 캐싱 시스템
│   │   ├── law-parser.ts     # JO 코드 변환
│   │   ├── search-normalizer.ts  # 약칭 정규화 (from LexDiff)
│   │   ├── three-tier-parser.ts  # 3단 비교 파서
│   │   └── types.ts          # 공통 타입 정의
│   ├── tools/                # 29개 도구 구현
│   │   ├── search.ts         # search_law
│   │   ├── law-text.ts       # get_law_text
│   │   ├── admin-rule.ts     # search_admin_rule, get_admin_rule
│   │   ├── ordinance-search.ts  # search_ordinance
│   │   ├── ordinance.ts      # get_ordinance
│   │   ├── precedents.ts     # search_precedents, get_precedent_text
│   │   ├── interpretations.ts   # search_interpretations, get_interpretation_text
│   │   ├── comparison.ts     # compare_old_new
│   │   ├── three-tier.ts     # get_three_tier
│   │   ├── annex.ts          # get_annexes
│   │   ├── utils.ts          # parse_jo_code
│   │   ├── search-all.ts     # search_all
│   │   ├── autocomplete.ts   # suggest_law_names
│   │   ├── article-compare.ts   # compare_articles
│   │   ├── law-tree.ts       # get_law_tree
│   │   ├── batch-articles.ts    # get_batch_articles
│   │   ├── article-with-precedents.ts  # get_article_with_precedents
│   │   ├── article-history.ts   # get_article_history
│   │   ├── law-history.ts    # get_law_history
│   │   ├── precedent-summary.ts # summarize_precedent
│   │   ├── precedent-keywords.ts # extract_precedent_keywords
│   │   ├── similar-precedents.ts # find_similar_precedents
│   │   ├── law-statistics.ts # get_law_statistics
│   │   ├── article-link-parser.ts # parse_article_links
│   │   ├── external-links.ts # get_external_links
│   │   └── advanced-search.ts # advanced_search
│   └── server/               # SSE 서버
│       └── sse-server.ts     # Express SSE 서버
├── build/                    # 빌드 결과 (JavaScript)
├── test/                     # 테스트 파일
│   ├── test-all-tools.cjs    # 전체 도구 통합 테스트
│   ├── test-admin-rule.cjs   # 행정규칙 테스트
│   └── test-ordinance.cjs    # 자치법규 테스트
├── docs/                     # 문서
│   ├── ARCHITECTURE.md       # 시스템 아키텍처
│   ├── API.md                # API 레퍼런스
│   └── DEVELOPMENT.md        # 이 파일
├── package.json              # npm 설정
├── tsconfig.json             # TypeScript 설정
├── Dockerfile                # Docker 이미지
├── .env.example              # 환경 변수 예제
├── .gitignore                # Git 제외 파일
├── LICENSE                   # MIT 라이선스
├── README.md                 # 프로젝트 README
└── CLAUDE.md                 # Claude Code 작업 지침
```

---

## 개발 워크플로우

### 1. 브랜치 전략

```bash
# feature 브랜치 생성
git checkout -b feature/new-tool-name

# 작업 후 커밋
git add .
git commit -m "feat: Add new_tool_name for X functionality"

# 메인 브랜치에 PR
git push origin feature/new-tool-name
```

### 2. 커밋 메시지 규칙

**Conventional Commits** 형식 사용:

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Type**:
- `feat`: 새 기능
- `fix`: 버그 수정
- `docs`: 문서 변경
- `refactor`: 리팩토링
- `test`: 테스트 추가
- `chore`: 빌드/설정 변경

**예시**:
```
feat(tools): Add get_article_history for tracking revisions

- Parse XML response from lawSearch.do API
- Extract article change dates and descriptions
- Format output with chronological order

Closes #42
```

### 3. 개발 사이클

```bash
# 1. Watch 모드로 TypeScript 컴파일
npm run watch

# 2. 다른 터미널에서 서버 실행
LAW_OC=your-api-key node build/index.js

# 3. MCP Inspector로 테스트
npx @modelcontextprotocol/inspector build/index.js

# 4. 변경사항 확인 후 커밋
git add .
git commit -m "..."
git push
```

---

## 새 도구 추가하기

### Step 1: 도구 파일 생성

`src/tools/new-tool.ts` 파일 생성:

```typescript
import { z } from "zod"
import { LawApiClient } from "../lib/api-client.js"

// 1. Zod 스키마 정의
export const NewToolSchema = z.object({
  param1: z.string().describe("파라미터 1 설명"),
  param2: z.number().optional().describe("선택적 파라미터"),
}).refine((data) => {
  // 커스텀 검증 로직
  if (data.param1.length === 0) {
    return false
  }
  return true
}, {
  message: "param1은 비어있을 수 없습니다"
})

export type NewToolInput = z.infer<typeof NewToolSchema>

// 2. 도구 함수 구현
export async function newTool(
  apiClient: LawApiClient,
  input: NewToolInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    // 3. API 호출
    const response = await apiClient.someMethod(input.param1)

    // 4. 응답 파싱
    const parsed = parseResponse(response)

    // 5. 결과 포맷팅
    const formatted = formatResult(parsed)

    // 6. 반환
    return {
      content: [{
        type: "text",
        text: formatted
      }]
    }
  } catch (error) {
    // 7. 에러 처리
    return {
      content: [{
        type: "text",
        text: `❌ 에러 발생: ${error.message}\n\n💡 해결 방법: ...`
      }],
      isError: true
    }
  }
}

// 헬퍼 함수들
function parseResponse(response: string): any {
  // XML/JSON 파싱 로직
}

function formatResult(data: any): string {
  // 결과 포맷팅 로직
}
```

### Step 2: index.ts에 도구 등록

`src/index.ts` 파일에 도구 추가:

```typescript
import { NewToolSchema, newTool } from "./tools/new-tool.js"

// ListToolsRequest 핸들러에 추가
case "list_tools":
  return {
    tools: [
      // ... 기존 도구들
      {
        name: "new_tool_name",
        description: "도구에 대한 설명 (한글 + 영어)",
        inputSchema: zodToJsonSchema(NewToolSchema)
      }
    ]
  }

// CallToolRequest 핸들러에 추가
case "call_tool":
  switch (request.params.name) {
    // ... 기존 케이스들

    case "new_tool_name": {
      const input = NewToolSchema.parse(request.params.arguments)
      const result = await newTool(apiClient, input)
      return { content: result.content, isError: result.isError }
    }
  }
```

### Step 3: API 클라이언트 메서드 추가 (필요 시)

`src/lib/api-client.ts`에 새 엔드포인트 메서드 추가:

```typescript
export class LawApiClient {
  // ... 기존 메서드들

  async someMethod(param: string): Promise<string> {
    const apiParams = new URLSearchParams({
      target: "target_name",
      OC: this.apiKey,
      query: param
    })

    const url = this.buildUrl("lawSearch.do", Object.fromEntries(apiParams))
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`API call failed: ${response.status}`)
    }

    return await response.text()
  }
}
```

### Step 4: 테스트 작성

`test/test-new-tool.cjs` 파일 생성:

```javascript
const { spawn } = require("child_process")

async function testNewTool() {
  const server = spawn("node", ["build/index.js"], {
    env: { ...process.env, LAW_OC: process.env.LAW_OC }
  })

  // MCP 프로토콜로 도구 호출
  // ... (test-all-tools.cjs 참고)

  console.log("✅ new_tool_name 테스트 통과")
}

testNewTool()
```

### Step 5: 문서화

- `docs/API.md`에 도구 상세 설명 추가
- `README.md`의 도구 목록에 추가
- `CLAUDE.md`의 도구 목록 업데이트

---

## 테스트 작성

### 통합 테스트

모든 도구를 테스트하는 `test/test-all-tools.cjs`:

```bash
node test/test-all-tools.cjs
```

**출력 예시**:
```
[1/29] search_law ✅ 성공
[2/29] get_law_text ✅ 성공
...
[29/29] advanced_search ✅ 성공

========================================
Test Summary
========================================
Total: 29
✅ Passed: 29
⏭️  Skipped: 0
❌ Failed: 0
```

### 단위 테스트 패턴

```javascript
async function testTool(toolName, args, expectedKeywords) {
  const result = await callMcpTool(server, toolName, args)

  // 성공 여부 확인
  if (result.error) {
    console.log(`❌ ${toolName} 실패:`, result.error)
    return false
  }

  // 응답 내용 검증
  const content = result.content[0].text
  for (const keyword of expectedKeywords) {
    if (!content.includes(keyword)) {
      console.log(`❌ ${toolName}: 키워드 '${keyword}' 누락`)
      return false
    }
  }

  console.log(`✅ ${toolName} 성공`)
  return true
}
```

---

## 코드 스타일

### TypeScript 설정

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./build",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "build", "test"]
}
```

### 코딩 규칙

**1. 명명 규칙**:
```typescript
// 파일명: kebab-case
// new-tool.ts, law-parser.ts

// 함수명: camelCase
function searchLaw() {}
function parseJoCode() {}

// 타입/인터페이스: PascalCase
interface LawSearchResult {}
type NewToolInput = {}

// 상수: UPPER_SNAKE_CASE
const MAX_RESULTS = 100
const DEFAULT_TTL = 3600
```

**2. 주석 규칙**:
```typescript
/**
 * 법령 검색 함수
 *
 * @param apiClient - API 클라이언트 인스턴스
 * @param input - 검색 파라미터
 * @returns 검색 결과 텍스트
 *
 * @example
 * const result = await searchLaw(client, { query: "근로기준법" })
 */
export async function searchLaw(
  apiClient: LawApiClient,
  input: SearchLawInput
): Promise<{ content: Array<{ type: string, text: string }> }> {
  // 구현...
}
```

**3. 에러 처리**:
```typescript
// Good: 구체적이고 사용자 친화적인 에러 메시지
throw new Error(
  `❌ 법령을 찾을 수 없습니다: ${lawName}\n\n` +
  `💡 제안:\n` +
  `  • 법령명을 다시 확인해주세요\n` +
  `  • search_law로 검색해보세요`
)

// Bad: 기술적인 에러 메시지
throw new Error("Null pointer exception at line 123")
```

**4. 파일 크기 제한**:
- **1개 파일 최대 200줄** (주석 제외)
- 초과 시 기능별로 분리

---

## 디버깅

### 1. 로컬 디버깅

#### MCP Inspector 사용

```bash
# Inspector 실행
npx @modelcontextprotocol/inspector build/index.js

# 브라우저에서 http://localhost:5173 접속
# UI에서 도구 선택 및 파라미터 입력
# 실시간으로 응답 확인
```

#### Console Logging

```typescript
// 개발 중에만 사용
if (process.env.NODE_ENV === "development") {
  console.error("[DEBUG] API Response:", response.substring(0, 500))
}
```

### 2. API 응답 확인

```bash
# 직접 API 호출 테스트
curl "https://law.go.kr/DRF/lawSearch.do?OC=your-key&target=law&query=근로기준법"
```

### 3. 타입 체크

```bash
# TypeScript 컴파일 에러 확인
npx tsc --noEmit

# Watch 모드로 실시간 체크
npm run watch
```

---

## 배포

### 로컬 배포 (npm)

```bash
# 1. 버전 업데이트
npm version patch  # 또는 minor, major

# 2. 빌드
npm run build

# 3. npm에 퍼블리시 (권한 필요)
npm publish
```

### Docker 배포

```bash
# 1. 이미지 빌드
docker build -t korean-law-mcp:latest .

# 2. 실행
docker run -e LAW_OC=your-api-key -p 3000:3000 korean-law-mcp:latest

# 3. Docker Hub 푸시 (선택)
docker tag korean-law-mcp:latest your-dockerhub/korean-law-mcp:v1.3.0
docker push your-dockerhub/korean-law-mcp:v1.3.0
```

### Railway 배포

```bash
# 1. Railway CLI 설치
npm install -g @railway/cli

# 2. 로그인
railway login

# 3. 프로젝트 생성
railway init

# 4. 환경 변수 설정
railway variables set LAW_OC=your-api-key

# 5. 배포
railway up
```

---

## 기여 가이드라인

### Pull Request 체크리스트

PR을 생성하기 전에 다음을 확인하세요:

- [ ] TypeScript 컴파일 성공 (`npm run build`)
- [ ] 모든 테스트 통과 (`node test/test-all-tools.cjs`)
- [ ] 코드 스타일 준수
- [ ] 파일 크기 제한 (200줄 이하)
- [ ] 새 도구 추가 시:
  - [ ] `docs/API.md`에 문서 추가
  - [ ] `README.md` 도구 목록 업데이트
  - [ ] `CLAUDE.md` 도구 목록 업데이트
  - [ ] 테스트 케이스 추가
- [ ] 커밋 메시지가 Conventional Commits 형식
- [ ] PR 설명이 변경 내용을 명확히 설명

### 코드 리뷰 기준

리뷰어는 다음을 확인합니다:

1. **기능성**: 의도한 대로 작동하는가?
2. **성능**: 불필요한 API 호출이나 메모리 사용은 없는가?
3. **보안**: 사용자 입력 검증이 충분한가?
4. **가독성**: 코드가 이해하기 쉬운가?
5. **문서화**: 주석과 문서가 충분한가?

### 이슈 제출 가이드

**버그 리포트**:
```markdown
## 버그 설명
간단한 버그 설명

## 재현 단계
1. X 도구 호출
2. Y 파라미터 입력
3. 에러 발생

## 예상 동작
어떻게 작동해야 하는지

## 실제 동작
실제로 어떻게 작동하는지

## 환경
- OS: Windows 11 / macOS 14.0 / Ubuntu 22.04
- Node.js: 18.17.0
- korean-law-mcp: 1.3.0
```

**기능 요청**:
```markdown
## 제안 기능
기능에 대한 간단한 설명

## 동기
왜 이 기능이 필요한가?

## 예상 사용법
```typescript
// 사용 예시 코드
```

## 대안
고려한 다른 방법들
```

---

## 자주 묻는 질문 (FAQ)

### Q1: 새 API 엔드포인트를 추가하려면?

**A**: `src/lib/api-client.ts`에 메서드 추가:

```typescript
async newEndpoint(param: string): Promise<string> {
  const url = this.buildUrl("endpoint.do", {
    target: "target_name",
    param: param
  })
  const response = await fetch(url)
  return await response.text()
}
```

### Q2: 캐싱을 추가하려면?

**A**: 도구 함수에서 캐시 사용:

```typescript
import { lawCache } from "../lib/cache.js"

export async function myTool(input) {
  const cacheKey = `mytool:${input.param}`
  const cached = lawCache.get(cacheKey)
  if (cached) return cached

  const result = await fetchData()
  lawCache.set(cacheKey, result, 3600) // 1시간 TTL

  return result
}
```

### Q3: XML 응답을 파싱하려면?

**A**: `@xmldom/xmldom` 사용:

```typescript
import { DOMParser } from "@xmldom/xmldom"

const parser = new DOMParser()
const doc = parser.parseFromString(xmlText, "text/xml")

const items = doc.getElementsByTagName("item")
for (let i = 0; i < items.length; i++) {
  const name = items[i].getElementsByTagName("name")[0]?.textContent
  console.log(name)
}
```

### Q4: 도구 간에 코드를 공유하려면?

**A**: `src/lib/`에 공통 유틸리티 추가:

```typescript
// src/lib/formatters.ts
export function formatDate(date: string): string {
  return date.replace(/(\d{4})(\d{2})(\d{2})/, "$1.$2.$3")
}

// 도구에서 사용
import { formatDate } from "../lib/formatters.js"
```

---

## 참고 자료

### 공식 문서

- [MCP Specification](https://modelcontextprotocol.io)
- [Zod Documentation](https://zod.dev)
- [법제처 Open API 가이드](https://www.law.go.kr/DRF/lawService.do)

### 관련 프로젝트

- [LexDiff](https://github.com/...) - 법령 약칭 정규화 소스

### 커뮤니티

- [GitHub Discussions](https://github.com/chrisryugj/korean-law-mcp/discussions)
- [Issues](https://github.com/chrisryugj/korean-law-mcp/issues)

---

## 라이선스

이 프로젝트는 MIT 라이선스 하에 배포됩니다. 자세한 내용은 [LICENSE](../LICENSE) 파일을 참조하세요.

---

**Questions?** [GitHub Issues](https://github.com/chrisryugj/korean-law-mcp/issues)에 질문을 올려주세요!
