# Korean Law MCP - 개발자 가이드

> **v4.12.0** | 기여자를 위한 개발 가이드

---

## 개발 환경 설정

### 요구사항

- **Node.js**: 20.19.0 이상 (`engines` 하한 = 통합 호스트 런타임). CI는 20.19.0·22.12.0 양쪽에서 돌고, Dockerfile 은 22.12.0 을 싣는다
- **npm**: Node.js 20.19.0에 포함된 버전(10.8.2) 이상 — **package-lock.json 재생성도 이 버전으로** (상위 npm 으로 만들면 CI 의 `npm ci` 가 깨진다)
- **TypeScript**: 5.7+ (프로젝트 종속성에 포함)

### 초기 설정

```bash
git clone https://github.com/chrisryugj/korean-law-mcp.git
cd korean-law-mcp
npm ci --ignore-scripts
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
│   ├── tool-registry.ts      # 99개 도구 등록 (allTools 배열)
│   ├── lib/                  # 공통 라이브러리 (51개 파일)
│   │   ├── api-client.ts     # API 클라이언트
│   │   ├── annex-file-parser.ts  # HWPX/HWP/PDF 별표 파싱
│   │   ├── annex-notation.ts # 별표 표기 문법 (단일 원본)
│   │   ├── article-parser.ts # 조문 파서
│   │   ├── article-anchor.ts # 조문 인용 앵커 파싱
│   │   ├── case-citation.ts  # 사건부호 (단일 원본)
│   │   ├── cache.ts          # LRU 캐시 (TTL)
│   │   ├── errors.ts         # LawApiError + 대괄호 라벨
│   │   ├── execution-limits.ts  # 요청 단위 예산 + parseIntegerLimit
│   │   ├── fetch-with-retry.ts  # 30초 타임아웃, 3회 재시도, 예산 소비
│   │   ├── body-shape.ts / upstream-miss.ts  # 200인 실패 판정
│   │   ├── response-body.ts  # 예산·취소가 걸린 본문 리더
│   │   ├── law-parser.ts     # JO 코드 변환 (LexDiff 원본)
│   │   ├── query-router.ts / route-patterns.ts / query-extract.ts  # 자연어 라우팅
│   │   ├── scenario-rules.ts # 시나리오 판정 어휘 (단일 원본)
│   │   ├── date-parser.ts / date-patterns.ts  # 자연어 날짜
│   │   ├── schemas.ts        # 날짜/응답크기 검증 (truncateResponse)
│   │   ├── search-normalizer.ts  # 약칭 정규화 (LexDiff 원본)
│   │   ├── session-state.ts  # 멀티세션 API 키 격리
│   │   ├── three-tier-parser.ts  # 3단 비교 파서
│   │   ├── types.ts          # 공통 타입
│   │   └── xml-parser.ts     # 6개 도메인별 XML 파서
│   ├── tools/                # 도구 구현 (76개 파일, scenarios/ 12개 포함)
│   │   ├── search.ts         # search_law
│   │   ├── law-text.ts       # get_law_text
│   │   ├── admin-rule.ts     # search_admin_rule, get_admin_rule
│   │   ├── ordinance-search.ts / ordinance.ts  # 자치법규
│   │   ├── precedents.ts     # search_precedents, get_precedent_text
│   │   ├── interpretations.ts  # 법령해석례
│   │   ├── chains.ts         # 8개 체인 도구 (legal_research 의 task)
│   │   ├── chain-deadline.ts # 체인 데드라인 + 부분 결과
│   │   ├── annex-list.ts / annex-select.ts  # 별표 목록 수집·선택
│   │   ├── scenarios/        # 9개 시나리오 모듈
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
│       ├── http-server.ts    # Streamable HTTP (MCP 표준, stateless)
│       └── http-config.ts    # env 파싱 (CORS/Origin/rate limit)
├── build/                    # 빌드 결과 (JavaScript)
├── docs/                     # 문서
├── Dockerfile                # Docker 이미지
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
npm test                              # vitest (74 파일 / 701 테스트, 2026-08 실측 — 수치는 릴리스마다 늘어난다)
npm run gc                            # typecheck + knip + test + build 한 번에
LAW_OC=your-key node build/index.js   # STDIO 모드 테스트
npx @modelcontextprotocol/inspector build/index.js  # Inspector 테스트
```

새 도구에는 **동작을 고정하는 테스트**를 함께 넣는다. 업스트림을 때리지 않는 테스트가
기본이다 — `apiClient`를 스텁으로 주입하면 파싱·분기·에러 경로를 전부 덮을 수 있다
(`src/tools/annex.test.ts`가 그 형태다).

---

## 개발 워크플로우

```bash
# Watch 모드
npm run watch

# 다른 터미널에서 서버 실행
LAW_OC=your-key node build/index.js

# CLI 테스트
npm run cli -- search_law --query "민법"
npm run cli -- "민법 제1조"        # 자연어 라우팅
npm run cli -- list

# 검증 (커밋 전)
npm test          # vitest
npm run typecheck # tsc --noEmit
npm run dead-code # knip
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

- **파일 크기**: 200줄 미만 (초과 시 `src/lib/`로 분리). 기존 초과 파일이 남아 있으나 신규에는 엄격히 적용
- **명명**: 파일 kebab-case, 함수 camelCase, 타입 PascalCase. 같은 이름으로 다른 일을 하지 않는다 — 이름이 하는 일을 말해야 한다
- **Zod 스키마**: 모든 도구 입력에 필수
- **`console.log`/`console.error` 금지**: STDIO 모드에서 JSON-RPC를 깨뜨린다. 에러는 throw로 전파. 예외는 별도 바이너리인 CLI 경로(`cli.ts`/`cli-executor.ts`/`cli-format.ts`)뿐
- **`truncateResponse()` 필수**: 모든 도구 최종 출력에. 한도는 5만 자(UTF-16)이지 50KB가 아니다
- **단일 원본**: 사건부호·별표 표기·조문 앵커·본문 판정 술어 같은 공유 지식은 정의 파일이 하나뿐이어야 한다. 사본을 만들지 말고 import 하라
- **LexDiff 코드**: `search-normalizer.ts`, `law-parser.ts`, `citation-content-matcher.ts` 수정 금지 (수정 시 상류 대조 필수 — 자세한 단서는 CLAUDE.md 규칙 1)

전체 규칙은 [CLAUDE.md](../CLAUDE.md)의 Critical Rules가 원본이다.

---

## 배포

### npm

```bash
npm version patch  # 버전 bump
git push --follow-tags
gh release create v$(node -p 'require("./package.json").version') --generate-notes
```

GitHub Release가 `.github/workflows/publish.yml`을 실행합니다. workflow는 OIDC로 게시하고 provenance attestation을 자동 생성합니다.

> ⚠️ **선행 조건 (2026-08-16 기준 미완료)**: npm 패키지 설정에서 이 저장소와 `publish.yml`을 trusted publisher로 등록해야 이 workflow 가 성공한다. 등록 전까지는 종전대로 로컬 `npm publish`(2FA)를 쓰고 GitHub Release 는 만들지 않는다 — 등록 없이 Release 를 만들면 publish job 이 인증 단계에서 실패한다.

### 통합 호스트 (프로덕션)

> 🚫 **이 레포에서 `fly deploy`/`flyctl deploy` 직접 실행 절대 금지.**
> 프로덕션은 이 레포가 아니라 [gomdori-mcp](https://github.com/chrisryugj/gomdori-mcp) 통합
> 호스트(fly 앱 `korean-law-mcp` 1대에 MCP 5종 동거)가 서빙한다. 여기서 배포하면 통합 이미지를
> law 단독 이미지로 덮어써 stats·patent·archhub·school까지 전부 죽는다. 배경: [FLY-COST.md](FLY-COST.md)

반영 절차:

```bash
# 1) 이 레포 커밋·푸시 → 2) npm publish
# 3) ~/workspace/gomdori-mcp/Dockerfile 의 korean-law-mcp@X.Y.Z 핀 갱신
# 4) cd ~/workspace/gomdori-mcp && fly deploy -c fly.production.toml
```

- 공식 주소: `https://mcp.gomdori.app/law` (구 `korean-law-mcp.fly.dev/mcp`는 하위호환 유지)

### Docker (자체 호스팅)

```bash
docker build -t korean-law-mcp .
docker run -e LAW_OC=your-key -e MCP_HTTP_HOST=0.0.0.0 \
  -e MCP_AUTH_TOKEN=replace-with-a-secret -p 3000:3000 korean-law-mcp
```

---

## 참고 자료

- [MCP Specification](https://modelcontextprotocol.io)
- [Zod Documentation](https://zod.dev)
- [법제처 Open API](https://open.law.go.kr/LSO/openApi/guideResult.do)
- [LexDiff](https://github.com/chrisryugj/lexdiff) - 검색어 정규화 원본

---

**Questions?** [GitHub Issues](https://github.com/chrisryugj/korean-law-mcp/issues)
