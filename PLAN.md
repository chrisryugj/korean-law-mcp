# Korean Law MCP Server - 구현 계획서

## 🎯 프로젝트 목표

**카카오 Play MCP 공모전 출품작**: 국가법령정보센터 API 기반 MCP 서버 개발

- **기간**: 2025-12-19 ~ 2026-01-18 (30일)
- **배포 형식**: npm 패키지
- **평가 기준**: 안정성, 편의성, 창의성

---

## 📋 차별화 전략

| 항목 | 전략 | 근거 |
|------|------|------|
| **안정성** | LexDiff 검증된 코드 재사용 | 514줄 law-parser.ts, 213줄 search-normalizer.ts (2년+ 운영) |
| **편의성** | 약칭 자동 해결 + JO 코드 변환 | "화관법" → "화학물질관리법", "제38조" → "003800" |
| **창의성** | 3단비교 + 별표/서식 조회 | 타 법령 DB 없는 고급 기능 (법률→시행령→시행규칙 계층) |

---

## 🏗️ 프로젝트 구조

```
korean-law-mcp/
├── src/
│   ├── index.ts                  # MCP 서버 진입점 (STDIO + SSE 듀얼 모드)
│   ├── server/
│   │   ├── stdio-server.ts       # STDIO 트랜스포트 (로컬용)
│   │   └── sse-server.ts         # SSE 트랜스포트 (리모트용)
│   ├── tools/
│   │   ├── search.ts             # search_law
│   │   ├── law-text.ts           # get_law_text
│   │   ├── comparison.ts         # compare_old_new
│   │   ├── three-tier.ts         # get_three_tier
│   │   ├── admin-rule.ts         # admin_rule 관련
│   │   ├── annex.ts              # get_annexes
│   │   └── utils.ts              # parse_jo_code
│   ├── lib/                      # 핵심 라이브러리
│   │   ├── api-client.ts         # 법제처 API 통합 클라이언트
│   │   ├── law-parser.ts         # LexDiff 복사 (buildJO, formatJO)
│   │   ├── search-normalizer.ts  # LexDiff 복사 (약칭 해결)
│   │   ├── three-tier-parser.ts  # LexDiff 복사 (3단비교)
│   │   └── types.ts              # TypeScript 타입 정의
│   └── utils/
│       └── logger.ts             # 로깅 (console.error 전용)
├── build/                        # 빌드 출력 (.gitignore)
├── Dockerfile                    # Docker 배포용
├── docker-compose.yml            # Docker Compose 설정
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
└── LICENSE (MIT)
```

### 배포 방식

**듀얼 모드 지원**:
- **STDIO 모드**: 로컬 Claude Desktop용 (`node build/index.js`)
- **SSE 모드**: 리모트 서버용 (`node build/index.js --mode sse --port 3000`)

**리모트 배포 옵션**:
1. **Docker + Railway/Render**: 무료 플랜으로 즉시 배포
2. **Vercel/Netlify**: 서버리스 함수로 배포 (Edge Functions)
3. **AWS/GCP**: EC2/Compute Engine에 Node.js 서버 실행

---

## 🔧 MCP Tools 정의 (총 9개)

### 필수 Tools (🔴)

| Tool | 입력 | 출력 | 기능 |
|------|------|------|------|
| `search_law` | `{ query: string }` | 법령 목록 (MST, 공포일) | 법령 검색 (약칭 자동 해결) |
| `get_law_text` | `{ mst: string, jo?: string }` | 조문 전문 | 법령 조회 (JO 코드 자동 변환) |

### 중요 Tools (🟡)

| Tool | 입력 | 출력 | 기능 |
|------|------|------|------|
| `compare_old_new` | `{ mst: string }` | 신구법 대조표 | 개정 전후 비교 |
| `get_three_tier` | `{ mst: string }` | 3단 위임조문 계층 | 법률→시행령→시행규칙 |

### 선택 Tools (🟢)

| Tool | 입력 | 출력 | 기능 |
|------|------|------|------|
| `search_admin_rule` | `{ query: string, knd?: string }` | 행정규칙 목록 | 훈령, 예규, 고시 검색 |
| `get_admin_rule` | `{ id: string }` | 행정규칙 본문 | 행정규칙 조회 |
| `get_annexes` | `{ lawName: string, knd?: 1\|2\|3\|4\|5 }` | 별표/서식 목록 | 첨부 문서 조회 |
| `get_ordinance` | `{ ordinSeq: string }` | 조례/규칙 본문 | 자치법규 조회 |

### 유틸리티 Tool (🔵)

| Tool | 입력 | 출력 | 기능 |
|------|------|------|------|
| `parse_jo_code` | `{ joText: string, direction?: 'to_code'\|'to_text' }` | 변환 결과 | JO 코드 양방향 변환 |

---

## 📝 구현 단계별 계획

### Week 1: 프로젝트 초기화 및 코어 라이브러리 (20시간)

#### Day 1-2: 프로젝트 구조 생성
- [ ] 새 디렉토리 생성: `korean-law-mcp/`
- [ ] `package.json` 설정:
  ```json
  {
    "name": "korean-law-mcp",
    "version": "1.0.0",
    "type": "module",
    "main": "build/index.js",
    "bin": { "korean-law-mcp": "./build/index.js" },
    "dependencies": {
      "@modelcontextprotocol/sdk": "^1.0.0",
      "zod": "^3.22.0"
    },
    "devDependencies": {
      "@types/node": "^22.0.0",
      "typescript": "^5.3.0"
    }
  }
  ```
- [ ] `tsconfig.json` 설정 (ES2020, strict 모드)
- [ ] 의존성 설치: `npm install`

#### Day 3-4: 코어 라이브러리 이식
- [ ] **lib/law-parser.ts 복사**:
  - 파일 경로: `c:\github_project\lexdiff\lib\law-parser.ts`
  - 수정 사항:
    - `debugLogger.debug()` → `console.error()` 변환
    - `DOMParser` import 제거 (브라우저 전용, MCP는 Node.js)
    - `parseArticleHistory()` 함수 제거 (XML 파싱은 api-client에서 처리)
  - 유지할 함수: `buildJO()`, `formatJO()`, `parseSearchQuery()`, `normalizeArticle()`, `formatSimpleJo()`

- [ ] **lib/search-normalizer.ts 복사**:
  - 파일 경로: `c:\github_project\lexdiff\lib\search-normalizer.ts`
  - 수정 사항:
    - `debugLogger` → `console.error()` 변환
  - 유지할 함수: `normalizeLawSearchText()`, `resolveLawAlias()`, `expandSearchSynonyms()`
  - **약칭 DB (LAW_ALIAS_ENTRIES)**: 그대로 유지 (공모전 차별화 핵심)

- [ ] **lib/three-tier-parser.ts 복사**:
  - 파일 경로: `c:\github_project\lexdiff\lib\three-tier-parser.ts`
  - 수정 사항:
    - `debugLogger` → `console.error()` 변환
  - 유지할 함수: `parseThreeTierDelegation()`, `dedupeDelegations()`, `convertToJO()`, `formatJoNum()`

- [ ] **lib/types.ts 작성**:
  - LexDiff `lib/law-types.ts`에서 필요한 타입만 복사:
    - `ThreeTierData`, `ThreeTierMeta`, `ThreeTierArticle`, `DelegationItem`

#### Day 5: API 클라이언트 작성
- [ ] **lib/api-client.ts 구현**:
  - 참고 파일:
    - `c:\github_project\lexdiff\app\api\eflaw\route.ts` (현행법령 조회)
    - `c:\github_project\lexdiff\app\api\law-search\route.ts` (법령 검색)
  - 주요 메서드:
    ```typescript
    class LawApiClient {
      constructor(config: { apiKey: string })

      async searchLaw(query: string): Promise<string> // XML 응답
      async getLawText(params: { mst?: string, lawId?: string, jo?: string, efYd?: string }): Promise<string> // JSON 응답
      async compareOldNew(params: { mst?: string, lawId?: string, ld?: string, ln?: string }): Promise<string> // XML 응답
      async getThreeTier(params: { mst?: string, lawId?: string, knd?: '1'|'2' }): Promise<string> // JSON 응답
    }
    ```
  - **중요**:
    - `normalizeLawSearchText()` 자동 적용 (검색 전)
    - `resolveLawAlias()` 자동 적용 (약칭 해결)
    - `normalizeDateFormat()` 날짜 처리 (`efYd` 파라미터)
    - 짧은 검색어 처리 전략 (`hasExactLawMatch()`, `mergeXmlResponses()`)

---

### Week 2: Tool 구현 (필수 + 중요) (25시간)

#### Day 1: search_law (필수)
- [ ] **tools/search.ts 작성**:
  - Zod 스키마:
    ```typescript
    const SearchLawSchema = z.object({
      query: z.string().describe("검색할 법령명"),
      maxResults: z.number().optional().default(20)
    })
    ```
  - 구현:
    - `apiClient.searchLaw()` 호출
    - XML 파싱 (DOMParser 대신 `@xmldom/xmldom` 사용)
    - 법령 목록 포맷팅:
      ```
      검색 결과 (총 3건):
      1. 관세법 (MST: 000013, 공포일: 2023-12-19)
      2. 관세법 시행령 (MST: 000122, 공포일: 2023-12-20)
      ...
      ```
  - 에러 처리:
    - 검색 결과 없음 → "검색 결과가 없습니다. 법령명을 확인해주세요."
    - XML 파싱 오류 → `isError: true`

#### Day 2: get_law_text (필수)
- [ ] **tools/law-text.ts 작성**:
  - Zod 스키마:
    ```typescript
    const GetLawTextSchema = z.object({
      mst: z.string().optional(),
      lawId: z.string().optional(),
      jo: z.string().optional().describe("조문 번호 (한글 또는 JO 코드)"),
      efYd: z.string().optional()
    }).refine(data => data.mst || data.lawId, {
      message: "mst 또는 lawId 중 하나는 필수입니다"
    })
    ```
  - 구현:
    - `jo` 파라미터가 한글이면 `buildJO()` 자동 변환
    - `apiClient.getLawText()` 호출
    - JSON 응답 파싱 (`json?.법령?.조문`)
    - 포맷팅:
      ```
      법령명: 관세법
      공포일: 2023-12-19

      제38조 (신고납부)
      ① 수입신고를 하는 자는...
      ```

#### Day 3: parse_jo_code (유틸리티)
- [ ] **tools/utils.ts 작성**:
  - Zod 스키마:
    ```typescript
    const ParseJoCodeSchema = z.object({
      joText: z.string(),
      direction: z.enum(['to_code', 'to_text']).optional().default('to_code')
    })
    ```
  - 구현:
    - `to_code`: `buildJO()` 사용
    - `to_text`: `formatJO()` 사용
  - 출력 예시:
    ```json
    { "input": "제38조", "output": "003800", "direction": "to_code" }
    ```

#### Day 4: compare_old_new (중요)
- [ ] **tools/comparison.ts 작성**:
  - Zod 스키마: `{ mst?: string, lawId?: string, ld?: string, ln?: string }`
  - 구현:
    - `apiClient.compareOldNew()` 호출
    - XML 파싱 (`<개정전>`, `<개정후>`)
    - 포맷팅: 조문별 개정 전후 대조

#### Day 5: get_three_tier (중요)
- [ ] **tools/three-tier.ts 작성**:
  - Zod 스키마: `{ mst?: string, lawId?: string, knd?: '1'|'2' }`
  - 구현:
    - `apiClient.getThreeTier()` 호출
    - `parseThreeTierDelegation()` 사용 (lib/three-tier-parser.ts)
    - 포맷팅:
      ```
      법령명: 관세법
      시행령: 관세법 시행령

      제38조 (신고납부)
      ├─ [시행령] 제32조 (신고사항)
      ├─ [시행령] 제32조의2 (전자신고)
      └─ [시행규칙] 제8조 (신고서식)
      ```

---

### Week 3: 서버 통합 및 테스트 (20시간)

#### Day 1: SSE 서버 구현
- [ ] **server/sse-server.ts 구현** (리모트 배포용):
  ```typescript
  import express from 'express'
  import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js"

  export async function startSSEServer(mcpServer, port: number) {
    const app = express()
    const transport = new SSEServerTransport('/message', res)

    app.post('/sse', async (req, res) => {
      const transport = new SSEServerTransport('/message', res)
      await mcpServer.connect(transport)
    })

    app.listen(port, () => {
      console.error(`MCP SSE server listening on port ${port}`)
    })
  }
  ```

#### Day 2: index.ts 작성 (듀얼 모드)
- [ ] **src/index.ts 구현**:
  ```typescript
  #!/usr/bin/env node
  import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
  import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
  import { startSSEServer } from './server/sse-server.js'

  // API 키 환경변수 확인
  const LAW_OC = process.env.LAW_OC
  if (!LAW_OC) {
    console.error("Error: LAW_OC 환경변수가 설정되지 않았습니다")
    process.exit(1)
  }

  const server = new McpServer({
    name: "korean-law",
    version: "1.0.0"
  })

  // Tool 등록 (모든 Tool 등록 코드)
  // import { registerAllTools } from './tools/index.js'
  // registerAllTools(server)

  async function main() {
    // CLI 인자로 모드 선택
    const mode = process.argv.includes('--mode')
      ? process.argv[process.argv.indexOf('--mode') + 1]
      : 'stdio'
    const port = process.argv.includes('--port')
      ? parseInt(process.argv[process.argv.indexOf('--port') + 1])
      : 3000

    if (mode === 'sse') {
      await startSSEServer(server, port)
    } else {
      const transport = new StdioServerTransport()
      await server.connect(transport)
      console.error("Korean Law MCP server running on stdio")
    }
  }

  main().catch((error) => {
    console.error("Fatal error:", error)
    process.exit(1)
  })
  ```

- [ ] **package.json scripts 추가**:
  ```json
  {
    "scripts": {
      "build": "tsc && chmod 755 build/index.js",
      "watch": "tsc --watch",
      "prepublishOnly": "npm run build"
    }
  }
  ```

#### Day 3-4: MCP Inspector 테스트
- [ ] **테스트 시나리오 실행**:
  ```bash
  # 환경변수 설정
  $env:LAW_OC="ryuseungin"

  # MCP Inspector 실행
  npx @modelcontextprotocol/inspector build/index.js
  ```

- [ ] **필수 테스트 케이스**:
  | ID | Tool | 입력 | 예상 결과 |
  |----|------|------|----------|
  | T1 | search_law | `{"query": "관세법"}` | MST=000013 포함 |
  | T2 | search_law | `{"query": "화관법"}` | "화학물질관리법" 검색 (약칭 해결) |
  | T3 | get_law_text | `{"mst": "000013", "jo": "제38조"}` | 제38조 내용 반환 |
  | T4 | get_law_text | `{"mst": "000013", "jo": "003800"}` | 제38조 내용 반환 (JO 코드) |
  | T5 | parse_jo_code | `{"joText": "제38조"}` | "003800" 반환 |
  | T6 | get_three_tier | `{"mst": "000013"}` | 시행령·시행규칙 계층 반환 |

- [ ] **에러 케이스 테스트**:
  | ID | Tool | 입력 | 예상 에러 |
  |----|------|------|----------|
  | E1 | search_law | `{"query": "존재하지않는법령"}` | "검색 결과가 없습니다" |
  | E2 | get_law_text | `{}` | Zod validation 에러 |
  | E3 | parse_jo_code | `{"joText": "abc123"}` | "조문 패턴을 인식할 수 없습니다" |

#### Day 5: 문서화
- [ ] **README.md 작성**:
  ```markdown
  # Korean Law MCP Server

  국가법령정보센터 API 기반 한국 법령 조회·비교 도구

  ## 설치
  npm install -g korean-law-mcp

  ## Claude Desktop 설정
  {
    "mcpServers": {
      "korean-law": {
        "command": "npx",
        "args": ["-y", "korean-law-mcp"],
        "env": {
          "LAW_OC": "your-api-key"
        }
      }
    }
  }

  ## API 키 발급
  법제처 국가법령정보센터 오픈API 신청
  https://www.law.go.kr/DRF/lawService.do

  ## Tools
  - search_law: 법령 검색
  - get_law_text: 조문 조회
  - parse_jo_code: JO 코드 변환
  - compare_old_new: 신구법 대조
  - get_three_tier: 3단비교
  ```

- [ ] **.env.example 작성**:
  ```
  # 법제처 오픈API 인증키 (필수)
  # 발급: https://www.law.go.kr/DRF/lawService.do
  LAW_OC=your-api-key-here
  ```

---

### Week 4: 배포 및 공모전 준비 (15시간)

#### Day 1: npm 배포
- [ ] **package.json 최종 검토**:
  ```json
  {
    "name": "korean-law-mcp",
    "version": "1.0.0",
    "description": "국가법령정보센터 API 기반 MCP 서버",
    "keywords": ["mcp", "korean-law", "법령", "관세법", "claude"],
    "repository": "https://github.com/yourusername/korean-law-mcp",
    "author": "Your Name",
    "license": "MIT",
    "files": ["build", "README.md", "LICENSE"]
  }
  ```

- [ ] **빌드 및 배포**:
  ```bash
  npm run build
  npm login
  npm publish --access public
  ```

#### Day 2: PlayMCP 등록
- [ ] **등록 정보 작성**:
  - 서버명: Korean Law Information MCP
  - 설명: "국가법령정보센터 API 기반 한국 법령 조회·비교 도구. 법령 검색, 조문 조회, 신구법 대조, 3단비교 기능 제공. 약칭 자동 해결 및 JO 코드 변환 지원."
  - 카테고리: Legal, Government, Data Access
  - GitHub: (레포지토리 URL)
  - npm: https://www.npmjs.com/package/korean-law-mcp

- [ ] **스크린샷 준비** (3개):
  1. Claude Desktop에서 법령 검색 실행
  2. 3단비교 결과 화면
  3. 약칭 자동 해결 예시 ("화관법" → "화학물질관리법")

#### Day 3-4: 데모 영상 제작 (3분)
- [ ] **시나리오 작성**:
  1. 유즈케이스 1: "관세법 38조 뭐야?" → `get_law_text` 실행
  2. 유즈케이스 2: "화관법 검색해줘" → `search_law` (약칭 해결)
  3. 유즈케이스 3: "관세법의 3단비교 보여줘" → `get_three_tier` (시행령·시행규칙)

- [ ] **화면 녹화 및 편집** (OBS Studio)

#### Day 5: 리모트 배포 및 공모전 제출
- [ ] **Railway/Render 배포** (무료 플랜):
  ```bash
  # Railway
  railway login
  railway init
  railway up

  # 또는 Render
  # GitHub 연동 후 자동 배포
  ```

- [ ] **Dockerfile 작성**:
  ```dockerfile
  FROM node:20-alpine
  WORKDIR /app
  COPY package*.json ./
  RUN npm ci --only=production
  COPY build ./build
  ENV NODE_ENV=production
  EXPOSE 3000
  CMD ["node", "build/index.js", "--mode", "sse", "--port", "3000"]
  ```

- [ ] **PlayMCP 등록**:
  - 서버 URL: `https://your-app.railway.app/sse`
  - 연결 방식: SSE (Server-Sent Events)

- [ ] **공모전 응모 버튼 클릭**

---

## 🔑 핵심 참조 파일 (LexDiff)

구현 시 반드시 참조해야 할 파일 5개:

1. **`c:\github_project\lexdiff\lib\law-parser.ts`** (514줄)
   - JO 코드 변환 핵심 로직
   - 함수: `buildJO()`, `formatJO()`, `parseSearchQuery()`

2. **`c:\github_project\lexdiff\lib\search-normalizer.ts`** (213줄)
   - 약칭 해결 DB (LAW_ALIAS_ENTRIES)
   - 함수: `normalizeLawSearchText()`, `resolveLawAlias()`

3. **`c:\github_project\lexdiff\lib\three-tier-parser.ts`** (396줄)
   - 3단비교 JSON 파싱 전문
   - 함수: `parseThreeTierDelegation()`, `dedupeDelegations()`

4. **`c:\github_project\lexdiff\app\api\eflaw\route.ts`** (120줄)
   - 현행법령 조회 API 통합 패턴
   - 날짜 정규화, JO 파라미터 처리

5. **`c:\github_project\lexdiff\app\api\law-search\route.ts`** (237줄)
   - 법령 검색 API 통합 패턴
   - 짧은 검색어 처리, 정확 매칭, 다중 페이지 검색

---

## ⚠️ 주의사항

### 코드 이식 시
- **debugLogger 제거**: 모든 `debugLogger.debug()` → `console.error()` 변환
- **DOMParser 제거**: 브라우저 API이므로 `@xmldom/xmldom` 사용
- **타입 수정**: LexDiff의 타입 정의를 MCP용으로 간소화

### 환경변수 관리
- **필수**: `LAW_OC` 환경변수 (법제처 API 키)
- **서버 시작 시 검증**: `if (!LAW_OC) process.exit(1)`
- **Claude Desktop 설정**: `env` 필드에 추가

### STDIO 프로토콜 준수
- **절대 금지**: `console.log()` 사용 (JSON-RPC 메시지 오염)
- **로깅**: `console.error()` 사용

### 에러 처리
- **Tool 응답 형식**:
  ```typescript
  return {
    content: [{ type: "text", text: "..." }],
    isError: true  // 에러 발생 시
  }
  ```

---

## 📊 공모전 제출 체크리스트

- [ ] npm 패키지 배포 완료
- [ ] README.md 작성 (설치/사용법)
- [ ] LICENSE 파일 추가 (MIT)
- [ ] PlayMCP 등록 완료
- [ ] 데모 영상 제작 (3분)
- [ ] GitHub 레포지토리 공개
- [ ] 공모전 응모 완료

---

## 🎯 예상 작업 시간

| 주차 | 작업 | 시간 |
|------|------|------|
| Week 1 | 프로젝트 초기화 + 코어 라이브러리 | 20시간 |
| Week 2 | Tool 구현 (필수 + 중요) | 25시간 |
| Week 3 | 서버 통합 + 테스트 + 문서화 | 20시간 |
| Week 4 | 배포 + 공모전 준비 | 15시간 |
| **합계** | | **80시간** |

---

**작성일**: 2025-12-19
**마감일**: 2026-01-18 (30일 남음)
