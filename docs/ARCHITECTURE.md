# Korean Law MCP - System Architecture

> **v4.12.0** | Last Updated: August 2026

---

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     MCP Client (Claude 등)                    │
└────────────────────┬────────────────────┬────────────────────┘
              STDIO Mode              HTTP Mode
            (Local Desktop)        (Remote: Fly.io)
                     │                    │
┌────────────────────▼────────────────────▼────────────────────┐
│               Korean Law MCP Server (v4.12.0)                 │
│                                                               │
│  ┌───────────────────────────────────────────────────────┐   │
│  │     Tool Registry (98 Zod-Validated Tools)            │   │
│  │     tool-registry.ts → allTools[] · V3_EXPOSED 10개만  │   │
│  │     ListTools 로 노출, 나머지는 execute_tool 경유       │   │
│  ├───────────────────────────────────────────────────────┤   │
│  │  검색 (11)   │ 조회 (9)      │ 분석 (10)             │   │
│  │  전문 (4)    │ 헌재/행심 (8) │ 지식베이스 (7)        │   │
│  │  기타 (6)    │ 체인 (8)      │ 킬러 기능 (4)         │   │
│  │  연계 (4)    │ 조약 (2)      │ 학칙·공단 (6)         │   │
│  │  특별행심(4) │ 메타 (2)      │ CLI 인터페이스        │   │
│  └───────────────────────────────────────────────────────┘   │
│                             ▲                                 │
│  ┌───────────────────────────────────────────────────────┐   │
│  │       라우팅·추출 (자연어 → 도구, CLI·MCP 공통)         │   │
│  │  • query-router.ts     (매칭 엔진)                    │   │
│  │  • route-patterns.ts   (패턴 테이블 — 선언부)          │   │
│  │  • query-extract.ts    (질의 → 파라미터 추출기)        │   │
│  │  • scenario-rules.ts   (시나리오 판정 어휘 단일 원본)   │   │
│  │  • date-parser/-patterns (자연어 날짜 엔진/테이블)     │   │
│  └───────────────────────────────────────────────────────┘   │
│                             ▲                                 │
│  ┌───────────────────────────────────────────────────────┐   │
│  │            Shared Libraries (src/lib/ 51개)           │   │
│  ├───────────────────────────────────────────────────────┤   │
│  │  • api-client.ts       (API 호출 + 캐시)              │   │
│  │  • xml-parser.ts       (6개 도메인 파서)              │   │
│  │  • annex-file-parser.ts (HWPX/HWP/PDF 파싱)          │   │
│  │  • annex-notation.ts   (별표 표기 문법 단일 원본)      │   │
│  │  • search-normalizer.ts (약칭 해석, LexDiff)          │   │
│  │  • law-parser.ts       (JO 코드 변환, LexDiff)        │   │
│  │  • case-citation.ts    (사건부호 단일 원본)            │   │
│  │  • article-anchor.ts   (조문 인용 앵커 파싱)           │   │
│  │  • errors.ts           (LawApiError + 대괄호 라벨)     │   │
│  │  • schemas.ts          (날짜/크기 검증, truncate*)     │   │
│  │  • session-state.ts    (요청별 API 키 격리, ALS)       │   │
│  │  • cache.ts            (LRU + TTL)                    │   │
│  └───────────────────────────────────────────────────────┘   │
│                             ▲                                 │
│  ┌───────────────────────────────────────────────────────┐   │
│  │     업스트림 경계 (예산·미스 판정·데드라인)             │   │
│  ├───────────────────────────────────────────────────────┤   │
│  │  • execution-limits.ts (요청 단위 예산 — 호출수/바이트) │   │
│  │  • fetch-with-retry.ts (30s timeout, 3 retries,       │   │
│  │                         예산 소비 지점)                │   │
│  │  • response-body.ts    (예산·취소가 걸린 본문 리더)     │   │
│  │  • body-shape.ts       (HTML/빈 본문 술어 단일 원본)   │   │
│  │  • upstream-miss.ts    (미스 확정 — 200인 실패 판정)   │   │
│  │  • chain-deadline.ts   (체인 데드라인 + 부분 결과)     │   │
│  └───────────────────────────────────────────────────────┘   │
│                             ▲                                 │
│  ┌───────────────────────────────────────────────────────┐   │
│  │        Server Layer                                    │   │
│  │  • http-server.ts  (Streamable HTTP stateless, MCP 표준)│  │
│  │  • http-config.ts  (env 파싱 — CORS/Origin/rate limit) │   │
│  └───────────────────────────────────────────────────────┘   │
└───────────────────────────┬───────────────────────────────────┘
                            │ HTTPS
                            ▼
┌──────────────────────────────────────────────────────────────┐
│         Korea Ministry of Government Legislation API          │
│                    (law.go.kr Open API)                       │
├──────────────────────────────────────────────────────────────┤
│  lawSearch.do  - 검색 (law/admrul/ordin/prec/expc/...)       │
│  lawService.do - 조회 (eflaw/admrul/ordin/prec/...)          │
└──────────────────────────────────────────────────────────────┘
```

### Key Architectural Principles

1. **Separation of Concerns**: Tools → Shared Libs → API Client
2. **Single Responsibility**: 파일당 200줄 미만, 단일 기능 (예외: `risk-rules.ts`. 기존 초과 파일이 남아 있다 — CLAUDE.md 규칙 2 참조)
3. **Centralized Tool Registry**: 99개 도구를 `tool-registry.ts`의 `allTools[]`에 등록. 그중 `V3_EXPOSED` 10개만 `ListTools`로 노출하고 나머지는 `execute_tool` 경유 — 클라이언트 컨텍스트에 99개 description을 싣지 않기 위한 것
4. **Type Safety**: TypeScript strict mode + Zod validation
5. **Stateless HTTP**: MCP StreamableHTTP stateless 모드 — 요청마다 fresh Server+Transport, AsyncLocalStorage로 요청별 API 키 격리 (재시작·스케일아웃 내성)
6. **Network Resilience**: 30s timeout, 3 retries with exponential backoff
7. **Dual Interface**: MCP 서버 + CLI 동시 지원
8. **Bounded Work**: 요청 하나가 쓸 수 있는 업스트림 호출 수·본문 바이트에 상한이 있다 (`execution-limits.ts`). 한 도구가 팬아웃해도 예산은 요청 단위로 공유된다
9. **Single Source per Domain Vocabulary**: 사건부호·별표 표기·조문 앵커·본문 판정 술어처럼 여러 도구가 공유하는 지식은 정의 파일이 하나뿐이어야 한다 — 사본이 생기면 한쪽만 낡는다

---

## Component Deep Dive

### Entry Point (`src/index.ts`)

- MCP 서버 초기화
- CLI 인자 파싱 (`--mode stdio|sse|http`, `--port`)
- `registerTools(server, apiClient)` 호출로 99개 도구 일괄 등록

### Tool Registry (`src/tool-registry.ts`)

모든 도구를 `allTools[]` 배열로 관리. 각 도구는 `{ name, description, schema, handler }` 구조.
- `ListToolsRequest` → allTools에서 name/description/inputSchema 반환
- `CallToolRequest` → name으로 매칭 후 handler 실행
- `unwrapZodEffects()`: `.refine()` 적용된 Zod 스키마를 MCP JSON Schema로 변환

### CLI (`src/cli.ts`)

- `korean-law "민법 제1조"` 자연어 한 줄 → `query-router`가 도구/파라미터 결정 (v2.0)
- `korean-law` 인자 없이 실행하면 REPL 모드
- `korean-law <tool> --param value` 형태로 99개 도구 직접 실행도 유지
- `korean-law list [--category ...]` / `help <tool>` / `--json-input`
- CLI 경로(`cli.ts`/`cli-executor.ts`/`cli-format.ts`)는 별도 바이너리라 `console.log`를 쓴다 — STDIO MCP 경로와 섞이지 않는다

### API Client (`src/lib/api-client.ts`)

- 법제처 API URL 구성 + HTTP 요청
- HTML 에러 페이지 감지 (JSON/XML 대신 HTML 반환 시)
- 도메인별 메서드: `searchLaw()`, `getLawText()`, `getAnnexes()` 등

### 라우팅 (`src/lib/query-router.ts` + `route-patterns.ts` + `query-extract.ts`)

자연어 한 줄을 도구 호출로 바꾸는 층. CLI와 MCP(`legal_research` 체인)가 같은 판정을 쓴다.

- `route-patterns.ts` — "어떤 자연어가 어떤 도구로"의 **선언부**(`Pattern[]`). 우선순위·양보(`yieldsTo`) 포함
- `query-router.ts` — 매칭 엔진. 날짜 범위는 매칭 이후에 뽑아 결과에 첨부
- `query-extract.ts` — 질의 → 파라미터 추출기(법령명·조문번호·별표 표기·지역 판정)
- `scenario-rules.ts` — 시나리오 판정 어휘의 단일 원본. 라우터가 별도 규칙을 갖지 않으므로 CLI와 MCP가 갈릴 수 없다

### 실행 예산 (`src/lib/execution-limits.ts`)

요청 하나(JSON-RPC 배치 포함)가 공유하는 회계 객체. `fetch-with-retry`가 시도마다 소비한다.

| 한도 | 기본 | env |
|---|---|---|
| 업스트림 시도 횟수 | 48 | `MCP_MAX_UPSTREAM_REQUESTS` |
| 응답 1건 본문 | 2 MiB | `MCP_MAX_UPSTREAM_BODY_BYTES` |
| 요청 전체 본문 합 | 8 MiB | `MCP_MAX_TOTAL_UPSTREAM_BODY_BYTES` |
| 도구 응답 문자 | 50,000자 | `MCP_MAX_TOOL_RESPONSE_CHARS` |

`parseIntegerLimit`이 경계값을 통째로 정수 검사한다 — `parseInt("12x") → 12` 관용을 받지 않는다. 체인 데드라인도 같은 검증을 쓴다.

### 미스 판정 (`src/lib/body-shape.ts` + `upstream-miss.ts`)

법제처 DRF는 **실패도 HTTP 200**으로 준다. 미스 본문의 형태는 `target`과 `type`의 조합이 결정한다 — 0바이트, 안내 XML, 권한 안내 HTML이 모두 200으로 온다.

- `body-shape.ts` — HTML/빈 본문 술어의 단일 원본 (앵커·대소문자 규칙이 한 벌)
- `upstream-miss.ts` — "이 200은 실패다"를 확정. 확정 전 1회 재확인 후 `UpstreamRecordMissingError`

### 체인 데드라인 (`src/tools/chain-deadline.ts`)

병렬화는 평균을 줄이지만 업스트림 꼬리는 못 막는다. 시간이 다하면 **받은 갈래까지 조립하고 못 받은 자리는 마커로 남긴다**. 부분 결과는 유효한 답이므로 `isError`가 아니다.
기본 45초(`MCP_CHAIN_DEADLINE_MS`, 5초~5분) — MCP 클라이언트 기본 타임아웃 60초보다 짧게 잡는다.

### Cache (`src/lib/cache.ts`)

- LRU 캐시 + TTL (검색 1시간, 조문 24시간)
- 최대 100 엔트리, 1시간마다 expired 정리

### Annex File Parser (`src/lib/annex-file-parser.ts`)

별표/서식 파일 자동 파싱:
- **HWPX** (신형, ZIP 기반): `jszip` + `@xmldom/xmldom` → Markdown 테이블
- **HWP** (구형, OLE 기반): `hwp.js` → `paragraph.content` + `controls[].content` 테이블 추출
- **PDF**: 파싱 불가 → 링크 반환

---

## Data Flow Patterns

### Pattern 1: 검색 → 조회 (2-step)

```
search_law("근로기준법") → mst: 276787
  ↓
get_law_text(mst="276787", jo="제74조")
```

### Pattern 2: 배치 조회 (1 API call)

```
get_batch_articles(mst="279811", articles=["제38조","제39조","제40조"])
  → 전체 법령 1회 조회 후 조문 필터링
```

### Pattern 3: 체인 도구 (자동 다단계)

```
chain_full_research(query="음주운전 처벌")
  → search_ai_law → get_law_text → search_precedents → search_interpretations
  → 병렬 실행, 섹션별 응답 결합
```

### Pattern 4: 별표 본문 추출

```
get_annexes(lawName="여권법 시행령", bylSeq="000000")
  → 목록 수집(페이지네이션: 100건/페이지, 상한 5페이지)
  → annex-notation 이 표기를 6자리 코드(AAAABB)로 정규화
  → annex-select 가 번호·제목·위임조문으로 항목 특정
  → 현행 본문 별표단위와 대조(정본 링크·신설 병합, annex-canonical)
  → 파일 다운로드 → 매직바이트 감지 → HWPX/HWP/PDF 분기
```

### Pattern 5: 자연어 라우팅 (CLI·MCP 공통)

```
"도로교통법 시행규칙 별표 제28호"
  → route-patterns 매칭 (annex 패턴)
  → query-extract → annex-notation → { lawName, annexNo:"28" }
  → get_annexes
```

라우터가 시나리오 판정을 자체 규칙으로 하지 않는다 — `scenario-rules`가 단일 원본이라
CLI와 MCP가 같은 질의에 다른 시나리오를 고를 수 없다.

### Pattern 6: 200인 실패 → 미스 확정

```
lawService.do(존재하지 않는 ID) → HTTP 200 + 0바이트 (또는 안내 XML / 권한 HTML)
  → body-shape 술어로 형태 판정
  → 재시도 사다리 소진 전 1회 재확인
  → UpstreamRecordMissingError → [UPSTREAM_NO_DATA] 안내
```

상태코드만 보면 성공이라 그냥 통과한다. 그래서 **본문 형태**로 판정한다.

### Pattern 7: 체인 데드라인 → 부분 결과

```
legal_research(task="action_basis")  ── 45초 ──▶ 만료
  → 끝난 갈래: 값 유지
  → 못 끝낸 갈래: 마커 + 그것만 따로 받는 도구 안내
  → 프리픽스(기반 법령 탐색)에서 만료: 그때까지 모은 섹션 + 말미 표시로 부분 반환
  → isError 아님 (부분 결과는 유효한 답)
```

적용 범위는 `legal_research` 8개 task 중 **`action_basis`·`full_research`·`dispute_prep` 3종**이다
— 순차 상세조회 사다리가 길어 꼬리 지연 인질이 실측된 체인들. 나머지 task 는 데드라인
미적용으로, 개별 fetch 타임아웃(30초×재시도)만 걸린다. 데드라인은 기반 법령 탐색(프리픽스)
부터 묶는다 — 프리픽스가 시계 밖이면 5초 설정에 19.5초가 실측됐다(#150).

---

## Performance Optimizations

| 최적화 | 효과 |
|--------|------|
| `search_all` 병렬 API 호출 | 1200ms → 450ms (63% 감소) |
| `get_batch_articles` 1회 조회 | N API calls → 1 API call |
| 체인 도구 병렬 섹션 | 순차 대비 2~3배 빠름 |
| LRU 캐시 (hit rate ~82%) | 반복 조회 85% 응답 시간 감소 |
| `truncateSections()` | 체인 응답 크기 최적화 |
| 판례 응답 compact | 토큰 74% 감축 |
| `V3_EXPOSED` 10개만 노출 | ListTools 컨텍스트에 99개 description을 싣지 않음 |
| 체인 데드라인 + 부분 결과 | 꼬리 지연에서 타임아웃 대신 부분 답 |

> 레이턴시 수치는 측정 시점·소스 IP에 따라 흔들린다. 업스트림 실측 방법과 최신 값은
> `docs/UPSTREAM-PERF.md`를 따른다 — 이 표는 최적화의 **방향**을 적은 것이지 SLA가 아니다.
> 계열별 바닥이 다르다: `lawSearch` ~0.45s vs `lawService` ~0.9–1.3s.

---

## Deployment Architecture

### Local (STDIO)

```json
{
  "mcpServers": {
    "korean-law": {
      "command": "korean-law-mcp",
      "env": { "LAW_OC": "your-key" }
    }
  }
}
```

### Remote (통합 호스트)

프로덕션은 이 레포가 아니라 **gomdori-mcp 통합 호스트**(fly 앱 `korean-law-mcp` 1대에 MCP 5종 동거)가 서빙한다.
이 레포에 `fly.toml`은 없다 — 배포 설정은 통합 호스트 쪽에 있다. **이 레포에서 `fly deploy` 금지** ([FLY-COST.md](FLY-COST.md)).

- **Dockerfile**: multi-stage build (Node 22.12.0 Alpine image pinned by digest; install scripts disabled for optional native helpers)
- **Health check**: `GET /health` (30초 간격)
- **Endpoint**: `https://mcp.gomdori.app/law`
  - 구 `https://korean-law-mcp.fly.dev/mcp` 도 하위호환으로 계속 동작한다 — 통합 호스트가 이 fly 앱 위에 떠 있고, 프리픽스 없는 요청을 law 로 원경로 전달하기 때문. 신규 안내는 공식 주소로.

```json
{
  "mcpServers": {
    "korean-law": {
      "url": "https://mcp.gomdori.app/law"
    }
  }
}
```

### Docker (자체 호스팅)

```bash
docker build -t korean-law-mcp .
docker run -e LAW_OC=your-key -e MCP_HTTP_HOST=0.0.0.0 \
  -e MCP_AUTH_TOKEN=replace-with-a-secret -p 3000:3000 korean-law-mcp
```

---

## Security

- **API 키**: 환경변수만 사용, 로그에 노출 금지
- **요청 격리**: `session-state.ts`의 AsyncLocalStorage로 요청별 API 키 분리 (stateless 모드, race condition 방지)
- **입력 검증**: Zod 스키마로 모든 도구 입력 검증
- **Rate Limiting**: `RATE_LIMIT_RPM` 환경변수 (기본 60 req/min). 배치 증폭 차단은 `MCP_MAX_BATCH_CALLS`
- **CORS / DNS rebinding**: `CORS_ORIGIN`·`ALLOWED_ORIGINS`. `Origin` 헤더가 붙은 요청은 허용 목록 밖이면 403
- **실행 예산**: 요청 하나의 업스트림 호출·본문 바이트 상한 (`execution-limits.ts`) — 한 요청이 서버 쿼터를 고갈시키지 못하게
- **에러 로깅**: HTTP 모드는 `scrubError()` 경유, URL은 `maskSensitiveUrl()` — API 키 유출 방지

---

## Related Docs

- [API.md](API.md) - 99개 도구 레퍼런스 (노출 10개)
- [DEVELOPMENT.md](DEVELOPMENT.md) - 개발자 가이드
- [UPSTREAM-PERF.md](UPSTREAM-PERF.md) - 업스트림 실측·재시도 정책 근거
- [FLY-COST.md](FLY-COST.md) - 통합 호스트 배포 배경 (이 레포에서 `fly deploy` 금지 이유)
- [README.md](../README.md) - 시작 가이드
