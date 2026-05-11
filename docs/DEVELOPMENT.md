# Korean Law MCP - 개발자 가이드

> **v2.3.2** | 기여자를 위한 개발 가이드

---

## 개발 환경 설정

### 요구사항

- **Node.js**: 18.0.0 이상
- **npm**: 9.0.0 이상
- **TypeScript**: 5.7+ (프로젝트 종속성에 포함)

### 초기 설정

```bash
git clone https://github.com/chrisryugj/korean-law-mcp.git
cd korean-law-mcp
npm install
npm run build
LAW_OC=your-api-key node build/index.js
```

### API 키 발급

[법제처 Open API](https://open.law.go.kr/LSO/openApi/guideResult.do)에서 무료 발급.

---

## 프로젝트 구조

```
korean-law-mcp/
├── src/
│   ├── index.ts              # MCP 서버 진입점 (STDIO/HTTP 모드)
│   ├── cli.ts                # CLI 인터페이스
│   ├── tool-registry.ts      # 64개 도구 등록 (allTools 배열)
│   ├── lib/                  # 공통 라이브러리 (13개 파일)
│   │   ├── api-client.ts     # API 클라이언트
│   │   ├── annex-file-parser.ts  # HWPX/HWP/PDF 별표 파싱
│   │   ├── article-parser.ts # 조문 파서
│   │   ├── cache.ts          # LRU 캐시 (TTL)
│   │   ├── errors.ts         # LawApiError 클래스
│   │   ├── fetch-with-retry.ts  # 30초 타임아웃, 3회 재시도
│   │   ├── law-parser.ts     # JO 코드 변환 (LexDiff 원본)
│   │   ├── schemas.ts        # 날짜/응답크기 검증
│   │   ├── search-normalizer.ts  # 약칭 정규화 (LexDiff 원본)
│   │   ├── session-state.ts  # 멀티세션 API 키 격리
│   │   ├── three-tier-parser.ts  # 3단 비교 파서
│   │   ├── types.ts          # 공통 타입
│   │   └── xml-parser.ts     # 6개 도메인별 XML 파서
│   ├── tools/                # 도구 구현 (40개 파일)
│   │   ├── search.ts         # search_law
│   │   ├── law-text.ts       # get_law_text
│   │   ├── admin-rule.ts     # search_admin_rule, get_admin_rule
│   │   ├── ordinance-search.ts / ordinance.ts  # 자치법규
│   │   ├── precedents.ts     # search_precedents, get_precedent_text
│   │   ├── interpretations.ts  # 법령해석례
│   │   ├── chains.ts         # 7개 체인 도구
│   │   ├── batch-articles.ts # get_batch_articles
│   │   ├── annex.ts          # get_annexes (별표 조회+파싱)
│   │   ├── committee-decisions.ts  # 공정위/노동위/개보위
│   │   ├── constitutional-decisions.ts  # 헌재 결정
│   │   ├── admin-appeals.ts  # 행정심판
│   │   ├── customs-interpretations.ts / tax-tribunal-decisions.ts  # 관세/조세
│   │   ├── english-law.ts / historical-law.ts  # 영문/연혁
│   │   ├── knowledge-base.ts / kb-utils.ts / legal-terms.ts  # 지식베이스
│   │   ├── life-law.ts       # 생활법령
│   │   └── ... (기타 도구 파일)
│   └── server/
│       ├── http-server.ts    # Streamable HTTP (MCP 표준)
│       └── sse-server.ts     # SSE 서버 (레거시)
├── build/                    # 빌드 결과 (JavaScript)
├── docs/                     # 문서
├── Dockerfile                # Docker 이미지
├── fly.toml                  # Fly.io 배포 설정
├── package.json
├── tsconfig.json
└── CLAUDE.md                 # Claude Code 작업 지침
```

---

## 새 도구 추가하기

### Step 1: 도구 파일 생성

`src/tools/new-tool.ts`:

```typescript
import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"

export const NewToolSchema = z.object({
  param1: z.string().describe("파라미터 설명"),
  apiKey: z.string().optional().describe("API 키")
})

export type NewToolInput = z.infer<typeof NewToolSchema>

export async function newTool(
  apiClient: LawApiClient,
  input: NewToolInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const response = await apiClient.someMethod(input.param1, { apiKey: input.apiKey })
    return { content: [{ type: "text", text: formatResult(response) }] }
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true
    }
  }
}
```

### Step 2: tool-registry.ts에 등록

`src/tool-registry.ts`의 `allTools` 배열에 추가:

```typescript
import { NewToolSchema, newTool } from "./tools/new-tool.js"

// allTools 배열에 추가
{
  name: "new_tool_name",
  description: "도구 설명",
  schema: NewToolSchema,
  handler: (client, input) => newTool(client, input)
}
```

### Step 3: 빌드 & 테스트

```bash
npm run build
LAW_OC=your-key node build/index.js  # STDIO 모드 테스트
npx @modelcontextprotocol/inspector build/index.js  # Inspector 테스트
```

---

## 개발 워크플로우

```bash
# Watch 모드
npm run watch

# 다른 터미널에서 서버 실행
LAW_OC=your-key node build/index.js

# CLI 테스트
npm run cli -- search_law --query "민법"
npm run cli -- list
```

### 커밋 메시지 규칙

Conventional Commits:
- `feat`: 새 기능
- `fix`: 버그 수정
- `docs`: 문서 변경
- `refactor`: 리팩토링
- `chore`: 빌드/설정 변경

---

## 코드 규칙

- **파일 크기**: 200줄 미만 (초과 시 `src/lib/`로 분리)
- **명명**: 파일 kebab-case, 함수 camelCase, 타입 PascalCase
- **Zod 스키마**: 모든 도구 입력에 필수
- **LexDiff 코드**: `search-normalizer.ts`, `law-parser.ts` 수정 금지

---

## 배포

### npm

```bash
npm version patch  # 버전 bump
npm run build
npm publish
```

### Fly.io

```bash
flyctl deploy
```

### Docker

```bash
docker build -t korean-law-mcp .
docker run -e LAW_OC=your-key -p 3000:3000 korean-law-mcp
```

---

## 참고 자료

- [MCP Specification](https://modelcontextprotocol.io)
- [Zod Documentation](https://zod.dev)
- [법제처 Open API](https://open.law.go.kr/LSO/openApi/guideResult.do)
- [LexDiff](https://github.com/chrisryugj/lexdiff) - 검색어 정규화 원본

---

**Questions?** [GitHub Issues](https://github.com/chrisryugj/korean-law-mcp/issues)
