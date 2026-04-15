# CLAUDE.md

Korean Law MCP Server v3.3.1 - 법제처 41개 API → 15개 통합 도구 (내부 91개) + 7개 시나리오 확장 + 자연어 CLI + HTTP stateless 모드

## Structure

```
src/
├── index.ts              # 엔트리포인트 (STDIO/HTTP 모드)
├── cli.ts                # CLI v2.0 (자연어 라우팅 + REPL)
├── tool-registry.ts      # 91개 도구 등록, V3_EXPOSED 15개만 노출
├��─ tools/                # 도구 구현 (46개 파일, 각 200줄 미만)
├── lib/
│   ├── api-client.ts     # API 클라이언트 (throwIfError/checkHtmlError 통일)
│   ├── query-router.ts   # 자연어 → 도구 라우팅 엔진
│   ├── fetch-with-retry.ts  # 타임아웃/재시도
│   ├── session-state.ts  # 요청별 API 키 격리 (AsyncLocalStorage, stateless)
│   ├── xml-parser.ts     # 공통 XML 파싱
│   ├── errors.ts         # 에러 표준화
│   ├── schemas.ts        # 날짜/응답크기 검증 (truncateResponse)
│   ├── search-normalizer.ts  # 검색어 정규화 (LexDiff)
│   ├── law-parser.ts     # JO 코드 변환 (LexDiff)
│   ├── annex-file-parser.ts  # 별표 파일 파서 (kordoc 통합 파서)
│   ├── tool-profiles.ts  # 도구 카테고리 매핑 (discover_tools용)
│   ├── article-parser.ts # 조문 파서 (항/호/목 단일객체 정규화)
│   ├── cache.ts          # LRU 캐시 (TTL, 만료 우선 eviction)
│   ├── three-tier-parser.ts  # 3단 비교 파서
│   ├── cli-format.ts     # CLI 출력 포맷팅
│   ├── cli-executor.ts   # CLI 쿼리 실행 엔진
│   ├── risk-rules.ts     # 문서 분석 리스크 규칙
│   ├── date-parser.ts    # 자연어 날짜 파서
│   ├── document-analysis.ts  # 문서유형 분류/금액추출/리스크 탐지
│   └── types.ts          # 공통 타입
└── server/               # HTTP 서버 (Express)
    └── http-server.ts    # Streamable HTTP stateless (MCP 공식 패턴, 매 요청 fresh Server+Transport, 100kb body limit)
```

## Commands

```bash
npm install           # 의존성 설치
npm run build         # TypeScript 빌드
npm run watch         # 개발 모드
LAW_OC=키 node build/index.js  # MCP 서버 실행
```

## CLI Usage (v2.0)

```bash
# 자연어 한 줄로 법령 조회
korean-law "민법 제1조"                    # 조문 직접 조회
korean-law "음주운전 처벌 기준"             # 종합 리서치 자동 실행
korean-law "관세법 3단비교"                 # 법체계 분석
korean-law "건축허가 거부 판례"             # 판례 검색
korean-law "서울시 주차 조례"               # 자치법규 검색

# 대화형 모드
korean-law                                 # REPL 모드 진입
korean-law interactive                     # 명시적 REPL 모드

# 기존 방식 (직접 도구 호출)
korean-law search_law --query "민법"
korean-law get_law_text --mst 160001 --jo "제1조"
```

## Environment

`LAW_OC`: 법제처 API 키 (필수) - https://open.law.go.kr/LSO/openApi/guideResult.do

## Domain Knowledge

**JO Code**: 조문번호 6자리 코드 (AAAABB)
- AAAA: 조번호 (zero-padded)
- BB: 의X 번호 (없으면 00)
- 예: 제38조 → 003800, 제10조의2 → 001002

## AI Usage Patterns

**자치법규 → 상위법령 Fallback**:
자치법규(조례/규칙)에서 원하는 규정을 못 찾으면 상위법령 검색

| 키워드 | 상위법령 | 주요 조문 |
|--------|----------|-----------|
| 휴직, 복무, 징계 | 지방공무원법 | 제63조(휴직), 제48조(복무), 제69조(징계) |
| 인사, 임용 | 지방공무원 임용령 | - |
| 급여, 수당 | 지방공무원 보수규정 | - |

**검색 체인 예시**:
```
search_ordinance("광진구 휴직") → 없음
  ↓
search_law("지방공무원법") → MST 획득
  ↓
get_law_text(mst, jo="006300") → 제63조(휴직) 조회
```

## Critical Rules

1. **LexDiff 코드 수정 금지**: `search-normalizer.ts`, `law-parser.ts`는 LexDiff에서 가져온 코드. 수정 시 원본 확인 필수
2. **파일 크기 200줄 미만**: 초과 시 `src/lib/`로 분리 (예외: `risk-rules.ts`는 데이터 선언 위주라 500줄 경계 허용)
3. **Zod 스키마**: 모든 도구 입력에 Zod 검증 필수
4. **도구 추가**: `tool-registry.ts`의 `allTools` 배열에 추가
5. **truncateResponse 필수**: 모든 도구의 최종 출력에 `truncateResponse()` 적용 (50KB 제한)
6. **단일 객체 정규화**: API 응답의 배열 필드가 단일 객체로 올 수 있음 — `Array.isArray(x) ? x : [x]` 패턴 사용
7. **cleanHtml 재사용**: HTML 엔티티 디코딩은 `article-parser.ts`의 `cleanHtml()` 사용 (수동 디코딩 금지)
8. **console.log/error 금지**: STDIO 모드에서 간섭 방지. 에러는 throw로 전파
9. **String() 방어 코딩**: MCP 클라이언트가 숫자를 보낼 수 있음 — `URLSearchParams.append(key, String(value))` 사용
10. **캐시 키 분리**: `lawtext:` (law-text.ts, 문자열), `batch:` (batch-articles.ts, JSON 객체) — 타입 충돌 금지

## Key Files

| 파일 | 역할 |
|------|------|
| `cli.ts` | CLI v2.0 — 자연어 라우팅 + REPL |
| `lib/query-router.ts` | 자연어 → 도구 자동 라우팅 엔진 |
| `tool-registry.ts` | 91개 도구 정의, V3_EXPOSED 15개 노출 |
| `tools/unified-decisions.ts` | 17개 도메인 통합 (search_decisions + get_decision_text) |
| `lib/fetch-with-retry.ts` | 30초 타임아웃, 3회 재시도 |
| `lib/session-state.ts` | AsyncLocalStorage 요청 컨텍스트 (API 키) |
| `lib/annex-file-parser.ts` | 별표 파싱 (kordoc 2.3 통합 파서) |
| `lib/xml-parser.ts` | 6개 도메인별 XML 파서 |
| `lib/tool-profiles.ts` | 도구 카테고리 매핑 (discover_tools용) |
| `tools/meta-tools.ts` | discover_tools + execute_tool (전문 도구 접근) |
| `tools/chains.ts` | 8개 체인 도구 + scenario 분기 (자동감지/수동지정) |
| `tools/scenarios/index.ts` | 시나리오 통합 실행기 + detectScenario() |
| `tools/scenarios/*.ts` | 7개 시나리오 모듈 (penalty/customs/manual/delegation/impact/timeline/compliance) |
| `lib/article-parser.ts` | 조문 파서 (cleanHtml, extractHangContent) |

## Docs

상세 정보는 별도 문서 참조:
- [docs/API.md](docs/API.md) - 도구 레퍼런스 (15개 노출 + 76개 execute_tool 접근)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - 시스템 설계, 데이터 플로우
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) - 개발 가이드
