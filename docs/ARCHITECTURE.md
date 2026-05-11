# Korean Law MCP - System Architecture

> **v2.3.2** | Last Updated: April 2026

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
│               Korean Law MCP Server (v2.3.2)                  │
│                                                               │
│  ┌───────────────────────────────────────────────────────┐   │
│  │     Tool Registry (89 Zod-Validated Tools)            │   │
│  │         tool-registry.ts → allTools[]                 │   │
│  ├───────────────────────────────────────────────────────┤   │
│  │  검색 (11)   │ 조회 (9)      │ 분석 (9)              │   │
│  │  전문 (4)    │ 헌재/행심 (6) │ 지식베이스 (7)        │   │
│  │  기타 (4)    │ 체인 (7)      │ CLI 인터페이스        │   │
│  └───────────────────────────────────────────────────────┘   │
│                             ▲                                 │
│  ┌───────────────────────────────────────────────────────┐   │
│  │            Shared Libraries (src/lib/ 13개)           │   │
│  ├───────────────────────────────────────────────────────┤   │
│  │  • api-client.ts       (API 호출 + 캐시)              │   │
│  │  • xml-parser.ts       (6개 도메인 파서)              │   │
│  │  • annex-file-parser.ts (HWPX/HWP/PDF 파싱)          │   │
│  │  • search-normalizer.ts (약칭 해석, LexDiff)          │   │
│  │  • law-parser.ts       (JO 코드 변환, LexDiff)        │   │
│  │  • errors.ts           (LawApiError + 구조화된 에러)   │   │
│  │  • schemas.ts          (날짜/크기 검증)                │   │
│  │  • fetch-with-retry.ts (30s timeout, 3 retries)       │   │
│  │  • session-state.ts    (요청별 API 키 격리, ALS)       │   │
│  │  • cache.ts            (LRU + TTL)                    │   │
│  └───────────────────────────────────────────────────────┘   │
│                             ▲                                 │
│  ┌───────────────────────────────────────────────────────┐   │
│  │        Server Layer                                    │   │
│  │  • http-server.ts  (Streamable HTTP stateless, MCP 표준)│  │
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
2. **Single Responsibility**: 파일당 200줄 미만, 단일 기능
3. **Centralized Tool Registry**: 64개 도구를 `tool-registry.ts`의 `allTools[]`에 등록
4. **Type Safety**: TypeScript strict mode + Zod validation
5. **Stateless HTTP**: MCP StreamableHTTP stateless 모드 — 요청마다 fresh Server+Transport, AsyncLocalStorage로 요청별 API 키 격리 (재시작·스케일아웃 내성)
6. **Network Resilience**: 30s timeout, 3 retries with exponential backoff
7. **Dual Interface**: MCP 서버 + CLI 동시 지원

---

## Component Deep Dive

### Entry Point (`src/index.ts`)

- MCP 서버 초기화
- CLI 인자 파싱 (`--mode stdio|sse|http`, `--port`)
- `registerTools(server, apiClient)` 호출로 64개 도구 일괄 등록

### Tool Registry (`src/tool-registry.ts`)

모든 도구를 `allTools[]` 배열로 관리. 각 도구는 `{ name, description, schema, handler }` 구조.
- `ListToolsRequest` → allTools에서 name/description/inputSchema 반환
- `CallToolRequest` → name으로 매칭 후 handler 실행
- `unwrapZodEffects()`: `.refine()` 적용된 Zod 스키마를 MCP JSON Schema로 변환

### CLI (`src/cli.ts`)

- `korean-law <tool> --param value` 형태로 64개 도구 직접 실행
- `korean-law list [--category ...]`: 도구 목록/카테고리 필터
- `korean-law help <tool>`: 도구 상세 파라미터
- `--json-input`: JSON으로 복합 파라미터 전달

### API Client (`src/lib/api-client.ts`)

- 법제처 API URL 구성 + HTTP 요청
- HTML 에러 페이지 감지 (JSON/XML 대신 HTML 반환 시)
- 도메인별 메서드: `searchLaw()`, `getLawText()`, `getAnnexes()` 등

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
  → 파일 다운로드 → 매직바이트 감지 → HWPX/HWP/PDF 분기
  → HWP: controls 내 테이블 추출 → Markdown 변환
```

---

## Performance Optimizations

| 최적화 | 효과 |
|--------|------|
| `search_all` 병렬 API 호출 | 1200ms → 450ms (63% 감소) |
| `get_batch_articles` 1회 조회 | N API calls → 1 API call |
| 체인 도구 병렬 섹션 | 순차 대비 2~3배 빠름 |
| LRU 캐시 (hit rate ~82%) | 반복 조회 85% 응답 시간 감소 |
| `truncateSections()` | 체인 응답 크기 최적화 |

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

### Remote (Fly.io)

- **fly.toml**: `nrt` 리전, 256MB 메모리, auto suspend/resume
- **Dockerfile**: multi-stage build (node:20-alpine)
- **Health check**: `GET /health` (30초 간격)
- **Endpoint**: `https://korean-law-mcp.fly.dev/mcp`

```json
{
  "mcpServers": {
    "korean-law": {
      "url": "https://korean-law-mcp.fly.dev/mcp"
    }
  }
}
```

### Docker (자체 호스팅)

```bash
docker build -t korean-law-mcp .
docker run -e LAW_OC=your-key -p 3000:3000 korean-law-mcp
```

---

## Security

- **API 키**: 환경변수만 사용, 로그에 노출 금지
- **요청 격리**: `session-state.ts`의 AsyncLocalStorage로 요청별 API 키 분리 (stateless 모드, race condition 방지)
- **입력 검증**: Zod 스키마로 모든 도구 입력 검증
- **Rate Limiting**: `RATE_LIMIT_RPM` 환경변수 (기본 60 req/min)
- **CORS**: `CORS_ORIGIN` 환경변수로 제한

---

## Related Docs

- [API.md](API.md) - 64개 도구 레퍼런스
- [DEVELOPMENT.md](DEVELOPMENT.md) - 개발자 가이드
- [README.md](../README.md) - 시작 가이드
