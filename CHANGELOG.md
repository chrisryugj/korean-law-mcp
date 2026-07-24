# Changelog

## [4.8.0] - 2026-07-22

외부 기여 PR 5건 반영 — 행위시법 판단·연혁 파싱·검색 리졸버·재시도·폐지 법령 처리 정확도 개선. 로컬 회귀 106건 통과.

### Fixed

- **DRF 간헐 404 재시도 + `type=HTML` 정상응답 재시도 증폭 제거 (#63, @zzocrypto)**: 유효한 `mst`+`jo` 조회가 간헐적으로 404를 반환하고 동일 파라미터 재시도 시 성공하는데, `fetchWithRetry` 기본 재시도 대상(`[429,503,504]`)에 404가 빠져 1차 실패가 "조문 부재"로 오답되던 것 — DRF 호출 전체에 `[404,429,503,504]` 적용(소진 후에만 실패). 또 `lsHistory` 등 `type=HTML` 정상응답이 HTML-본문 감지 재시도에 걸려 대형 연혁(소득세법류)에서 ~40s까지 늘어지던 것을 `allowHtmlBody`로 제외(HTML 에러페이지 감지는 유지) — ~40s→~4s (`src/lib/fetch-with-retry.ts`, `src/lib/api-client.ts`)
- **분리시행 법령의 적용 버전 오특정 등 행위시법 6건 (#64, @zzocrypto)**: 조항별 시행일이 나뉘는 법령(중대재해처벌법 50인 미만 3년 유예 등)에서 `applicable_law`가 잘못된 버전을 "기준일 시행 중"으로 특정하던 것을 eflaw 범위검색 시행 슬라이스 보정(`fetchEffectiveSlices`)으로 수정. 동일 시행일 tie-break(공포일·공포번호 내림차순), 적용 버전 자신의 부칙 발췌, 무패딩 날짜("2010.1.1") 파싱, '폐지제정' 오분류, jo 지정 시 조문번호 검증 포함. eflaw 실패 시 기존 lsHistory 결과 유지(보수적 폴백) (`src/tools/applicable-law.ts`, `src/lib/historical-utils.ts`)
- **연혁 페이징 조기종료·NaN 정렬·조문 출력 훼손·제21항+ 미지원 (#65, @zzocrypto)**: 연혁 수집 종료를 필터 후 행수 대신 **원시 총계(totalCount) 기준**으로 변경(500행 초과 법령의 옛 본법 버전 누락 방지), `time_travel` 버전선택 정렬의 빈 시행일 NaN 폴백, `get_historical_law`의 `[object Object]`·`N/A` 출력을 `safeText` 평탄화로, 원숫자 매핑을 ①~⑳에서 ㉑~㊿까지 확장(제21항+ 인용을 "존재않는 항"으로 오판하던 것 수정) (`src/lib/historical-utils.ts`, `src/lib/article-parser.ts`, `src/tools/historical-law.ts`, `src/tools/scenarios/time-travel.ts`)
  - 병합 시 보강: `parseTotalCount`가 콤마 표기(`<strong>1,696</strong>`)도 파싱하도록 방어 — #65가 totalCount를 페이징 종료 1차 기준으로 승격했는데 `\d+`로만 잡으면 "1,696"이 "1"로 끊겨 대형 법령이 오히려 1페이지에서 조기 종료되는 역행을 막음
- **`findLaws` 기본 조회 20이 관련도 정렬을 굶겨 무관 법령을 반환 (#66, @zzocrypto)**: `applicable_law(lawName="상법")` 같은 호출이 전혀 무관한 법령 분석을 확신형으로 출력하던 것 — 법제처 LIKE+가나다순 검색에서 정확매칭이 앞 20건에 없어 무관 부분매칭 1위를 `laws[0]`로 신뢰하던 문제. 기본 `searchDisplay` 20→100(비용 동일 1콜), `looseMatchLawName` lib 승격, 별칭 canonical 해소 대조(`resolvedLawMatches`), `applicable_law`·`impact_map`에 무관 1위 차단 가드(NOT_FOUND + 정식명 재확인 안내) (`src/lib/law-search.ts`, `src/tools/applicable-law.ts`, `src/tools/impact-map.ts`)

### Changed

- **폐지 법령 인용을 '환각'으로 오탐하지 않도록 REPEALED 분리 보고 (#67, @yabooung)**: `verify_citations`가 현행 검색만 써서 폐지 법령 인용(예 「국유재산관리특별회계법 제6조」, 2007 폐지)을 검색 0건→`[HALLUCINATION_DETECTED]`(isError:true)로 낙인하던 것 — 현행 0건일 때만 `target=eflaw` 1회 폴백해 `현행연혁코드="연혁"`이면 `⌛ [REPEALED_REFERENCE]`로 분리 보고(폐지 건은 `failCount` 미포함 → `isError` 불변). 정상(`✓`)·진짜 환각(`✗`) 판정은 불변, 정상 인용 추가 비용 0 (`src/tools/verify-citations.ts`, `src/lib/law-search.ts`)

## [4.7.5] - 2026-07-21

### Fixed

- **`get_law_abbreviations` 완전 복구 (#61)**: 항목 태그를 존재하지 않는 `<lsAbrv>`로 찾아 **매 호출 "약칭 데이터가 없습니다"로 실패**하던 것 수정. 실제 `lawSearch.do?target=lsAbrv` 응답의 항목 태그는 `<law>`, 필드는 `법령명한글`/`법령약칭명`이다. `display=100` 전달 + 총계를 응답 `totalCnt`로 정직 표기(조회분을 총계로 위장하지 않음) (`src/tools/utils.ts`)
- **연계 3종 루트 태그 + `get_law_tree` 파서 복구 (#62)**: `lnkLsOrdJo`/`lnkDep`/`lnkOrd`의 실제 응답 루트가 `lnkOrdJoSearch`/`lnkDepSearch`/`OrdinSearch`인데 대문자 루트(`LnkLsOrdJoSearch` 등)를 가정해 **항상 0건(NOT_FOUND)**. 루트 매칭을 대소문자 무시로 변경. `lnkDep`은 법제처가 서버 검색 필터를 지원하지 않아(전체 덤프) 조회 페이지 내 클라이언트 필터 + "전수 아님" 한계 명시로 전환하고 `get_linked_ordinances` 사용을 안내. `get_law_tree`는 `get_three_tier` 실제 출력(`법령명:` 헤더 + `[시행령]`/`[시행규칙]` 인라인 마커) 기준으로 파서 재작성, 빈 입력은 스키마에서 거부, 데이터 없으면 빈 트리 대신 NOT_FOUND (`src/tools/law-linkage.ts`, `src/tools/law-tree.ts`)

## [4.7.4] - 2026-07-15

### Fixed

- **`search_law` 오법령 확장검색 차단 + 인공지능기본법 약칭 등록**: 「인공지능 발전과 신뢰 기반 조성 등에 관한 기본법」의 통칭 "인공지능법"이 정식 제명의 부분문자열이 아니라 LIKE 검색이 0건이 되고, 키워드 확장이 만든 "AI법" 쿼리에 법제처가 **검색어를 무시한 가나다순 무관 법령 50건**을 반환 → LexDiff fast-path가 첫 항목(가맹사업법)을 집어가던 사고의 근원. 약칭(인공지능법/인공지능기본법/AI법/ai기본법) 등록 (`src/lib/search-normalizer.ts`)
- **`hasRelatedHit` 가드**: 확장쿼리 결과에 법령명·약칭이 쿼리와 포함관계인 항목이 하나도 없으면(= API가 쿼리를 무시한 응답) 채택하지 않고 다음 확장쿼리·폴백으로 진행 (`src/tools/search.ts`). 약칭 해석 4종 + `hasRelatedHit` 4종 테스트 추가

> 이 변경의 커밋 메시지에는 `v4.6.7`로 적혀 있으나 4.6.7은 발행된 적이 없으며, 실제로는 4.7.4로 배포되었습니다.

## [4.7.3] - 2026-07-14

### Fixed

- **행정규칙(고시) 별표 조회 복구 (#58)**: `get_annexes`가 「사료 등의 기준 및 규격」처럼 제목에 '고시·훈령·예규' 등 종류 키워드가 없는 행정규칙 별표를 `NOT_FOUND`로 반환하던 문제 수정. `detectLawType`이 이런 이름을 `law`로 분류해 `licbyl`(0건)만 조회하고 `admbyl` 경로를 놓치던 것이 원인. admin(admbyl) fallback을 기존 `/규정/` 이름 제한에서 **모든 미매칭 케이스**로 일반화해, `search_admin_rule`로 검색되는 행정규칙이면 별표(예: 별표16 「사료 내 유해물질의 범위 및 허용기준」)도 정상 추출된다 (`src/tools/annex.ts`)

## [4.7.2] - 2026-07-11

### Fixed

- **`verify_citations` 수식어 앞 법령명 재시도 (#55)**: 법령명 앞에 수식어가 붙은 완전문장("절도죄는 형법 제329조…")에서 조문검증이 `⚠ PARTIAL_VERIFIED`로 저하되어 **환각(없는 조문·제목 불일치)이 탐지되지 않던** 문제 수정. `looseMatch` 실패 시 앞 어절을 순차 축약하며 `findLaws`를 재시도하되, 다어절 법령명(「전자상거래 등에서의 소비자보호에 관한 법률」)은 전체 후보를 먼저 두어 보존 (`src/tools/verify-citations.ts`)

### Security

- **hono 4.12.22 → 4.12.29**: `npm audit` HIGH 5건 해소. `@modelcontextprotocol/sdk`의 전이 의존성이라 `overrides`로 고정 (#54)

## [4.7.1] - 2026-07-08

### Fixed

PlayMCP 심사 피드백 대응.

- **`legal_research` task 오인 흡수**: LLM이 `scenario` 값(`penalty` 등)을 `task`에 잘못 넣어도 `scenario`로 재배치하고 호환 task로 승격해 툴콜 실패를 제거(의도 보존). 미지의 task 값은 `full_research`로 폴백. 실행 경로·API 호출은 불변 (`src/tools/legal-research.ts`)
- **`ordinance_radar` query 별칭**: `query` 파라미터 별칭을 추가해 `search_law` 등 다른 도구와 규약을 통일 — 자연어 조례명으로 호출 시 실패하던 문제 해소 (`src/tools/ordinance-radar.ts`)

## [4.7.0] - 2026-07-07

### Added

- **`ordinance_radar` — 조례 정비 레이더**: 조례 제1조(목적)의 「」 인용에서 근거 상위법령(법률·시행령·시행규칙, "같은 법" 축약 포함)을 추출한 뒤 각 상위법의 현행 시행일과 조례 시행일을 대조해 **정비 검토 대상을 자동 플래그**. 법제처 자치법규 연계 API(lnkOrd)는 커버리지 부족(주차장 조례 0건)으로 미사용하고 본문 표준 표기 파싱으로 대체. 목적 조문만 스코핑해 별표의 무관 인용(공직선거법 등) 과잉경보를 배제(32 → 3건). `V3_EXPOSED` 10번째 직노출 도구 (`src/tools/ordinance-radar.ts`)

### Security

- **JSON-RPC 배치 증폭 차단**: 배치의 `tools/call`을 개수만큼 rate limit·폴백 쿼터에 계수 — 단일 POST에 수백 개를 담아 서버 `LAW_OC` 쿼터를 소진시키는 증폭 벡터를 차단. 요청당 `tools/call` 상한 20 (`MCP_MAX_BATCH_CALLS`) (`src/server/http-server.ts`)

### Fixed

- **graceful shutdown**: idle keep-alive 연결을 끊지 않아 매 배포마다 10초 대기 후 `exit(1)`로 기록되던 문제 → `closeIdleConnections()` + `exit(0)` (`src/server/http-server.ts`)
- **`get_article_history` lawName 정확매칭 우선**: 검색 첫 결과를 무조건 채택해 '상법' 입력 시 가나다순 앞선 타법을 오조회하던 문제 수정
- **`get_ordinance` id 별칭**: id 별칭으로 호출할 때 다음 단계 힌트가 `ordinSeq="undefined"`로 출력되던 버그 수정
- **`maskSensitiveUrl` 대소문자 무시(`gi`)**: API 키 마스킹 회귀 방지 (`src/lib/fetch-with-retry.ts`)

## [4.6.6] - 2026-07-06

### Fixed

- **"간헐적으로 도구를 못 찾음" 근본 해결**: 일반 rate limiter가 핸드셰이크(`initialize`/`tools/list`)까지 429로 막던 문제 → `tools/call`만 게이트. claude.ai의 **공유 egress IP**가 60rpm 버킷을 나눠 쓰다 핸드셰이크에서 429를 맞으면 도구 목록이 통째로 유실되던 것이 원인 (v4.6.2의 폴백게이트 원칙을 일반 limiter까지 확장) (`src/server/http-server.ts`)
- **`get_ordinance` 데드엔드**: `id`↔`ordinSeq` 불일치로 조례 본문 조회가 막히던 문제 → `id` 별칭 수용
- **`get_article_history` 상시 0건**: `lsJoHstInf`에 날짜를 전달하지 않아 모든 법령의 조문 개정이력이 항상 0건이던 문제 → 날짜 미지정 시 전체기간(19480101~20991231) 자동 적용
- **발견성**: `search_law` 설명에 조례·행정규칙 진입점 명시 (`src/tool-registry.ts`)

## [4.6.5] - 2026-07-06

### Fixed

- **ToolAnnotations `destructiveHint` 추가**: ListTools 광고 annotations에 `destructiveHint: false` 명시. 9개 도구 모두 법제처 read-only 조회라 파괴적 동작 없음을 명시적으로 선언 — 일부 MCP 호스트(카카오 등) 등록 심사가 `destructiveHint` 정의를 필수로 요구해 경고가 발생하던 문제 해소 (`src/tool-registry.ts`)

## [4.6.4] - 2026-07-05

### Fixed

- **MCP 도구 annotations 한글 title 제거**: claude.ai 웹 클라이언트가 비-ASCII(한글) `annotations.title`이 붙은 `tools/list`를 인식하지 못해 **"도구 없음"으로 뜨던** 문제 대응. 서버·도구 호출 자체는 정상이었고(curl·GPT·Claude Code 세션 모두 작동) claude.ai 웹만 실패. v4.5.1에서 추가한 `TOOL_TITLES`를 제거하고 영문 `name`을 그대로 노출 (`src/tool-registry.ts`)

## [4.6.3] - 2026-07-05

### Added

- **`search_law` 자치법규 자동 폴백**: '광진구 복무 조례' 같은 쿼리가 `NOT_FOUND` + 키워드 축소 힌트만 반환해 LLM이 `discover_tools` → `execute_tool` 2턴을 돌아가던 문제. 쿼리에 '조례'가 포함되거나 ○○시/군/구 토큰이 있으면 `search_ordinance`를 자동 시도한다(행정규칙 폴백과 동일 패턴) (`src/tools/search.ts`)

## [4.6.2] - 2026-07-05

### Fixed

- **폴백 쿼터 게이트를 `tools/call`만 적용**: `FALLBACK_RATE_LIMIT_RPM` 소진 시 `initialize`/`tools/list`까지 429로 막혀 claude.ai 커넥터가 **도구 목록 자체를 못 싣던** 문제 수정. 법제처 쿼터를 실제 소모하는 `tools/call`만 게이트한다 (`src/server/http-server.ts`)

## [4.6.1] - 2026-07-05

### Docs

- **README 현행화**: v4.6.0 릴리스 노트(인용 내용검증 + law.go.kr JS 안티봇 우회) 추가, tagline을 "인용 검증(실존+내용)"으로 갱신
- **README-EN 현행화**: 영문판이 v4.3부터 뒤처져 있던 것을 보강 — v4.4.0(도구 통폐합)·v4.4.1–4.4.3(안정성)·v4.5.0(시행예정)·v4.6.0 릴리스 노트 반영
- 코드 변경 없음(문서 전용 패치)

## [4.6.0] - 2026-07-04

### Added — verify_citations 내용검증 (존재 + 내용 이중검증)

- **조문 제목 내용검증**: `verify_citations` / `legal_analysis(mode=verify_citations)`가 기존 "조문 실존" 검증에 더해, 인용한 조문제목이 실제 조문제목과 일치하는지 대조. `민법 제750조(계약해제)`처럼 **존재하는 조문에 엉뚱한 제목을 붙인 내용 환각**을 `[CONTENT_MISMATCH]`로 탐지 (기존엔 750조만 실존하면 통과). LexDiff의 `citation-content-matcher`(정규화 후 exact 30자 공통 substring + 문자 bigram Jaccard ≥ 0.25) 이식 (`lib/citation-content-matcher.ts`). `제N조(제목)` 형태의 제목만 검증 대상, 개정이력·날짜·항호 참조 괄호는 제외

### Added — law.go.kr JS 안티봇 우회 (클라우드 IP 대응)

- **`location.assign` 리다이렉트 추적**: 클라우드 IP(GCP/AWS/Fly)에서 법제처가 API 데이터 대신 JS 안티봇 페이지를 반환할 때, 난독화 URL(concat/substr 2패턴)을 파싱해 토큰 URL로 우회 (`lib/law-antibot.ts`, 최대 3홉, 토큰 URL 404 시 원본 재시도). 로컬/등록 IP에선 no-op. `fetch-with-retry`가 law.go.kr 호스트 응답에만 적용해 방어층 추가

### Tests

- `law-antibot.test.ts`(3), `citation-content-matcher.test.ts`(8) 신설 — vitest 44 케이스 그린

## [4.5.2] - 2026-07-04

### Fixed

- **광고 서비스명 정정**: ListTools 광고 접두를 PlayMCP 등록명과 일치하도록 「국가법령정보 MCP」 → `Korean-law-mcp`로 변경. 서비스명 검증은 등록폼 이름과 정확히 일치해야 통과 (`src/tool-registry.ts`)

## [4.5.1] - 2026-07-04

### Added

- **PlayMCP 등록용 tool annotations**: 노출 도구의 ListTools 광고에 MCP annotations(read-only 조회·멱등·openWorld)를 추가하고 description에 서비스명을 접두. 원본 `allTools` 정의는 그대로 두고 `registerTools` 광고 시점에만 주입해 STDIO·HTTP 양쪽에 반영. PlayMCP 검증 2건(annotations 미정의·서비스명 누락) 해소 (`src/tool-registry.ts`)

## [4.5.0] - 2026-07-03

### Added

- **`search_law` 시행예정 법령 감지**: 제명변경 개정이 공포~시행 사이에 있으면 신명칭 검색 시 '정확매칭 없음'만 떠서 **LLM이 "법령 없음"으로 오판하던** 문제 해결(「데이터기반행정 활성화에 관한 법률」 → 「인공지능 및 데이터 기반 행정 활성화에 관한 법률」 사례). `target=eflaw` 보조검색으로 시행예정만 추출해 MST별 시행일을 병합하고, **제명변경·개정예정·미시행 신규** 3분류 노트를 생성한다 (`src/lib/upcoming-laws.ts`)
- 검색 결과에 시행예정 노트를 병기하고, 현행이 0건이면 시행예정을 단독 안내(효력 없음 경고 포함). `api-client.searchLaw`에 `target`(law|eflaw) 파라미터 추가. 시행예정본 조회 힌트에 `efYd`를 필수 병기 — `efYd` 없이는 법제처 API가 404를 반환

## [4.4.4] - 2026-07-01

### Fixed

- **번호 없는 단일 별표 매칭 폴백**: `get_annexes`가 별표 선택값("별표1" 등)으로 매칭에 실패해도, 해당 법령의 별표가 정확히 1건뿐이면 그 별표를 반환한다. 「여권법 시행령」의 '수수료 및 사무의 대행에 드는 비용(제39조 관련)'처럼 **별표번호가 `000000`인 번호 없는 단일 별표**는 LLM이 임의로 "별표1"로 호출하면 `findMatchingAnnex` 매칭 0건 → `NOT_FOUND`로 새어 "참조 조문 부족" 답변을 유발했음. 별표가 유일 1건이면 선택값이 불일치해도 정답이 명확하므로 폴백 (`src/tools/annex.ts`)
  - 회귀 안전: 별표가 여러 건인 법령(관세법 24건)에서 존재하지 않는 번호는 `NOT_FOUND` 유지

> 이 변경(`fde094c`)의 커밋 메시지에는 `v4.4.3`으로 적혀 있으나, 원격에서 4.4.3(zod `^4` pin)이 먼저 npm에 게시되어 같은 버전으로는 publish가 거부됐습니다. 4.4.4로 올려 실제 배포했습니다.

## [4.4.3] - 2026-06-29

### Fixed — zod v4 고정 (신규 설치 크래시 해결)

- **`z.toJSONSchema is not a function` 크래시**: `dependencies`가 zod를 `^3.25.76 || ^4.0.0`으로 선언했으나 코드는 zod v4 전용 API인 `z.toJSONSchema()`를 호출. 새 npm 설치가 zod 3.25를 해석하면 `listTools` 첫 호출에서 크래시. zod를 `^4`로 고정해 해결

## [4.4.2] - 2026-06-18

### Fixed — 행정규칙 별표/서식 조회 복구 (#50, #49, #51)

- **행정규칙 별표 응답 키 버그 (#50)**: `get_annexes`가 행정규칙 별표 응답 배열 키를 `admbyl`로 파싱했으나 법제처 실제 키는 `admrulbyl` — `totalCnt > 0`인데도 0건으로 처리돼 "법제처 DB에 없음"으로 응답하던 문제. `admrulbyl` 우선 + `admbyl` 폴백으로 수정 (`tools/annex.ts`). 실측 검증: "외부감사 및 회계 등에 관한 규정 시행세칙" 65건 정상 반환, 별표6 HWP 본문 추출까지 확인
- **행정규칙 자동 판별 누락**: `detectLawType`이 훈령/예규/고시/지침/내규만 admin으로 인식 — `세칙` 추가로 "...시행세칙"이 1차부터 `target=admbyl`로 조회되도록 보정 (`lib/api-client.ts`). "규정/규칙" 단독은 시행규칙 오분류 위험이 있어 기존 4차 fallback에 위임
- **소관부처 표시 누락**: admin 별표 항목의 부처 필드가 `소관부처명`인데 `소관부처`를 참조해 미표시되던 것 보정
- **별표/서식 동일 bylSeq 충돌 (#49)**: 자치법규·행정규칙에서 `[별표 N]`과 `[별지 제N호서식]`이 같은 별표번호를 공유할 때 서식이 잘못 선택되던 문제 — `별표종류`+`knd`로 구분 (외부 기여: @hanbrook3)
- **별표 의-번호 파싱 (#51)**: `별표1의2` 입력 시 정규식이 `의2`를 법령명에 잔류시켜 NOT_FOUND 나던 문제 — 법제처 6자리 코드(`000102`)로 직접 변환 (외부 기여: @hoiyada7-maker)

## [4.4.1] - 2026-06-11

### Fixed — 광고 스키마 required 버그 + 통합 진입점 보강 (시니어 리뷰 반영)

- **광고 스키마 required 버그**: `z.toJSONSchema()`가 기본 `io:"output"` 모드라 `.default()` 필드를 required로 직렬화 — `legal_research.task`("미지정 시 full_research"인데 required로 광고), `search_law.display`가 강제 입력으로 노출되던 문제. `{ io: "input" }` 명시로 수정
- **scenario 무음 폐기 제거**: task와 비호환인 scenario를 조용히 버리던 것을 응답 첫 줄 경고 노트로 명시 (`⚠ scenario=X는 task=Y와 비호환이라 무시하고 자동 감지로 대체`). 호출 LLM이 파라미터 무시를 인지 가능
- **task↔scenario 호환표 단일화**: 수동 `TASK_SCENARIOS` Set + `as` 캐스트 제거 → 체인 스키마(`chains.ts`)의 `shape.scenario`에서 직접 파생(`pickScenario`). 체인 enum 변경 시 자동 추종, 드리프트 원천 차단
- **`legal_analysis` 비용 옵션 패스스루**: `maxCitations`·`display`·`deepScan`·`includeOrdinances`·`includeMermaid`를 하드코딩에서 optional 파라미터로 — 비싼 변형(deepScan 본문 스캔, 전국 조례 팬아웃, mermaid)을 노출 프로필에서 직접 끌 수 있음. 기본값은 원본 도구와 동일
- **타입 통일**: `legal-research.ts`의 `Awaited<ReturnType<...>>` 핵 제거 → `LooseToolResponse`로 통일
- **테스트 신설**: `test-legal-research-analysis-dispatch.cjs` — 광고 스키마 계약(io:input required + apiKey 숨김), task×scenario 호환 매트릭스(6×9+미지정), 필수 파라미터 가드, withNote 주입, TOOL_COUNTS 파생값
- 문서 정리: CLAUDE.md stale 노출 수(19개→9개), API.md에 legal_analysis 패스스루 옵션 표기

## [4.4.0] - 2026-06-11

### Changed — 노출 도구 통폐합 19개 → 9개 (컨텍스트 52% 감축)

MCP 클라이언트의 ListTools 컨텍스트 비용 ~15.1KB → ~7.2KB (실측, ≈6,000 → ≈2,900토큰).

- **`legal_research` 신설**: `chain_*` 8개를 `task` 파라미터로 통합 (full_research·law_system·action_basis·dispute_prep·amendment_track·ordinance_compare·procedure_detail·document_review). scenario/domain/articles 등 기존 파라미터 전부 유지, task별 비호환 scenario는 무시하고 자동 감지에 위임
- **`legal_analysis` 신설**: 킬러피처 4개(verify_citations·cite_check·applicable_law·impact_map)를 `mode` 파라미터로 통합. 세부 옵션(deepScan, includeMermaid 등)은 원본 기본값 적용
- **하위호환 보장**: 원본 12개 도구는 `allTools`에 유지 — CallTool 직접 호출·`execute_tool` 경유 모두 기존대로 동작. 광고(ListTools)만 제외
- **apiKey 스키마 노출 제거**: 정식 경로는 HTTP 헤더(session-state)이므로 광고 스키마에서 숨김. 인자로 넘기는 기존 클라이언트는 Zod parse가 계속 수용
- `discover_tools` 설명의 하드코딩 도구 수(73개) 제거

최종 노출 9개: legal_research, legal_analysis, search_law, get_law_text, get_annexes, search_decisions, get_decision_text, discover_tools, execute_tool

## [4.3.0] - 2026-06-11

### Added — cite_check: 판례 생사 확인 (한국형 Shepard's Citator)

"이 판례 아직 유효한가?" — 변경·폐기된 판례를 살아있는 것처럼 인용하는 사고 방지.

- 사건번호(`nb=`)로 대상 판례 특정 → 본문검색(`search=2`)으로 그 사건번호를 인용한 후속 판례 역추적
- 전원합의체 우선 본문 정밀 스캔: "변경하기로 한다 / 폐기 / 더 이상 유지될 수 없다 / 배치되는 범위에서 변경" 감지
- **별칭 추적**: 판결문이 "(이하 '2008년 전원합의체 판결'이라 한다)"로 별칭 정의 후 별칭으로 변경 선언하는 관행 대응 — 사건번호만 쫓으면 false negative (2007다27670 → 2018다248626 변경 케이스로 검증)
- 판정 4단계: ❌ 변경·폐기 신호 / ⚠️ 미스캔 전합 후속 존재 / ✅ 계속 인용 추정 / ℹ️ 후속 인용 없음
- 한계 명시: 법제처 수록 판례(대법원 중심) 범위 — 출력에 고지하여 과신 방지

### Added — applicable_law: 행위시법 판단 + 부칙 경과규정 발췌

"사건 시점(2023.5.10)에 적용되는 법은?" — LLM이 현행법으로 오답하는 것 방지.

- lsHistory 연혁으로 기준일에 시행 중이던 버전(MST) 특정 + 그 시점 조문 본문 (eflaw는 MST+efYd 동반 필수)
- 현행 조문과 동일/변경 비교 (변경 시 time_travel 연계 안내)
- 이후 개정 부칙에서 적용례·경과조치 자동 발췌 (공포번호 매칭, 조문 지정 시 해당 조문 언급 라인 우선)
- 행위시법(형법 §1)·제재처분 위반행위시법(행정기본법 §14③)·처분시법 법리 안내 — 해석은 하지 않고 발췌만 (사람/LLM 몫)

### Changed

- V3_EXPOSED 17 → **19개** (cite_check, applicable_law 직노출), 내부 도구 93 → 95개
- query-router: 사건번호+유효성 키워드 → cite_check, 기준일+법령명 → applicable_law 자동 라우팅
  - 행위시법 의도 쿼리는 날짜 제거 전 원문으로 매칭 (날짜 자체가 파라미터)
  - specific_article이 "2023.5.10 당시 ... 제44조" 패턴을 applicable_law에 양보

### Fixed — 프로덕션 리팩토링 (시니어 리뷰 P0~P2 11건)

- **P0** `findLaws`가 타임아웃·5xx를 삼켜 "법령 없음"으로 둔갑 → 인프라 에러는 throw로 전파. 법제처 장애 중 verify_citations가 실존 조문을 NOT_FOUND로 오판하던 설계 모순 해소
- **P1** HTTP API 키 수신 우선순위를 헤더 > 쿼리스트링으로 변경 (프록시 액세스 로그 평문 유출 방지)
- **P1** 서버 LAW_OC 폴백에 전역 상한 추가 (`FALLBACK_RATE_LIMIT_RPM`, 기본 120rpm) — 키 없는 분산 요청의 quota 소진 방지
- **P1** runScenario 무음 예외 삼킴 → [FAILED] 섹션 반환 (LLM이 "결과 없음"과 "실행 실패" 구분 가능)
- **P1** get_law_text TOC 캐시 히트 시 50KB 절단 우회 수정 (절단본을 캐시)
- **P2** graceful shutdown이 in-flight 요청 완료 대기 (최대 10초)
- **P2** formatToolError에 maskSensitiveUrl 최종 방어선 추가
- **P2** extractLawName 연속 키워드 제거 실패 수정 ("개정 연혁" → lookahead 경계)
- **P2** tool-registry: 요청마다 93개 도구 재등록 → 모듈 로드 시 1회. 노출 수 하드코딩 → `TOOL_COUNTS` 파생값
- **P2** `toArray()` 헬퍼 도입 (Critical Rule 6 수동 패턴 8곳 치환), chains.ts 데드코드 제거

## [4.2.1] - 2026-06-11

### Changed — kordoc 2.4.0 → 3.0.0 (별표 파서 엔진 업그레이드)

별표(HWPX/HWP5/PDF) 파싱 엔진 kordoc을 v3.0.0으로 업그레이드. API 변경 없음(`parse()` 그대로).

- HWPX 텍스트 재현율 99.699% → **99.998%**, 표 구조 정확일치 **100%** (중첩표 343건 포함)
- 환각률(phantom) 0.019% → **0.006%**, PDF consensus coverage 97.0% → **99.16%**
- 중첩표 구조 보존, HWP5 BinData 이미지 추출, 한컴 PUA 기호 매핑, 머리말/각주/하이퍼링크 처리 강화

## [4.2.0] - 2026-06-10

### Added — 법령 현행성(現行性) 가드: LLM이 개정 전 법령으로 답하는 사고 방지

LLM이 도구 결과만 보고도 "이 본문이 현행인지"를 판단할 수 있도록 검색·본문 조회 출력에 현행성 메타데이터를 명시. (실사고: 소방 관련 질의에 2022년 분법 전 「화재예방, 소방시설 설치ㆍ유지 및 안전관리에 관한 법률」 기준 답변)

- **`search_law`**: 법제처 응답의 `현행연혁코드`·`시행일자` 파싱 — 각 결과에 `[현행]` / `⚠️[연혁-과거버전]` 라벨 + 시행일 표기. 현행 우선 정렬, 첫 추천 항목이 연혁이면 현행 MST 사용 경고.
- **`get_law_text`**: 본문 헤더에 **조회기준일 vs 시행일 비교 라벨** — 시행 예정 버전(미시행) 경고, `efYd` 지정 시 "현행 아닐 수 있음" 경고, 연혁 MST 재확인 안내.
- **`get_law_text`**: `이전법령명` 표기 — 개정/분법으로 명칭이 바뀐 법령은 "(구 법령명: …)"을 함께 출력해 LLM이 학습데이터의 옛 법령명과 혼동하지 않도록 함.

## [4.1.0] - 2026-05-31

### Added — 판례 검색 구조화 + 상세 증거 자동 연결 (외부 PR #46)

판례 검색을 공통 구조화 core로 모으고, 긴 자연어/개념형 질의의 누락을 줄이며, 검색→본문조회 연결을 안정화.

- **`precedent-search-core.ts`** `searchPrecedentsStructured()`: 공통 판례 검색 진입점. `hits`/`attempts`/`fallbackUsed`/`successfulAttempt` 구조화. 사건번호 우선 → 제목 검색 → 본문검색(`search=2`) 폴백. compact query로 긴 질의 보정. 날짜 필터 시 표시 hit·`totalCount` 정합성 처리, `date_relaxed` 폴백.
- **`precedent-evidence.ts`** `fetchPrecedentEvidence()`: 상위 hit를 `get_precedent_text`에 연결(기본 2건/최대 5건). 부분 실패는 숨기지 않고 렌더링. `validatePrecedentSearchResult()`로 폴백 결과 질의 축 검증.
- **`compact-query-planner.ts`** 확장: 법리축+사실축 후보 생성, 출처/점수/variant/검증 메타데이터 보존.
- **`search_decisions(domain="precedent", options.includeText=true)`** + `options.detailLimit` 추가(기본 동작 유지, opt-in).
- 체인 도구(`chain_full_research`/`chain_dispute_prep`/`chain_document_review`) 판례 경로를 공통 core로 정리.
- 조문 기반 도구(`article-with-precedents`/`impact-map`)는 `fallbackPolicy: "none"`으로 정확 검색 유지.
- `docs/PRECEDENT-SEARCH-GUIDELINES.md` 추가.

기존 `[id] 제목` 렌더링·bracketed ID 추출 흐름 유지, 신규 노출 도구 없음.

### Fixed — 상세조회 다건 합산 시 뒷 판례 통째 잘림 (코드 리뷰 후속)

`search_decisions(includeText=true)`가 상세조회 2건을 이어붙인 뒤 `truncateResponse`(50KB)를 한 번만 적용해, 합산이 한도를 넘으면 두 번째 판례가 통째로 잘리던 문제. `fetchPrecedentEvidence`가 성공 항목 본문에 건당 예산(`MAX_RESPONSE_SIZE` 균등 배분)을 미리 적용하도록 수정 → 모든 판례가 균형 있게 보존.

### Changed

- `kordoc` 1.6.1 → 2.4.0 (별표 통합 파서 의존성 업데이트).

### 검증
- `npm run build` + 판례 검색 관련 비-live 회귀 테스트 + `test-precedent-evidence-budget.cjs`(건당 예산 배분) + v4.0.8/4.0.9 회귀 테스트 통과.

## [4.0.9] - 2026-05-31

### Fixed — 법제처 API `Referer` 헤더 누락으로 인한 "사용자 정보 검증 실패" / 전 검색 실패 (외부 PR #45)

법제처 OPEN API는 요청에 **`Referer` 헤더가 없으면 OC 키가 유효해도** "사용자 정보 검증에 실패하였습니다(정확한 서버장비의 IP주소 및 도메인주소를 등록해 주세요)" XML을 반환한다(헤더 격리 테스트로 입증, 동일 키·동일 IP 기준 Referer 유무만으로 갈림). 메시지가 IP 화이트리스트 문제로 오인되기 쉬우나 **실제 원인은 Referer 누락**.

- v4.0.8의 빈/HTML 재시도는 증상(`missing root element`)을 완화했을 뿐, 근본 원인은 이 Referer 누락이었음. fly 서버에서 재현 확인: Referer 없으면 `ECONNRESET`/검증실패, `Referer: https://www.law.go.kr/` 추가 시 정상 응답. 법제처가 최근(2026-05) 이 검증을 강화한 것으로 보임.
- **`fetch-with-retry.ts`**: 요청 호스트가 `law.go.kr` 계열일 때만 기본 `Referer` 주입(`isLawGoKrHost`). 호출자가 이미 지정했거나 다른 호스트(국세청 `taxlaw.nts.go.kr` 등)는 미주입. `LAW_REFERER` 환경변수로 override 가능.

### 검증
- `test/test-law-go-kr-referer.cjs`: 호스트 판별·기본 주입·호출자 보존·override·서브도메인 통과.
- `npm run build` + v4.0.8 빈/HTML 재시도 회귀 테스트 통과.

## [4.0.8] - 2026-05-29

### Fixed — 법제처 빈/HTML 응답으로 인한 `missing root element` 간헐 실패

법제처 OPEN API가 간헐적으로 **HTTP 200에 빈 본문 또는 HTML 점검 페이지**를 반환할 때, `search_law` 등 XML 파싱 경로가 `@xmldom`의 `missing root element`(빈 본문) / `Opening and ending tag mismatch`(HTML) 예외로 터지던 문제. `EXTERNAL_API_ERROR: missing root element`로 노출되며 "됐다 안 됐다" 증상으로 보고됨.

원인 규명:
- **IP 등록·OC 키 문제 아님.** IP 미등록 시 법제처는 *정상 형식의 XML*(`<Response>사용자 정보 검증 실패</Response>`)을 반환하고, 이 경우 도구는 `NOT_FOUND`를 냄 — `missing root element`는 **빈 응답/HTML(비-XML)** 일 때만 발생.
- **코드 회귀 아님.** v4.0.6→v4.0.7 변경(`precedents.ts`/`external-https-proxy.ts`)은 `search_law` 경로와 무관. 외부(법제처) 응답 불안정이 배포 시점과 우연히 겹친 것.

수정:
- **`fetch-with-retry.ts`**: HTTP 200이어도 본문이 비었거나 HTML 페이지면 일시 장애로 간주해 재시도(exponential backoff). 정상 응답(XML `<`, JSON `{`/`[`)은 영향 없음. 모든 법제처 호출(법령·판례·조례 등)이 공통 혜택 — `detectBadBody()` 추가.
- **`api-client.ts`**: `searchLaw`에 `checkEmptyResponse()`(빈 응답 감지) + `checkHtmlError()` 적용. 재시도 소진 후에도 빈/HTML이면 `missing root element` 대신 "법제처 API가 빈 응답을 반환했습니다. 일시적 장애일 수 있으니 잠시 후 다시 시도하세요" 안내.

### 검증
- mock 서버 단위 검증: 빈 응답·HTML 응답 재시도 동작, 간헐 장애(빈 2회→정상 XML) 재시도 복구 확인.
- `npm run build` 통과.

## [4.0.7] - 2026-05-29

### Fixed — 국세청 판례 본문 fallback 안정화 (외부 PR #44)

법제처 JSON API에 본문이 비어 오는 판례(예: 616821)를 국세청 `taxlaw.nts.go.kr`에서 HTML로 보강하는 fallback 추가.

- **3갈래 fallback 진입**: JSON 요청 실패 / JSON 파싱 실패 / 본문 누락(`isMissingPrecedentJson`) 모두 HTML fallback 경로로 진입. 전체가 outer try-catch로 감싸져 fallback이 실패해도 안전하게 에러 반환.
- **`formatPrecedentText`**: 판례 출력 로직 함수화로 중복 제거.
- **외부 HTTPS 프록시 지원** (`src/lib/external-https-proxy.ts`): `LAW_EXTERNAL_HTTPS_PROXY`(선택) — 사내망/SSL inspection 환경의 국세청 판례 접근용 CONNECT 프록시. `LAW_EXTERNAL_TLS_REJECT_UNAUTHORIZED=0`(진단/임시용, 운영 금지)로 해당 경로 한정 TLS 검증 우회.
- **redirect 추적**: `resolveTaxlawDetailUrl`이 상세 URL location 헤더를 최대 3회 추적.

### Refactor

- `isMissingPrecedentJson` 죽은 코드 제거 — `PrecService` early-return 이후 도달 불가능했던 `lawMessage` 분기 정리, 동작 유지하며 `return !obj.PrecService`로 단순화.

## [4.0.6] - 2026-05-23

### Added — 법제처 API 프로토콜 설정 (외부 PR #41)

- **`LAW_API_PROTOCOL`** 환경변수 추가(기본 `https`). 폐쇄망/인증서 문제 환경에서 `http`로 전환 가능.

### Fixed — 판례 재검색 키워드 후보 개선 (외부 PR #42)

- 판례 재검색 시 키워드 후보 생성 로직 개선으로 매칭 정확도 향상.

## [4.0.5] - 2026-05-23

### Security — 의존성 취약점 일괄 패치 (High 4건 → 0건)

`npm audit` High 등급 4개 패키지 일괄 업그레이드. 모두 semver-major 변경 없는 patch/minor 업데이트로 안전.

- **@xmldom/xmldom 0.9.8 → 0.9.10** (직접 의존성 + kordoc 간접, dedupe됨)
  - [GHSA-wh4c-j3r5-mjhp](https://github.com/advisories/GHSA-wh4c-j3r5-mjhp) — XML injection via unsafe CDATA serialization
  - [GHSA-2v35-w6hq-6mfw](https://github.com/advisories/GHSA-2v35-w6hq-6mfw) — Uncontrolled recursion in XML serialization (DoS)
  - [GHSA-f6ww-3ggp-fr8h](https://github.com/advisories/GHSA-f6ww-3ggp-fr8h) — XML injection through unvalidated DocumentType serialization
  - [GHSA-x6wf-f3px-wcqx](https://github.com/advisories/GHSA-x6wf-f3px-wcqx) — XML node injection through unvalidated processing instruction serialization
  - [GHSA-j759-j44w-7fr8](https://github.com/advisories/GHSA-j759-j44w-7fr8) — XML node injection through unvalidated comment serialization
- **@hono/node-server 1.19.9 → 1.19.14** (MCP SDK 간접) — 정적 미들웨어 경로 우회 (당 프로젝트는 미사용이나 트리 정리)
- **express-rate-limit 8.2.1 → 8.5.2** (MCP SDK 간접) — IPv4-mapped IPv6 우회로 rate limit 회피
- **fast-uri 3.1.0 → 3.1.2** (MCP SDK → ajv 간접) — path traversal / host confusion

### 검증
- `npm audit` → **found 0 vulnerabilities**
- `npm run build` → TypeScript 빌드 통과
- `@xmldom/xmldom` DOMParser smoke test 통과 (`hwpx-parser` 사용 코드 영향 없음)
- xmldom DOMParser API는 0.9.x 내 안정 — `lib/annex-file-parser.ts`의 HWPX 파싱 동작 변경 없음

### Files
- 수정: [package.json](package.json) (version), [package-lock.json](package-lock.json) (의존성 트리)
- 코드 변경 없음

## [4.0.4] - 2026-05-19

### Added — 약어 부분 매칭 (`extractEmbeddedAliases`)

기존 `resolveLawAlias`는 query 전체가 등록된 약어와 **정확 일치**할 때만 canonical로 변환. "화관법" 단독은 매핑되지만 "화관법 시행령"/"화관법 제5조"/"산안법 위반 사례" 같이 약어가 다른 토큰과 **결합된 query**는 매핑 실패하여 `search_law`가 0건으로 떨어지던 문제 수정.

- **`extractEmbeddedAliases(query)` 신규** ([src/lib/search-normalizer.ts](src/lib/search-normalizer.ts)) — 정규화된 query에 포함된 약어를 길이 우선 탐색하여 풀네임 치환 변형 query 반환. 길이 2자 미만 alias 제외(오탐 방지), 동일 canonical 중복 제거
- **`expandLawQuery` / `expandOrdinanceQuery` 통합** — 정확 매칭에 더해 부분 매칭 결과를 expanded 배열에 추가. `search_law`의 기존 0건 fallback 흐름이 그대로 혜택
- 차용 출처: korean-stats-mcp의 `extractKeyword` 긴 키 우선 부분 매칭 패턴

### 검증 (6 케이스 통과 / 회귀 0)
- "화관법 시행령" → "화학물질관리법 시행령"
- "화관법 제5조" → "화학물질관리법 제5조"
- "산안법 시행규칙" → "산업안전보건법 시행규칙"
- "중처법 제4조 책임자" → "중대재해 처벌 등에 관한 법률 제4조 책임자"
- "국기법 제15조" → "국세기본법 제15조"
- "도정법 제17조" → "도시 및 주거환경정비법 제17조"
- 약어 미포함 query("경상남도 광역시" 등)는 빈 expanded 반환 — 회귀 0건

LexDiff 룰 영향 최소화: 신규 함수 추가 + 기존 `expand*` 함수에 매칭 결과 push. 기존 `resolveLawAlias` 본체 수정 없음.

## [4.0.3] - 2026-05-11

### Fixed (사용자 제보: time_travel "임의시점 비교"에서 [NOT_FOUND]")

`chain_amendment_track`의 `time_travel` 시나리오가 자주 개정되는 법령(소득세법 시행령 등)에서 시점 매칭 실패. 원인 둘:

1. **lsHistory display 100건 한계**: 「소득세법 시행령」은 총 289건 연혁인데 `fetchHistoricalVersionsRaw`가 단일 호출 `display=100`만 사용 → 가장 오래된 연혁이 **2012-09-02** 까지만 닿음. 2012년 8월 이전 시점을 `fromDate`로 주면 모두 `[NOT_FOUND] 시점 매칭 실패` 반환. 법제처 API 문서엔 `max=100`이라 표기되어 있으나 실제는 `display=500`도 그대로 반환함을 검증.
2. **진단 메시지 부실**: "시점 매칭 실패. 가장 오래된 연혁: ..." 한 줄만 표기 → 사용자/LLM이 원인 추정 어려움.

- **페이징 회수기 신설** ([src/lib/historical-utils.ts](src/lib/historical-utils.ts)): `fetchHistoricalVersionsFull` — `display=500` + 페이징(최대 20p / 10,000건 안전상한) + 응답 HTML의 `총 N건` 파싱 + MST 중복 제거. 「소득세법 시행령」은 1회 호출로 288/289건 회수, 가장 오래된 연혁이 **1949-08-05**까지 닿음.
- **legacy `fetchHistoricalVersionsRaw` 호환 유지**: `@deprecated` 표기 후 내부적으로 `Full`을 호출, `versions`만 반환. 외부 호출자 영향 0.
- **진단 메시지 강화** ([src/tools/scenarios/time-travel.ts](src/tools/scenarios/time-travel.ts)):
  - 시점 매칭 실패 시: 연혁 범위(최초~최신 efYd), 수집 건수/법제처 총 건수, 페이지 수, 어떤 입력(fromDate/toDate)이 범위 밖인지 명시.
  - 본문 조회 실패 시: 시점 A/B의 MST와 efYd 표시.
  - 조문 추출 실패 시: MST와 추출 개수 표시 (새 분기).
  - 성공 시 헤더에 `연혁 N/M개 수집(Kp)` 줄 추가 (페이징 동작 가시화).
- **검증**: 「소득세법 시행령」 `time_travel` 호출 → 2024 vs 2026(평범), 2008 vs 2026(이전엔 실패), **1950 vs 2026**(최초 시행본 1949까지 닿음) 모두 정상 동작. 1940 vs 2026(범위 밖)은 친절한 [NOT_FOUND] 안내.

### Files
- 수정: [src/lib/historical-utils.ts](src/lib/historical-utils.ts) (페이징/총건수/중복제거), [src/tools/scenarios/time-travel.ts](src/tools/scenarios/time-travel.ts) (진단 강화, fetchHistoricalVersionsFull 사용)
- 신규 파일: 없음

## [4.0.2] - 2026-05-11

### Fixed (사용자 제보: "상법 검색 시 보상 관련 법령만 반환")

법제처 `lawSearch.do`는 법령명 **LIKE 검색 + 가나다순 정렬**로 동작한다. `query=상법`이면 totalCnt=56건 중 「상법」(상행위 법전)은 가나다순 **34위**에 위치하고, 1~33위는 "보상법/배상법/기상법/재해보상법" 시리즈가 점유한다. 여기에 MCP의 `display` 기본값이 20이라 사용자에게는 항상 보상 관련 법령만 노출되는 구조적 결함이 있었다. 「민법」「형법」「관세법」 등 두 글자 짧은 법령명 전부에 동일 패턴이 적용되어 LLM이 잘못된 법령을 인용하거나 웹검색으로 우회하던 사례 다수.

- **정확매칭 우선 후처리** ([src/tools/search.ts](src/tools/search.ts)): `법령명한글`/`법령약칭명`이 사용자 입력(또는 약칭 canonical)과 정확히 일치하는 결과를 분리해서 `📍 정확매칭` 섹션으로 최상단 노출. 나머지는 `📂 부분매칭` 섹션으로 분리.
- **`display` 기본값 20 → 50 상향**: 가나다순 정렬에서 짧은 법령명이 후순위로 밀려도 한 번에 회수되도록.
- **`api-client.searchLaw`에 `display` 인자 전달**: 기존엔 search-normalizer 단에서 display가 무시되던 호출 경로 수정.
- **단행법 alias entry 추가** ([src/lib/search-normalizer.ts](src/lib/search-normalizer.ts)): 「상법」「민법」「형법」「어음법」「수표법」 — 정식명이 자기 자신이라 alias 등록은 의미 약하나, `alternatives`로 관련 법령(시행령/시행법 등) 후보 제시 + `normalizeAliasKey` export로 정확매칭 비교 키 재사용.
- **검증**: `상법` → 1위 「상법」(MST 284143), `민법` → 1위 「민법」(MST 284415), `형법` → 1위 「형법」(MST 284025), `관세법` → 1위 「관세법」(MST 280363). 약칭 fallback(화관법/중처법/주임법) 정상 동작 확인.
- **`⚠️ 정확매칭 없음` 안내**: 정확매칭이 0건이면 LLM에게 부분 LIKE 결과임을 명시 → 환각 방지.

### Files
- 수정: [src/tools/search.ts](src/tools/search.ts) (정확매칭 분리, display 50, 안내문), [src/lib/search-normalizer.ts](src/lib/search-normalizer.ts) (단행법 5종 alias, normalizeAliasKey export)
- 신규 파일: 없음

## [4.0.1] - 2026-05-08

### Added (issue #35: 국세청 직접 회신 해석례 검색 미지원)

기존 `search_interpretations`는 법제처 정부유권해석(`target=expc`)만 조회하므로, 국세청이 직접 회신한 법령해석을 가져올 수단이 없었음. 키워드 매칭으로 국세청 관련 안건이 노출은 되지만 모두 `해석기관=법제처`라 사용자가 누락 사실조차 인지하기 어려웠던 문제.

- **`search_decisions`/`get_decision_text` 통합 도구의 `domain` enum에 `"nts"` 추가** — 법제처 API target `ntsCgmExpc`(국세청 법령해석 목록) 호출. 신규 노출 도구 0개.
- **응답 구조가 관세청(`kcsCgmExpc`)과 동일**해서 `customs-interpretations.ts`에서 `searchCgmExpcByTarget(target)` 헬퍼로 분기, `searchNtsInterpretations`/`getNtsInterpretationText` 두 entry만 추가.
- **본문 조회는 의도적으로 미구현** — 법제처 OPEN API가 국세청은 **목록 조회만 제공**하고 `lawService.do?target=ntsCgmExpc` 본문 endpoint를 제공하지 않음. `getNtsInterpretationText`는 `[NOT_SUPPORTED]` 안내 + 검색 단계의 `법령해석상세링크`(taxlaw.nts.go.kr) 외부 이동 안내만 반환 (LLM 환각 방지).
- **자연어 라우팅 패턴 추가** ([query-router.ts](src/lib/query-router.ts)):
  - `"국세청 양도소득세 해석"`, `"국세청 예규"`, `"법인세 예규 질의"` 등 → `search_decisions(domain=nts)`
  - 패턴: `/국세청\s*(?:법령\s*)?해석/`, `/(?:양도|소득|법인|부가가치|상속|증여|종합부동산)세\s*(?:해석|예규|질의)/`
- **검증**: `domain=nts`, `query="1세대 1주택 양도소득세"` 호출 시 812건 정상 매칭, 모두 `해석기관=국세청`. 1985~2020년대 국세청 직접 회신 해석례.

### Files
- 수정: [src/tools/customs-interpretations.ts](src/tools/customs-interpretations.ts) (target 분기 헬퍼 + nts 함수 2개), [src/tools/unified-decisions.ts](src/tools/unified-decisions.ts) (DOMAINS/LABELS/HANDLERS에 nts 추가), [src/lib/query-router.ts](src/lib/query-router.ts) (nts 자연어 패턴), [src/tool-registry.ts](src/tool-registry.ts) (search_decisions 설명 17→18 도메인)
- 신규 파일: 없음

### Design Note
v4.0의 "신규 도구 최소화, 기존 시스템 재활용" 원칙 유지. 신규 노출 도구 0개로 LLM 도구 선택 혼란 없음. V3_EXPOSED는 그대로 17개.

## [4.0.0] - 2026-05-07

### Added (3개 킬러 기능 한꺼번에 — 도구 추가는 1개로 최소화, 기존 시나리오 시스템 재활용)

#### 1. `impact_map` (신규 도구) — 조문 한 줄의 파급효과 그래프
**왜 필요했나**: 법령은 단독으로 살지 않는다. 한 조문(예: 민법 제103조)은 수십 건 판례에 인용되고, 헌재 결정의 근거가 되고, 자치법규에 묻어가고, 행정해석을 낳는다. 이 "조문 한 줄의 그림자"를 매뉴얼로 추적하면 법무팀 며칠 작업. 한 번에 보는 도구가 없었음.

- **입력**: `lawName` + `jo` (예: `민법`, `제103조`)
- **역방향 탐색** (병렬): 대법원 판례 / 헌재 결정 / 법령해석례 / 행정심판례 / 자치법규
- **정방향 탐색**: 그 조문 본문 안에서 인용된 다른 법령 자동 추출 (`「OO법」` 패턴)
- **출력**: 텍스트 트리 + **mermaid 그래프 코드** (claude.ai에서 시각화)
- **차별점**: 다른 모든 chain은 query 단방향. 이 도구는 "특정 조문 → 영향받는 모든 곳" 역방향 그래프.
- **검증**: `민법 제103조` 호출 시 판례 1건/헌재 6건/조례 2건 정확 추출 (테스트 완료)

#### 2. `time_travel` 시나리오 — 두 시점 본문 자동 diff
**왜 필요했나**: 기존 `compare_old_new`는 직전 개정 신구대조표만. "2024년 1월 vs 2026년 5월" 같은 임의 시점 비교 불가능. 법무팀/공무원/연구자 매뉴얼 비교 작업.

- **호스트**: `chain_amendment_track` (신규 도구 추가 X — 시나리오 확장)
- **신규 파라미터**: `fromDate`, `toDate` (YYYYMMDD)
- **처리**: 연혁(`lsHistory`)에서 두 시점에 시행 중이었던 MST 결정 → 본문 raw JSON 조회 → 조문 단위 자동 diff
- **출력**: 추가(+) / 삭제(-) / 변경(△) 조문 분류 + 변경 전후 본문 미리보기 + 자수 변화량
- **검증**: 개인정보보호법 2020-01-01 vs 2025-11-01 비교 시 제25조(영상정보처리기기→고정형 영상정보처리기기 명칭 변경, 자수 +222), 제26조(업무위탁 +326자), 제32조의2(인증기관 행정자치부장관→보호위원회 변경) 등 정확 검출

#### 3. `action_plan` 시나리오 — 시민 친화 5단계 실행 가이드
**왜 필요했나**: "전세금 못 받았어", "음주운전 걸렸어"처럼 시민이 자연어로 던지는 질문 → 기존 chain은 법령/판례 데이터 덤프만 줌. 시민이 "그래서 뭘 해야 하나"는 모름.

- **호스트**: `chain_full_research`
- **5단계 출력**:
  1. STEP 1 ─ 상황 진단 (적용 법령 자동 식별)
  2. STEP 2 ─ 권리·구제 수단 (실제 판례 시그널 + "패소 사유의 역 = 승소 조건")
  3. STEP 3 ─ 신청 기관 / 기한 (행정규칙 + 해석례)
  4. STEP 4 ─ 필요 서류 / 양식 (별표/별지서식 자동)
  5. STEP 5 ─ 함정 / 주의 (시효·개정·법률구조공단 안내)
- **시민 키워드 → 법률 도메인 자동 매핑**: 전세금→주택임대차보호법 보증금, 해고→근로기준법 부당해고, 음주운전→도로교통법, 체불→근로기준법 임금, 산재→산업재해보상보험법 등 10개 도메인
- **검증**: "전세금 못 받았어" → 주택임대차보호법 자동 매핑, 판례 20건/해석 4건/별표 2건/행정규칙 4건 일괄 수집

### Added (기존 도구 활용 자연어 라우팅)
- **`query-router.ts`** 신규 패턴 3개:
  - `impact_map`: "민법 제103조 영향그래프" / "민법 제103조 인용한 판례" → impact_map 직행
  - `time_travel`: "관세법 2024 vs 2026" / "관세법 시점 비교" → chain_amendment_track + scenario=time_travel + 자동 fromDate/toDate 추출
  - `action_plan`: "전세금 못 받았어" / "음주운전 걸렸어" / "해고 받았어" → chain_full_research + scenario=action_plan
- **specific_article 패턴 양보 로직**: "제N조 영향그래프/파급/인용한 판례" 키워드 동반 시 _skip → impact_map에 위임

### Fixed (4.0 작업 중 발견)
- **`api-client.fetchApi`**: `type=HTML` 응답에 `checkHtmlError`가 무조건 throw 하던 버그 → `type !== "HTML"`일 때만 적용하도록 수정. 기존 `searchHistoricalLaw`/`getHistoricalLaw` 등 lsHistory 기반 도구가 핫픽스(v3.5.5) 이후 깨져있던 것을 함께 복구.

### Changed
- **노출 도구 16 → 17개** (`impact_map` 추가)
- **시나리오 7 → 9개** (`time_travel`, `action_plan` 추가)
- `chainAmendmentTrackSchema`: `scenario` enum 확장(`timeline`, `time_travel`), `fromDate`/`toDate` 필드 신규
- `chainFullResearchSchema`: `scenario` enum 확장(`customs`, `action_plan`)
- `ScenarioContext`: `extras?: Record<string, unknown>` 필드 추가 — 시나리오별 추가 파라미터 전달용

### Files
- 신규: `src/tools/impact-map.ts`, `src/tools/scenarios/time-travel.ts`, `src/tools/scenarios/action-plan.ts`, `src/lib/historical-utils.ts`
- 수정: `src/tools/scenarios/types.ts`, `src/tools/scenarios/index.ts`, `src/tools/chains.ts`, `src/tool-registry.ts`, `src/lib/query-router.ts`, `src/lib/api-client.ts`

### Design Note
v4.0의 핵심 원칙은 **"신규 도구 최소화, 기존 시나리오 시스템 재활용"**. 3개 킬러 기능을 만들면서 새 도구는 1개(`impact_map`)만 추가하고 나머지 2개는 기존 chain의 시나리오로 통합. 도구 수 폭증 방지 + LLM이 도구 선택할 때 혼란 줄이기.

## [3.5.5] - 2026-05-06

### Fixed (긴급 핫픽스: 법제처 API 봇 차단 우회)

법제처 OPEN API가 Node.js 기본 User-Agent(`undici/...`)를 봇으로 분류해 거부하기 시작. fly.dev / Vercel 등 모든 클라우드 호스팅에서 `[EXTERNAL_API_ERROR] fetch failed` 또는 "사용자 정보 검증에 실패하였습니다" XML로 모든 도구가 죽는 현상.

**원인 진단의 함정**: 에러 메시지가 "정확한 서버장비의 IP주소 및 도메인주소를 등록해 주세요"라서 IP 화이트리스트 차단으로 오인되기 쉬움. 실제로는 IP 무관, **User-Agent 검증**. 같은 IP·같은 OC 키라도 브라우저 UA로는 통과, Node fetch UA로는 거부.

### Changed
- **`lib/fetch-with-retry.ts`** — 일반 Chrome 브라우저 UA를 기본 헤더로 주입. 옵션으로 넘어온 `headers`에 `user-agent`가 없을 때만 자동 추가 → 호출자 코드 변경 0
- `LAW_USER_AGENT` 환경변수로 override 가능 (정책 변경 시 빠른 대응)

### Impact
- claude.ai 커스텀 커넥터(`https://korean-law-mcp.fly.dev/mcp?oc=...`)로 사용하던 모든 사용자 즉시 영향 → v3.5.5 배포로 자동 복구
- npm 글로벌 설치(`npm i -g korean-law-mcp`) 사용자도 동일하게 적용
- IP 화이트리스트 / 한국 호스팅 이전 같은 큰 작업 불필요

## [Unreleased] - 2026-04-26

### Docs (issue #29: 플러그인 설치 시 SSH 키 미설정 사용자 지원)
- **README Troubleshooting 섹션 추가** — `/plugin install korean-law@korean-law-marketplace` 실행 시 `git@github.com: Permission denied (publickey)` 에러를 만나는 사용자를 위한 우회 방법 명시
  - **원인**: `marketplace.json`은 표준 github short form(`{ source: "github", repo: "..." }`)을 쓰지만, Claude Code 설치기가 SSH URL로 clone을 시도하는 동작에서 발생. SSH 키가 이미 설정된 개발자에게는 보이지 않는 실패 모드지만, 본 플러그인의 주 타겟인 법률 실무자/비개발자에게는 진입 장벽
  - **추가된 우회 안내**: (1) `git config --global url."https://github.com/".insteadOf "git@github.com:"` 한 줄로 HTTPS 강제 (추천), (2) `ssh-keygen` + GitHub Settings 등록
- 매니페스트 자체는 표준이라 변경 없음 — 향후 Claude Code 측에서 공개 GitHub 저장소에 HTTPS 기본 사용으로 개선되면 안내 제거 예정

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
