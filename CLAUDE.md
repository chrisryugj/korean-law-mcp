# CLAUDE.md

> ## ⚠️ 배포 — 통합 호스트 (2026-07-02부터)
>
> 프로덕션은 이 레포가 아니라 **[gomdori-mcp](https://github.com/chrisryugj/gomdori-mcp) 통합 호스트**(fly 앱 `korean-law-mcp` 1대, MCP 5종 동거)가 서빙한다.
> - 공식 주소: `https://mcp.gomdori.app/law` (구 `korean-law-mcp.fly.dev/mcp`는 하위호환으로 유지)
> - **반영 절차**: 이 레포 커밋·푸시 → `npm publish` → `~/workspace/gomdori-mcp/Dockerfile`의 `korean-law-mcp@X.Y.Z` 핀 갱신 → `cd ~/workspace/gomdori-mcp && fly deploy -c fly.production.toml`
> - **🚫 이 레포에서 `fly deploy` 직접 실행 절대 금지** — 통합 이미지를 law 단독 이미지로 덮어써 stats·patent·archhub·school까지 전부 죽는다. 자세한 배경: [docs/FLY-COST.md](docs/FLY-COST.md)

Korean Law MCP Server v4.7.0 - 법제처 42개 API → 10개 통합 도구 (내부 98개) + 9개 시나리오 + 자연어 CLI + HTTP stateless + 판례 토큰 74% 감축 + **legal_research (체인 8종 통합, task 파라미터)** + **legal_analysis (인용검증·판례생사·행위시법·영향그래프 통합, mode 파라미터)** + **time_travel (시점 diff)** + **action_plan (이럴 땐 이렇게, 5단계 안내)** + **시행예정 감지 (search_law가 제명변경·미시행 개정 자동 병기)** + **ordinance_radar (조례 정비 레이더 — 근거 상위법 개정 자동 대조, v4.7.0)**

## Structure

```
src/
├── index.ts              # 엔트리포인트 (STDIO/HTTP 모드)
├── cli.ts                # CLI v2.0 (자연어 라우팅 + REPL)
├── tool-registry.ts      # 98개 도구 등록, V3_EXPOSED 10개만 노출 (TOOL_COUNTS 파생값)
├── tools/                # 도구 구현 (50개 파일, 각 200줄 미만)
├── lib/
│   ├── api-client.ts     # API 클라이언트 (throwIfError/checkHtmlError 통일)
│   ├── query-router.ts   # 자연어 → 도구 라우팅 엔진 (verify/비교/시간필터 패턴 포함)
│   ├── fetch-with-retry.ts  # 타임아웃/재시도 + maskSensitiveUrl (API키 로그 유출 방지)
│   ├── session-state.ts  # 요청별 API 키 격리 (AsyncLocalStorage, stateless)
│   ├── xml-parser.ts     # 공통 XML 파싱
│   ├── errors.ts         # 에러 표준화
│   ├── schemas.ts        # 날짜/응답크기 검증 (truncateResponse)
│   ├── search-normalizer.ts  # 검색어 정규화 (LexDiff, 약칭 52개)
│   ├── upcoming-laws.ts  # 시행예정 법령 감지 (eflaw 보조검색 — 제명변경·미시행 개정 병기)
│   ├── law-parser.ts     # JO 코드 변환 (LexDiff)
│   ├── annex-file-parser.ts  # 별표 파일 파서 (kordoc 통합 파서)
│   ├── tool-profiles.ts  # 도구 카테고리 + TOOL_ALIASES (한국어 별칭 매칭)
│   ├── article-parser.ts # 조문 파서 (항/호/목 단일객체 정규화)
│   ├── decision-compact.ts # 판례 토큰 최적화 + compactLongSections (14도메인 후처리)
│   ├── cache.ts          # LRU 캐시 (TTL, 만료 우선 eviction)
│   ├── three-tier-parser.ts  # 3단 비교 파서
│   ├── cli-format.ts     # CLI 출력 포맷팅
│   ├── cli-executor.ts   # CLI 쿼리 실행 엔진
│   ├── risk-rules.ts     # 문서 분석 리스크 규칙
│   ├── date-parser.ts    # 자연어 날짜 파서
│   ├── document-analysis.ts  # 문서유형 분류/금액추출/리스크 탐지
│   └── types.ts          # 공통 타입
└── server/               # HTTP 서버 (Express)
    └── http-server.ts    # Streamable HTTP stateless + scrubError + TRUST_PROXY 환경변수
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

# v4.0 킬러 기능
korean-law "민법 제103조 인용한 판례"        # impact_map: 조문 영향 그래프 (mermaid 포함)
korean-law "관세법 2024 vs 2026"             # time_travel: 두 시점 본문 자동 diff
korean-law "전세금 못 받았어"                # action_plan: 이럴 땐 이렇게, 5단계 안내

# v4.3 킬러 기능
korean-law "2013다61381 아직 유효해?"        # cite_check: 판례 생사 확인 (후속 인용 역추적 + 변경·폐기 감지)
korean-law "2023.5.10 당시 도로교통법 제44조" # applicable_law: 행위시법 판단 + 부칙 경과규정 발췌

# 대화형 모드
korean-law                                 # REPL 모드 진입
korean-law interactive                     # 명시적 REPL 모드

# 기존 방식 (직접 도구 호출)
korean-law search_law --query "민법"
korean-law get_law_text --mst 160001 --jo "제1조"
```

## Environment

- `LAW_OC`: 법제처 API 키 (필수) - https://open.law.go.kr/LSO/openApi/guideResult.do
- `TRUST_PROXY`: Express trust proxy (기본 `1`, 첫 프록시만 신뢰). 다단 프록시는 숫자 증가, CIDR/IP 리스트도 패스스루. `true`/`all`은 XFF 스푸핑 위험으로 명시적 opt-in 필요
- `CORS_ORIGIN`: CORS 허용 도메인 (기본 `*` — 프로덕션 명시 권장)
- `RATE_LIMIT_RPM`: IP당 분당 요청 한도 (기본 `60`)
- `FALLBACK_RATE_LIMIT_RPM`: 자체 키 없는 요청의 서버 LAW_OC 폴백 전역 상한 (기본 `120`, `0`이면 폴백 비활성)
- `MCP_BODY_LIMIT`: POST body 한도 (기본 `100kb`)
- `MCP_MAX_BATCH_CALLS`: 단일 POST(JSON-RPC 배치)에 허용하는 tools/call 최대 개수 (기본 `20`) — 배치 증폭으로 rate limit·폴백 쿼터 우회 차단

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
8. **console.log/error 금지**: STDIO 모드에서 간섭 방지. 에러는 throw로 전파. HTTP 모드 에러 로깅은 반드시 `scrubError()` 경유 (API 키 유출 방지)
9. **String() 방어 코딩**: MCP 클라이언트가 숫자를 보낼 수 있음 — `URLSearchParams.append(key, String(value))` 사용
10. **캐시 키 분리**: `lawtext:` (law-text.ts, 문자열), `batch:` (batch-articles.ts, JSON 객체) — 타입 충돌 금지
11. **API 키 마스킹**: URL/에러 메시지 외부 노출 전 `maskSensitiveUrl()` 적용. 새 fetch 래퍼 추가 시 주의
12. **full 옵션 일관성**: 판례류 도메인 추가 시 `unified-decisions.ts`의 `ALREADY_COMPACTED` set 고려. 자체 compact 미구현이면 `compactLongSections` 후처리에 자동 편입됨

## Key Files

| 파일 | 역할 |
|------|------|
| `cli.ts` | CLI v2.0 — 자연어 라우팅 + REPL |
| `lib/query-router.ts` | 자연어 → 도구 자동 라우팅 (verify/비교/시간필터/impact_map/time_travel/action_plan 포함) |
| `tool-registry.ts` | 98개 도구 정의, V3_EXPOSED 10개 노출 (TOOL_COUNTS 파생값) |
| `tools/legal-research.ts` | chain_* 8개 통합 진입점 — task 파라미터 디스패치 (v4.4.0) |
| `tools/legal-analysis.ts` | 킬러피처 4개 통합 진입점 — mode 파라미터 디스패치 (v4.4.0) |
| `tools/verify-citations.ts` | LLM 환각 방지 인용 검증 (v3.5 killer feature) |
| `tools/impact-map.ts` | 조문 영향 그래프 + mermaid 시각화 (v4.0 killer feature) |
| `tools/cite-check.ts` | 판례 생사 확인 — 후속 인용 역추적 + 별칭 추적 변경·폐기 감지 (v4.3 killer feature) |
| `tools/applicable-law.ts` | 행위시법 판단 — 시점 적용 버전 특정 + 부칙 경과규정 발췌 (v4.3 killer feature) |
| `tools/ordinance-radar.ts` | 조례 정비 레이더 — 제1조(목적) 근거법 추출 + 상위법 개정 대조 자동 플래그 (v4.7.0 killer feature) |
| `tools/unified-decisions.ts` | 17개 도메인 통합 + compactLongSections 후처리 축약 |
| `lib/decision-compact.ts` | 판례 토큰 최적화 (compactBody/densify/stripRepeatedSummary/compactLongSections) |
| `lib/fetch-with-retry.ts` | 30초 타임아웃 + 3회 재시도 + maskSensitiveUrl |
| `lib/session-state.ts` | AsyncLocalStorage 요청 컨텍스트 (API 키) |
| `lib/historical-utils.ts` | 연혁 raw 추출 (time_travel 시나리오용, v4.0) |
| `lib/annex-file-parser.ts` | 별표 파싱 (kordoc 3.0 통합 파서) |
| `lib/xml-parser.ts` | 6개 도메인별 XML 파서 |
| `lib/tool-profiles.ts` | 도구 카테고리 매핑 (discover_tools용) |
| `tools/meta-tools.ts` | discover_tools + execute_tool (전문 도구 접근) |
| `tools/chains.ts` | 8개 체인 도구 + scenario 분기 (자동감지/수동지정) |
| `tools/scenarios/index.ts` | 시나리오 통합 실행기 + detectScenario() |
| `tools/scenarios/*.ts` | 9개 시나리오 모듈 (penalty/customs/manual/delegation/impact/timeline/compliance + v4.0 time-travel/action-plan) |
| `lib/article-parser.ts` | 조문 파서 (cleanHtml, extractHangContent) |

## Docs

상세 정보는 별도 문서 참조:
- [docs/API.md](docs/API.md) - 도구 레퍼런스 (10개 노출, 미노출 도구는 execute_tool 또는 직접 호출로 접근)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - 시스템 설계, 데이터 플로우
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) - 개발 가이드
