# Changelog

## [3.5.4] - 2026-04-18

### Fixed (실사용 피드백: LLM이 조회 실패를 "성공"으로 오인하고 답변 생성)
사용자 피드백: "실사용하면 자꾸 답변 못 찾고 AI가 지맘대로 답변함. 못 찾으면 리턴값을 명확하게 주면 좋겠음."

**근본 원인**: 일부 도구가 조회 실패 시 `isError` 플래그를 설정하지 않거나, 응답 텍스트에 "없습니다"만 포함되어 LLM이 실패를 감지하지 못하고 창작 답변 생성.

### Added (환각 방지 명시 시그널)
- **`[NOT_FOUND]` / `[HALLUCINATION_DETECTED]` / `[API_ERROR]` 머신 파싱 가능 프리픽스** — 모든 실패 응답에 기계적으로 감지 가능한 마커 추가. LLM이 실패를 놓치지 않고 사용자에게 "검색 실패" 보고하도록 유도
- **`lib/errors.ts` `notFoundResponse(message, suggestions?)` 신규 헬퍼** — 특정 리소스 없을 때(조문/별표/파일 등) 일관된 NOT_FOUND 응답 생성
- **모든 "없습니다" 응답에 LLM 경고문 삽입** — "⚠️ LLM은 {조문/판례/법령}을 추측/생성하지 마세요" 문구 표준화

### Changed (isError 누락 수정 — 10+ 위치)
- `tools/annex.ts` — 별표 없음/선택자 매칭 실패/파일 링크 없음 3개 케이스 모두 `isError: true` 추가, `notFoundResponse` 사용
- `tools/verify-citations.ts` — `failCount > 0`일 때 `isError: true` 설정 + 헤더에 `[HALLUCINATION_DETECTED]` 마커 (가장 심각한 버그: 환각 검출됐는데 "검증 성공"으로 오인 가능)
- `tools/law-text.ts` / `tools/article-detail.ts` / `tools/article-history.ts` / `tools/historical-law.ts` — 법령/조문 없음 응답 강화
- `tools/law-linkage.ts` — 연계 법령 없음 응답에 `isError: true` 추가
- `tools/autocomplete.ts` / `tools/admin-rule.ts` / `tools/comparison.ts` — `isError: true` 누락 수정
- `tools/precedent-summary.ts` / `tools/precedent-keywords.ts` / `tools/knowledge-base.ts` / `tools/kb-utils.ts` / `tools/ordinance.ts` — NOT_FOUND 마커 + LLM 경고문
- `tools/precedents.ts` / `tools/treaties.ts` / `tools/ordinance-search.ts` — 검색 실패 응답 강화

### Changed (체인 도구 부분 실패 투명화)
- `tools/chains.ts` `secOrSkip()` — 에러 snippet 80자 → 200자 확장, 섹션 제목에 `[NOT_FOUND / FAILED]` 마커 + LLM 경고문 삽입
- 모든 silent-drop 패턴(`if (!result.isError) parts.push(sec(...))`) 제거 → `parts.push(secOrSkip(...))`로 일괄 전환. 체인 중 일부 단계가 실패해도 "왜 빠졌는지" 명시 노출
- `noResult()` — NOT_FOUND 마커 + "체인 실행 중단 — LLM은 추측 금지" 지시문 추가

### Impact
- LLM이 실패 응답을 기계적으로 감지 가능해져 창작/환각 답변 방지
- 체인 도구가 부분 실패해도 사용자에게 "어떤 데이터가 왜 빠졌는지" 명시적으로 노출
- 특히 `verify_citations`의 `isError` 누락은 환각 검출의 의미를 무력화하던 심각한 버그였음

## [3.5.3] - 2026-04-18

### Fixed (verify_citations 실제 검증 후 3개 치명 버그 수정)
실제 법제처 API로 5건 테스트 → 3건 false negative 발견 → 근본 원인 수정:

- **법제처 searchLaw 부분매칭 오매칭** — "민법" 검색 시 "난민법"이 1위로 리턴되던 문제. 기존 `chains.ts`의 `findLaws`/`scoreLawRelevance`가 이미 이 문제를 해결하고 있었으나 verify_citations가 재사용하지 않고 자체 로직으로 중복 구현했던 것. 공용 모듈 `lib/law-search.ts`로 추출하여 chains/verify 모두 재사용
- **원숫자(①②③…) 항번호 파싱 실패** — 법제처 API가 `항번호`를 "① "/"② " 형태로 리턴하는데 기존 `parseInt(raw.replace(/[^\d]/g, ""))`가 유니코드 원숫자를 제거하여 NaN. 근로기준법 제60조 제1항이 실존함에도 "최대 제0항" 오판정. `lib/article-parser.ts`에 `parseHangNumber()` 유틸 추가 (원숫자 매핑 + 일반 숫자 fallback)
- **짧은 법령명("상법") 검색 실패** — 법제처 lawSearch API가 "상법" 검색 시 부분매칭으로 "1980년해직공무원의보상등에관한특별조치법" 등을 먼저 리턴, 실제 "상법"은 결과 34번째. 기본 display=20으로는 못 찾음. `apiClient.searchLaw`에 display 파라미터 추가 + `findLaws`에 `searchDisplay` 옵션 추가, verify_citations에서 `searchDisplay=100`으로 호출

### Changed
- `lib/law-search.ts` 신규 — `findLaws`, `scoreLawRelevance`, `parseLawXml`, `stripNonLawKeywords`, `NON_LAW_NAME_RE`, `LawInfo` 타입을 `chains.ts`에서 추출하여 공용화
- `tools/chains.ts` — 중복 정의 제거, `law-search.ts` import
- `tools/verify-citations.ts` — 자체 법령 검색 로직 제거하고 `findLaws` + `parseHangNumber` 재사용 (중복 구현 금지 원칙)
- `lib/api-client.ts` — `searchLaw(query, apiKey, display?)` 시그니처 확장 (backward compatible)

### Verified
실제 법제처 API로 5건 테스트 — 5/5 정확 판정:
- ✓ 민법 제750조(불법행위) / 근로기준법 제60조 제1항(연차휴가) / 도로교통법 제44조(음주운전) 실존
- ✗ **상법 제401조의2 제7항 — 제7항 없음(최대 제2항) 환각 정확 탐지**
- ✗ 형법 제9999조 — 해당 조문 없음(존재 범위: 제1조~제372조)

## [3.5.2] - 2026-04-18

### Changed
- **kordoc 2.3.0 → 2.4.0** — 별표/서식 파싱 엔진 업데이트
  - 영향: `src/lib/annex-file-parser.ts` (HWP/HWPX/PDF 통합 파서)
  - API 호환 (minor bump, `parse`/`ParseResult`/`FileType` 시그니처 유지)

## [3.5.1] - 2026-04-18

### Removed (Dead Code)
- **lite/full 프로필 체계 완전 제거** — V3_EXPOSED 16개 고정 노출 도입 후 실질 미사용 상태였던 죽은 코드 정리
  - `lib/tool-profiles.ts`: `LITE_TOOLS` set(15개 엔트리), `parseProfile()`, `filterToolsByProfile()`, `ToolProfile` 타입 제거 (37줄 순감)
  - `tool-registry.ts`: `registerTools(server, apiClient, profile?)` → `registerTools(server, apiClient)` 시그니처 단순화. `filterToolsByProfile` import 제거
  - `index.ts`: `MCP_PROFILE` 환경변수 처리 제거, `parseProfile` / `ToolProfile` import 제거, `createServer(profile?)` → `createServer()`
  - `server/http-server.ts`: `?profile=` 쿼리 파라미터 파싱 제거, `createServer(profile)` 호출부 단순화
- 헬스 엔드포인트(`GET /`) 응답에서 거짓 `profiles: { lite, full }` 필드 제거 → `tools: { exposed: 16, total: 92 }` 정확 안내로 교체
- `mcp-lite: "/mcp?profile=lite"` 엔드포인트 안내 제거 (원래부터 무시되던 값)

### Why
- v3 통합 후 `tool-registry.ts`가 `V3_EXPOSED.has(t.name)`로만 필터링하고 `filterToolsByProfile`은 import만 되어 있고 호출 안 됨 → `?profile=lite`든 `?profile=full`든 **완전히 동일하게 16개 도구** 반환
- 헬스 엔드포인트는 여전히 `lite: "14 tools"` 안내 문구 노출 → 클라이언트에 **거짓 정보 전달** 중
- 배포된 상태에서 breaking change 아님: 기존 `?profile=lite` 호출은 지금도 이미 무시되던 값이므로 동작 변화 없음

### How to apply
- STDIO 모드: `MCP_PROFILE` 환경변수 이제 무시됨 (설정 안 해도 됨)
- HTTP 모드: `?profile=` 쿼리 파라미터 이제 무시됨 (모든 클라이언트 동일 16개 도구)
- 문서/튜토리얼에서 lite/full 언급 있으면 제거 권장 (CHANGELOG 역사 맥락은 유지)

## [3.5.0] - 2026-04-18

### Added (Killer Feature)
- **`verify_citations`** — LLM 환각 방지 인용 검증 도구 (신규 `src/tools/verify-citations.ts`, ~200줄):
  - 입력 텍스트에서 `제N조`/`제N조의M`/`제N조 제K항` 형식 인용을 정규식으로 자동 추출
  - 직전 30자 lookback으로 법령명(`XX법/법률/시행령/시행규칙/규칙/규정/조례`) 역추적
  - 각 인용에 대해 `search_law` + `get_law_text`(jo) 병렬 호출로 실존·내용·항 번호 교차검증
  - 결과: ✓(실존) / ✗(없음, 존재 범위 힌트) / ⚠(법령명 불명확/일시 실패)
  - `V3_EXPOSED`에 노출 — 15개 → 16개 도구. 자연어 라우팅(`인용검증`·`조문실존` 등)에도 연결
  - 타겟: 법률AI 서비스, 로펌, 법학생, 계약서 검토 — ChatGPT/Claude 답변의 조문 인용 환각 실시간 탐지

### Fixed (Critical)
- **`get_decision_text` `full` 옵션이 12개 도메인에서 묵묵히 무시되던 문제** — `unified-decisions.ts`는 `args.full`을 전달했지만 tax_tribunal/customs/ftc/pipc/nlrc/acr/appeal_review/acr_special/school/public_corp/public_inst/treaty/english_law/interpretation 핸들러가 스키마에 `full` 필드가 없어 탈락. 이제 `compactLongSections()` 후처리로 12개 도메인에도 축약 적용 (`precedent`/`constitutional`/`admin_appeal`은 자체 적용되므로 skip 리스트)
- `decision-compact.ts:132` `densifyPrecedentRefs` 날짜 정규식에 경계 가드(`(^|[\s,(\[;/])`) 추가 — 문서 중간 `제2020. 3. 26. 개정` 같은 숫자 오탐 방지
- `decision-compact.ts:59` `compactBody` TAIL 경계에서 `". "` 제외 + `"한다. "` / `"라. "` 추가 — `"1,234.00 원"`·`"No. 3"` 오탐 방지
- `decision-compact.ts:166` `stripRepeatedSummary` 종료점 탐지 강화 — 요약 끝 60자 매칭으로 실제 end 계산, 매칭 실패 시 보수적으로 `s.length`만 제거 (요약 뒤 본문 같이 날아가는 사고 방지)

### Fixed (Security)
- `fetch-with-retry.ts:72` 타임아웃/네트워크 에러 메시지에 API 키 포함 URL이 그대로 노출되던 문제 — `maskSensitiveUrl()` 신규로 `OC=***`·`apiKey=***` 등 마스킹 후 throw
- `http-server.ts:136` `console.error("[POST /mcp] Error:", error)`에서 원본 에러 로깅 시 키 노출 가능성 — `scrubError()` 경유로 통일
- `http-server.ts:19` `trust proxy true` → `TRUST_PROXY` 환경변수 (기본 `1`, 첫 프록시만 신뢰). `X-Forwarded-For` 스푸핑으로 rate limit 우회 + 메모리 DoS 위험 차단
- body limit 환경변수화(`MCP_BODY_LIMIT`, 기본 `100kb`)

### Changed (UX)
- **체인 도구 8개 description 구체화** — LLM이 `search_law` vs `chain_law_system` 중 선택 가능하게. 각 체인에 구체적 사용 예시(`"관세법 체계"`, `"음식점 영업정지 근거"`, `"서울시 주차 조례 전국 비교"` 등) + 언제 쓰지 말아야 하는지 명시
- `search_law`/`search_ordinance`/`search_precedents` 결과에 "💡 다음: get_law_text(mst=...)" 형태 **다음 단계 힌트** 추가 — 검색→조회 흐름 자동 유도
- `search_law` 0건 시 **`expandLawQuery` 자동 재시도** — 약칭(`"근기법"` → `"근로기준법"`)/오타 확장으로 성공률 상승
- `query-router.ts` **5개 패턴 추가** — `verify_citations`(인용검증 키워드), 법령 비교(`vs`/`와/과 차이`), 시간 필터(`최근 N년 개정`), 민사책임(`손해배상`/`과실비율`), 계약서 검토(`독소조항`)
- `tool-profiles.ts` **`TOOL_ALIASES`** 맵 추가 — `"조세심판원"` → `search_tax_tribunal_decisions`, `"김영란법"` → 청탁금지법 등 27개 한국어 별칭. `discover_tools`가 별칭 매칭하면 카테고리/도구 즉시 반환

### Why
- 프로덕션 리뷰(code-reviewer + security-reviewer + UX 갭 분석) 결과 Critical 1 / 보안 High 2 / 품질 High 3 / UX 갭 5 발견
- v3.4.0 "판례 응답 토큰 74% 감축" 기능이 12개 도메인에서 무효화된 채 배포된 상태 — 즉시 핫픽스
- 2026년 AI 시대 법령 RAG 차별화 포인트는 **환각 방지**. `verify_citations`가 법제처 공식 API만 가능한 killer 기능

### How to apply
- `verify_citations` 사용: LLM 답변/계약서/판결문 텍스트를 `text`로 넘기면 자동 인용 추출 + 병렬 검증
- `full` 옵션은 14개 도메인 전체에서 정상 작동 (이제 `full=true` 보내면 실제로 전문 반환)
- API 키 로그 유출 방지를 위해 프로덕션 환경은 `TRUST_PROXY=1` 명시 설정 권장 (Fly.io는 기본값으로 충분)
- 별칭 매칭은 `discover_tools(intent="조세심판원")` 같은 자연어 입력에서 자동 적용

## [3.4.0] - 2026-04-16

### Added
- `lib/decision-compact.ts` — 판례/헌재/행심 응답 토큰 최적화 유틸 신규:
  - `compactBody(text, opts)` — 본문 계단식 축약 (앞 800자 + 중략 + 뒤 400자, 문장 경계 가드)
  - `densifyLawRefs(text)` — 참조조문 괄호 설명 제거 + 구분자 정리
  - `densifyPrecedentRefs(text)` — 참조판례 "선고/판결" 제거 + 날짜 공백 압축
  - `stripRepeatedSummary(body, summaries)` — 본문 앞쪽에 반복 기재된 판시/요지 제거
- `get_decision_text`에 `full?: boolean` 파라미터 추가 — `true`=전문 그대로, 미지정(기본)=축약
- 개별 핸들러(`get_precedent_text`, `get_constitutional_decision_text`, `get_admin_appeal_text`)에도 동일 파라미터 전파

### Changed
- **판례 응답 토큰 평균 -74%** (실측: `b4875a3` vs `69f6918`, 3개 도메인 × 8건 고정 ID):
  - 판례: 5,230 → 3,049 chars (-42%)
  - 헌재: 8,368 → 1,703 chars (-80%)
  - 행심: 8,429 → 1,491 chars (-82%)
  - 긴 결정례(15,000자 이상)에서 80~89% 절감 — 판시/요지/주문은 full 유지, 본문만 축약
- **ListTools 페이로드 -14%** (9,671 → 8,296 bytes, 344 토큰↓):
  - `chain_*` 8개 description 간결화 (`[⛓체인]` → `[⛓]`, 예시 구문/메타 문구 제거)
  - `search_decisions`/`get_decision_text` 필드 describe 다이어트 (17 도메인 이중 기재 제거)
  - `discover_tools`/`execute_tool` description 축약

### Why
- 3개 MCP 동시 운용 환경에서 판례 호출 1회가 12.5k 토큰 상한(50KB)을 먹어 컨텍스트 블랙홀화
- 법령 RAG 관점에서 판시사항·판결요지·주문은 규범 재사용 핵심이라 full 유지, "이유" 전문은 사안별 사실관계 나열이라 축약해도 손실 미미
- 중략된 구간은 `full=true`로 재호출 가능 — backward compatible

### How to apply
- 적용 도메인: `precedent`, `constitutional`, `admin_appeal` (판례/헌재/행심)
- 해석례·기타 짧은 도메인은 미적용 (원래 짧음)
- 사용자는 자연어로 "전문 그대로", "full로 다시"라고 요청하거나 LLM이 description 보고 자동 판단
- 응답 중간의 `⋯ 중략 N자 (full=true로 전문 조회) ⋯` 마커가 힌트

## [3.2.2] - 2026-04-12

### Added
- `get_annexes`를 V3_EXPOSED에 추가 (14개 → 15개 노출). `discover_tools` → `execute_tool` 왕복 없이 별표/서식 직접 조회 가능
- `chains.ts` `detectExpansions`: 환불·반환·배상·수강료·이용료·회비·N만원 키워드 추가 — 소비자분쟁 질의에서 `chain_full_research`가 별표 자동 포함

### Why
- 트레이스 `ld-1775959823220` (헬스장 1년권 환불, 79s) 분석 결과: 별표 3의2 조회를 위해 `discover_tools` × 2 + `execute_tool(get_annexes(...))` 헛발질로 ~15초 손실
- 노출 기준: 체인 도구가 fallback으로 자주 호출하는 종착 도구 + discover→execute 왕복으로 5초+ 손실
- `tool-registry.ts` 상단 주석에 제거 금지 경고 명시

## [3.0.2] - 2026-04-08

### Added
- `npx korean-law-mcp setup` — 대화형 설치 마법사 (API 키 입력 → 8개 클라이언트 자동 설정)
- 지원 클라이언트: Claude Desktop, Claude Code, Cursor, VS Code, Windsurf, Gemini CLI, Zed, Antigravity
- STDIO 모드에서 `MCP_PROFILE` 환경변수 지원

### Fixed
- API 커버리지 수치 39개 → 41개로 정정 (실제 사용 target 기준 재집계)

## [3.0.1] - 2026-04-08

### Added
- get_ordinance: `jo` 파라미터 추가 — 특정 조문 본문 직접 조회 가능 (#19)
- 대형 조례(20개 초과) 목차 반환 시 `jo` 사용법 안내 메시지 추가

### Fixed
- get_ordinance: 조문 필터링을 조제목 텍스트 매칭에서 조문번호(JO 코드) 기반으로 변경 — API 응답의 조제목에 조번호가 없는 구조 대응
- get_ordinance: "제20조" 검색 시 "제20조의2" 등 의X 조문이 잘못 매칭되는 문제 수정

## [2.2.0] - 2026-04-01

### Added
- 23개 신규 도구: 조약(2), 법령-자치법규 연계(4), 학칙/공단/공공기관(6), 특별행정심판(4), 감사원(2), 약칭(1), 행정규칙 신구대조(1), 조항호목(1), 문서분석(1), chain_document_review(1)
- date-parser: 자연어 시간 표현 → YYYYMMDD 변환 (10개 패턴)
- document-analysis: 8종 문서유형 분류, 17개 리스크규칙, 금액/기간 추출, 조항 충돌 탐지
- 판례/해석례 날짜 필터 (fromDate/toDate)

### Changed
- 에러 처리 통일: 40개 도구의 인라인 에러 → formatToolError 전환
- 중복 XML 파서 6개 → 공용 parseSearchXML 통합
- cli.ts 분리: cli-format.ts + cli-executor.ts + cli.ts (689줄 → 443+181+227)
- annex.ts: AnnexItem 타입 정의, any 12회 제거

### Security
- sse-server.ts: CORS * → CORS_ORIGIN 환경변수 기반
- sse-server.ts: API 키 쿼리스트링 경로 제거 (헤더만 허용)
- sse-server.ts: 보안 헤더 추가 (X-Content-Type-Options, X-Frame-Options, Referrer-Policy)
- sse-server.ts: 세션 ID 로그 마스킹 (첫 8자만 출력)

### Fixed
- 조약 XML 아이템태그 대소문자 (trty→Trty), 본문 JSON 키 (BothTrtyService)
- 연계 fetchApi type 기본값 제거 (type=XML 시 500 발생)
- api-client.ts: type 파라미터 미지정 시 생략

- 총 도구 수: 64 → 87

## [1.9.0] - 2026-03-15

### Fixed
- HWP 구형 파서: `controls` 내 테이블(표) 추출 지원
  - `hwp.js`의 `paragraph.controls[].content` 경로에서 테이블 구조(rows/cells) 탐색
  - 기존에는 `paragraph.content`만 탐색하여 표 형식 HWP 파싱 실패

## [1.8.1] - 2026-03-15

### Changed
- MCP 도구 스키마 최적화: description 압축 + apiKey 은닉

## [1.8.0] - 2026-03-10

### Added
- 체인 도구 7개: chain_law_system, chain_action_basis, chain_dispute_prep, chain_amendment_track, chain_ordinance_compare, chain_full_research, chain_procedure_detail
- get_batch_articles: `laws` 배열 파라미터로 복수 법령 일괄 조회 지원
- search_ai_law: `lawTypes` 필터로 법령종류별 결과 필터링
- truncateSections(): 체인 도구 섹션별 응답 크기 최적화
- truncateResponse summary 모드: 긴 응답 자동 요약
- unwrapZodEffects: .refine() 스키마의 MCP 호환성 개선
- 구조화된 에러 포맷: [에러코드] + 도구명 + 제안

### Changed
- formatToolError: ZodError 자동 감지, 구조화된 출력
- toMcpInputSchema: ZodEffects unwrap 후 JSON Schema 변환
- 총 도구 수: 57 → 64
