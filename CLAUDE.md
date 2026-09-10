# CLAUDE.md

> ## ⚠️ 배포 — 통합 호스트 (2026-07-02부터)
>
> 프로덕션은 이 레포가 아니라 **[gomdori-mcp](https://github.com/chrisryugj/gomdori-mcp) 통합 호스트**(fly 앱 `korean-law-mcp` 1대, MCP 5종 동거)가 서빙한다.
> - 공식 주소: `https://mcp.gomdori.app/law` (구 `korean-law-mcp.fly.dev/mcp`는 하위호환으로 유지)
> - **반영 절차**: 이 레포 커밋·푸시 → `npm publish` → **npm 전파 대기**(`npm view korean-law-mcp version`이 새 버전을 반환할 때까지 — 보통 30초 안쪽. 전파 전에 배포하면 이미지가 옛 버전을 설치한다) → `~/workspace/gomdori-mcp/Dockerfile`의 `korean-law-mcp@X.Y.Z` 핀 갱신 → `cd ~/workspace/gomdori-mcp && fly deploy -c fly.production.toml` → **GitHub Release 생성**(`gh release create vX.Y.Z`) → `gomdori-mcp/scripts/verify-deploy.sh` 로 사용자 경로 반영 확인
>   - **릴리스는 배포와 항상 같이 간다** — npm 게시만 하고 Release 를 빠뜨리면 이 레포의 릴리스 이력에 구멍이 남는다(v4.10.0·v4.11.0 이 그렇게 비었다가 2026-08-17 에 소급 생성됐다). 노트 본문은 CHANGELOG 의 해당 절을 옮긴다.
>   - `.github/workflows/publish.yml`(GitHub Release → OIDC trusted publishing + provenance)은 **npm 쪽 trusted publisher 등록이 아직 안 됐다**. 그래서 게시는 위 로컬 `npm publish` 가 정규 경로이고, Release 는 그 뒤에 만든다 — 워크플로는 같은 버전이 이미 레지스트리에 있으면 게시를 건너뛰고 검증(typecheck·test·build·verify:package·audit)만 릴리스 시점에 재확인한다.
> - **🚫 이 레포에서 `fly deploy` 직접 실행 절대 금지** — 통합 이미지를 law 단독 이미지로 덮어써 stats·patent·archhub·school까지 전부 죽는다. 자세한 배경: [docs/FLY-COST.md](docs/FLY-COST.md)

Korean Law MCP Server v4.13.0 - 법제처 42개 API → 10개 통합 도구 (내부 99개) + 9개 시나리오 + 자연어 CLI + HTTP stateless + 판례 토큰 74% 감축 + **legal_research (체인 8종 통합, task 파라미터)** + **legal_analysis (인용검증·판례생사·행위시법·영향그래프 통합, mode 파라미터)** + **time_travel (시점 diff)** + **action_plan (이럴 땐 이렇게, 5단계 안내)** + **시행예정 감지 (search_law가 제명변경·미시행 개정 자동 병기)** + **ordinance_radar (조례 정비 레이더 — 근거 상위법 개정 자동 대조, v4.7.0)** + **인용 검증 표기 내성 (낫표·가운뎃점·`같은 법` 조응, v4.9.0)** + **폐지 감지 (검색 0건 시 폐지 법령·행정규칙 연혁 추적 — 폐지사유·후속 통합 규정 자동 안내, v4.10.0)** + **search_law_bulk (등록부 대량 조회 + MST diff 감시, v4.13.0)**

## Structure

```
src/
├── index.ts              # 엔트리포인트 (STDIO/HTTP 모드)
├── cli.ts                # CLI v2.0 (자연어 라우팅 + REPL)
├── tool-registry.ts      # 99개 도구 등록, V3_EXPOSED 10개만 노출 (TOOL_COUNTS 파생값)
├── tools/                # 도구 구현 (76개 파일, scenarios/ 포함)
├── lib/
│   ├── api-client.ts     # API 클라이언트 (throwIfError/checkHtmlError 통일)
│   ├── query-router.ts   # 자연어 → 도구 라우팅 엔진 (verify/비교/시간필터 패턴 포함)
│   ├── fetch-with-retry.ts  # 타임아웃/재시도 + maskSensitiveUrl (API키 로그 유출 방지)
│   ├── session-state.ts  # 요청별 API 키·취소 신호·실행 예산 격리 (AsyncLocalStorage, stateless)
│   ├── execution-limits.ts  # 요청 단위 실행 예산 (upstream 호출 수·본문 byte) + env 정수 검증
│   ├── response-body.ts  # 예산·취소가 걸린 업스트림 본문 리더 (response.text() 대체)
│   ├── rate-limit.ts     # 토큰버킷 + 롤링 일일 캡 (폴백 쿼터 게이트, now 주입 테스트)
│   ├── xml-parser.ts     # 공통 XML 파싱
│   ├── errors.ts         # 에러 표준화
│   ├── schemas.ts        # 날짜/응답크기 검증 (truncateResponse)
│   ├── search-normalizer.ts  # 검색어 정규화 (LexDiff, 약칭 표제 60건 — LAW_ALIAS_ENTRIES 항목 수 기준)
│   ├── upcoming-laws.ts  # 시행예정 법령 감지 (eflaw 보조검색 — 제명변경·미시행 개정 병기)
│   ├── abolished-laws.ts # 폐지 감지 (법령=eflaw·행정규칙=nw=2 연혁 — 폐지사유·후속 통합 규정 안내)
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
    ├── http-config.ts    # 보안 env 시작 시점 검증 (bind host·trust proxy·각종 한도)
    └── http-server.ts    # Streamable HTTP stateless + scrubError + 연결 끊김 취소 전파
```

## Commands

```bash
npm ci --ignore-scripts  # 개발 도구 optional binding은 설치하되 lifecycle script는 비활성
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
- `MCP_HTTP_HOST`: HTTP 바인드 주소 (기본 `127.0.0.1`). 외부 바인드는 인증 또는 아래 명시적 override 필요
- `MCP_ALLOW_UNAUTHENTICATED_REMOTE`: 인증 없는 외부 바인드를 의도적으로 허용할 때만 `1`
- `TRUST_PROXY`: Express trust proxy (기본 `false`). 프록시 뒤에서만 `1`~`10`의 정확한 hop 수를 명시하며 문자열/CIDR/`true`는 허용하지 않음
- `CORS_ORIGIN`: CORS 허용 도메인 (기본 `*` — 프로덕션 명시 권장). **명시 설정 시 Origin 검증의 허용 목록으로도 취급**
- `ALLOWED_ORIGINS`: Origin 허용 목록(쉼표 구분). `Origin` 헤더가 붙은 요청은 이 목록에 없으면 403 — DNS rebinding 방어. 미설정 + `CORS_ORIGIN` 미설정이면 Origin 있는 요청은 전부 차단(비브라우저 클라이언트는 영향 없음)
- `MCP_AUTH_TOKEN`: 설정 시 `/mcp`에 `x-mcp-token` 또는 `Authorization: Bearer` 인증 요구. 비-loopback 배포는 이 값 또는 명시적 unauthenticated override가 필수
- `ALLOW_QUERY_API_KEY`: `0`이면 `?oc=` 쿼리스트링 API 키를 무시 (프록시 액세스 로그 유출 차단). 기본 `1`
- `RATE_LIMIT_RPM`: IP당 분당 요청 한도 (기본 `60`, 고정창). claude.ai 커넥터는 소수 egress IP를 공유하므로 넉넉히 잡을 것
- `FALLBACK_RATE_LIMIT_RPM`: 자체 키 없는 요청의 서버 LAW_OC 폴백 전역 상한 (기본 `120`, `0`이면 폴백 비활성). **토큰버킷** — 소진 후 연속 리필되며 429에 `Retry-After` 동반
- `FALLBACK_RATE_LIMIT_BURST`: 폴백 토큰버킷 용량 (기본 = `FALLBACK_RATE_LIMIT_RPM` = 1분치)
- `FALLBACK_DAILY_CAP`: 폴백의 롤링 24시간 총량 캡 (기본 `0` = 비활성). 분당을 풀되 하루 총량으로 서버 키 quota 보호
- `MCP_BODY_LIMIT`: POST body 한도 (기본 `100kb`)
- `MCP_MAX_BATCH_CALLS`: 단일 POST(JSON-RPC 배치)에 허용하는 tools/call 최대 개수 (기본 `20`) — 배치 증폭으로 rate limit·폴백 쿼터 우회 차단
- `MCP_MAX_UPSTREAM_REQUESTS`: 한 outer request가 사용할 수 있는 upstream attempt 수 (기본 `48`, 재시도/안티봇 hop 포함)
- `MCP_MAX_UPSTREAM_BODY_BYTES` / `MCP_MAX_TOTAL_UPSTREAM_BODY_BYTES`: 단일/전체 upstream 응답 본문 byte 한도
- `MCP_MAX_TOOL_RESPONSE_CHARS`: MCP 도구 응답 문자 한도 (기본 `50000`)
- `MCP_CHAIN_DEADLINE_MS`: 체인 한 건의 데드라인 (기본 `45000`, 허용 `5000`~`300000`, HTTP 모드는 부팅 시점 fail-fast 검증). **적용 task는 `legal_research` 8종 중 `action_basis`·`full_research`·`dispute_prep` 3종** — 순차 사다리가 길어 인질 시나리오가 실측된 체인들이다. 나머지 task는 아직 미적용(개별 fetch 타임아웃만). 적용 체인은 기반 법령 탐색(프리픽스)부터 시계 안이며, 만료 시 받은 갈래까지 조립해 **부분 결과**를 돌려주고 못 받은 자리는 마커로 남긴다 — MCP 클라이언트 기본 타임아웃 60초보다 넉넉히 짧게 잡을 것

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
   - 현재 `search-normalizer.ts`에는 **LexDiff 표 직접 편집**이 하나 있다(도로교통법 약칭, `LAW_ALIAS_ENTRIES` 배열 안쪽 · 상류 대조 주석 동반). 별도 파일 오버레이가 **아니므로** LexDiff 동기화 시 clean overwrite가 안 된다 — 덮어쓰기 전 이 항목을 옮겨야 한다
   - `citation-content-matcher.ts`도 LexDiff 이식본이다. 헤더가 "동작 동일" 재구현만 허용하므로 동작이 바뀌는 수정은 상류 대조 없이 넣지 않는다
2. **파일 크기 200줄 미만**: 초과 시 `src/lib/`로 분리 (예외: `risk-rules.ts`는 데이터 선언 위주라 500줄 경계 허용)
   - **(제안, 미확정)** `route-patterns.ts`도 같은 계열의 예외 후보다 — 본문 대부분이 단일 `Pattern[]` 데이터 배열이고, 도메인 축으로 쪼개면 "어느 규칙이 이겼는가"를 한 파일에서 못 읽게 된다. 채택하려면 예외 기준("데이터 선언 위주")을 명문화할 것
   - 현실 고지: 이 규칙을 넘긴 파일이 현재 45개다(테스트 제외 `src/**/*.ts` 200줄 초과, 2026-08 실측). 신규 파일에는 엄격히 적용하되, 기존 초과분 정리는 별도 과제
3. **Zod 스키마**: 모든 도구 입력에 Zod 검증 필수
4. **도구 추가**: `tool-registry.ts`의 `allTools` 배열에 추가
5. **truncateResponse 필수**: 모든 도구의 최종 출력에 `truncateResponse()` 적용. 한도는 **5만 자(UTF-16 code unit)**이지 50KB가 아니다 — 한글은 UTF-8로 자당 3바이트라 5만 자는 최대 150KB다(#92). `MCP_MAX_TOOL_RESPONSE_CHARS`는 **tool-registry의 최종 출력 게이트에만** 적용된다 — 도구 내부 호출들이 쓰는 기본 상수(`MAX_RESPONSE_SIZE`, 5만)는 env 로 움직이지 않으므로, 상향은 내부 절단에 막혀 무효이고 **하향만 실효**한다
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
| `tool-registry.ts` | 99개 도구 정의, V3_EXPOSED 10개 노출 (TOOL_COUNTS 파생값) |
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
| `lib/article-parser.ts` | 조문 파서 (cleanHtml, extractHangContent, CIRCLED_DIGITS ①~㊿) |

### 라우팅·추출 (query-router 분해 산물)

| 파일 | 역할 |
|------|------|
| `lib/route-patterns.ts` | 라우팅 패턴 테이블 — "어떤 자연어가 어떤 도구로" 선언부 |
| `lib/query-extract.ts` | 질의 → 도구 파라미터 추출기 (`lawNameFromQuery`, `stripArticleTail`, `extractAnnexParams`) |
| `lib/scenario-rules.ts` | 시나리오 판정 어휘 — CLI·MCP 공통 원본 |
| `lib/route-explain.ts` | 라우팅 근거 설명기 (`--verbose`/`explain`) |
| `lib/date-parser.ts` · `lib/date-patterns.ts` · `lib/date-types.ts` | 자연어 날짜 엔진 / 패턴 테이블 + 상대 시점 어휘 / 타입 |
| `lib/tool-discovery.ts` | discover_tools 랭킹·섹션 상한 |

### 인용·조문 앵커 (분석 도구 공용)

| 파일 | 역할 |
|------|------|
| `lib/case-citation.ts` | 사건부호 **단일 원본** — 추출·실존 확인 (`CASE_CODE_PATTERN`) |
| `lib/article-anchor.ts` | 조문 인용 앵커 파싱 + 법령명 동일성 판정 |
| `lib/citation-content-matcher.ts` | 인용 내용 일치 검증 (LexDiff 이식) |
| `lib/impact-buckets.ts` | impact_map 버킷 분류 |
| `lib/precedent-body.ts` | 판례 본문 필드 정규화 + 변경·폐기 문구 스캔 |

### 업스트림 경계 (실행 예산·미스 판정)

| 파일 | 역할 |
|------|------|
| `lib/execution-limits.ts` | 요청 단위 예산 + `parseIntegerLimit` (env 정수 검증 단일 원본) |
| `lib/response-body.ts` | 예산·취소가 걸린 본문 리더 |
| `lib/body-shape.ts` · `lib/upstream-miss.ts` | HTML/빈 본문 술어 단일 원본 / 미스 확정 판정 |
| `tools/chain-deadline.ts` | 체인 데드라인 + 부분 결과 조립 (`MCP_CHAIN_DEADLINE_MS`) |

### 별표/서식

| 파일 | 역할 |
|------|------|
| `lib/annex-notation.ts` | 별표 표기 문법 **단일 원본** (별표4 · 별표 제4호 · 별표 1의2 → AAAABB) |
| `tools/annex-list.ts` | 목록 수집 — 봉투 파싱 + 페이지네이션(업스트림 100건/페이지) |
| `tools/annex-select.ts` | 번호·제목·위임조문으로 목록에서 항목 선택 |
| `lib/annex-canonical.ts` | 현행 본문 별표단위 대조 (정본 링크·신설 병합) |

### 기타 공용

| 파일 | 역할 |
|------|------|
| `lib/escape-regex.ts` | 정규식 메타문자 이스케이프 단일 원본 |
| `lib/truncate-text.ts` | 의미 경계 절단 (`cutAtSafeBoundary`) |
| `lib/ordinance-relevance.ts` | 자치법규 조문 인용 실측 대조 |
| `lib/law-search.ts` | 법령명 완화 매칭 (`looseMatchLawName`) 등 검색 공용 |

## Docs

상세 정보는 별도 문서 참조:
- [docs/API.md](docs/API.md) - 도구 레퍼런스 (10개 노출, 미노출 도구는 execute_tool 또는 직접 호출로 접근)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - 시스템 설계, 데이터 플로우
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) - 개발 가이드
