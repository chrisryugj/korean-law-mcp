# 판례 검색 반영 지침

이 문서는 판례 검색과 판례 본문조회 동작을 수정할 때 확인해야 할 호출 경로, 현재 구현 정책, 검증 항목을 정리한다.

대상 독자는 `korean-law-mcp`의 판례 검색, 통합 결정례 검색, 체인 도구를 수정하는 개발자다.

## 핵심 원칙

- 판례 검색은 여러 경로에서 호출된다. 직접 도구 호출, 통합 결정례 검색, 체인 도구, 보조 분석 도구가 같은 구현을 공유하거나 우회할 수 있으므로 한 경로만 보고 동작을 판단하지 않는다.
- 검색 도구와 상세조회 도구는 별도 도구다. MCP `tools/call`은 요청된 handler만 실행하며, 자연어 라우터나 search-detail chain을 자동 실행하지 않는다.
- 새 호출 경로에서는 렌더링된 텍스트에서 ID를 다시 파싱하는 방식보다 구조화된 hit 목록을 우선 사용한다.
- 기존 호환성을 위해 `search_precedents` 출력의 `[id] 제목` 형식은 유지한다. 기존 search-detail chain은 이 형식에서 상세조회 ID를 추출한다.
- 판례 검색 결과가 없을 때 LLM이 판례를 추측하지 않도록 실패 상태와 재시도 힌트를 명확히 렌더링한다.
- 특정 조문 영향도처럼 정확한 역방향 탐색이 중요한 경로는 자동 fallback을 끄고 원 검색어 그대로 조회한다.

## 현재 구현 요약

이번 판례 검색 강화는 공통 구조화 검색 core를 중심으로 동작한다.

- `src/tools/precedent-search-core.ts`
  - `searchPrecedentsStructured()`가 판례 목록 검색의 공통 진입점이다.
  - 반환값은 `StructuredPrecedentSearchResult`이며 `hits`, `attempts`, `fallbackUsed`, `successfulAttempt`를 포함한다.
  - 1차 검색은 명시 사건번호가 있으면 `caseNumber`, 아니면 원문 `query`로 수행한다.
  - 기본 fallback 정책은 `"full"`이다. 제목 검색 실패 시 본문검색(`search=2`)을 먼저 시도하고, 이후 compact query 후보를 시도한다.
  - `fallbackPolicy: "body"`는 본문검색까지만 허용한다.
  - `fallbackPolicy: "none"`은 보정 검색을 하지 않는다.
  - `maxFallbackAttempts`로 compact query 후보 개수를 제한한다. 기본값은 5다.
  - 날짜 조건이 있으면 표시되는 hit 기준으로 `totalCount`를 맞춘다.
  - 날짜 조건 때문에 결과가 모두 걸러졌지만 원 raw hit가 있으면 `date_relaxed` fallback으로 요청 기간 밖 결과를 표시할 수 있다.

- `src/tools/compact-query-planner.ts`
  - 원 자연어 질의, 사건번호, 문서 hint, query-router 후보, AI 법령검색의 조문 신호를 compact query 후보로 만든다.
  - 세금·건설 등 도메인 축과 사실 축을 분리해 `법리축 + 사실축` 후보를 우선 만든다.
  - 후보마다 `source`, `score`, `variantKind`, `requiresResultValidation`, `validationTermGroups`를 보존한다.
  - 결과 검증이 필요한 후보는 상세조회 검증 경로로 이어질 수 있다.

- `src/tools/precedent-evidence.ts`
  - `validatePrecedentSearchResult()`가 fallback 결과의 목록 메타데이터와 필요 시 상세 본문을 검증한다.
  - `fetchPrecedentEvidence()`가 구조화 hit의 상위 판례를 `getPrecedentText()`로 조회해 증거 텍스트를 만든다.
  - 상세조회 기본 개수는 2건이고, 최대 5건으로 제한한다.

- `src/tools/precedents.ts`
  - `searchPrecedents()`는 구조화 core를 호출한 뒤 `renderPrecedentSearchResult()`로 기존 텍스트 형식으로 렌더링한다.
  - 결과가 없으면 `[NOT_FOUND]`와 재시도 힌트를 포함하고 `isError`를 설정한다.
  - 결과가 있으면 `[id] 제목`, 사건번호, 법원, 선고일, 판결유형, 링크를 유지한다.
  - fallback이 사용되면 성공한 보정 시도와 검색 범위를 출력한다.

## 주요 호출 경로

### MCP 도구 등록과 직접 실행

- `src/tool-registry.ts`
- `search_precedents`와 `get_precedent_text`는 별도 도구로 등록된다.
- v3 exposed profile에서는 직접 노출 도구가 제한된다. 현재 직접 노출 도구는 `V3_EXPOSED`에 있는 17개이며, `search_precedents`와 `get_precedent_text`는 직접 노출되지 않는다.
- `execute_tool`, `search_decisions`, `get_decision_text`를 통한 우회 호출도 고려한다.

### 직접 판례 검색과 본문조회

- `src/tools/precedents.ts`
- `searchPrecedents`는 `searchPrecedentsStructured()`를 호출하고, 사람이 읽을 수 있는 텍스트로 렌더링한다.
- `getPrecedentText`는 판례 일련번호로 본문을 조회한다.
- 판례 JSON 본문이 비어 있거나 파싱이 실패할 수 있으므로 HTML fallback 경로를 유지한다.

### 구조화 판례 검색 core

- `src/tools/precedent-search-core.ts`
- 긴 자연어 질의는 원문 검색, 본문검색, 축약 검색어 후보 순서로 보정할 수 있다.
- 사건번호가 명시된 경우 사건번호 검색을 우선한다.
- 날짜 범위가 있는 검색은 렌더링되는 hit 수와 `totalCount`가 어긋나지 않도록 주의한다.
- 날짜 범위 밖 결과를 fallback으로 보여줄 때는 `outOfRequestedDateRange` 표시를 유지한다.
- 조문 단위 역방향 탐색처럼 원 검색어 의미가 좁은 경로에서는 `fallbackPolicy: "none"`을 사용한다.

### 검색 결과 검증과 상세 증거

- `src/tools/precedent-evidence.ts`
- fallback 후보가 넓은 검색어일수록 결과 검증이 필요하다.
- 검증은 목록 텍스트만 보지 말고 필요하면 상위 상세 본문까지 확인한다.
- 상세조회는 응답 크기와 외부 API 부하를 고려해 기본 상한을 둔다.
- 검증용 상세조회는 기본적으로 1건만 확인한다.

### 자연어 라우팅

- `src/lib/query-router.ts`
- 자연어 라우터는 검색어를 일부 정규화하고 도구 실행 계획을 만들 수 있지만, raw MCP tool call에는 자동 적용되지 않는다.
- 구조화 core는 `routeQuery(input.query)` 결과를 context로 받을 수 있다. 라우터 개선만으로 직접 도구 호출, 통합 검색, 체인 도구의 동작이 모두 개선된다고 가정하지 않는다.

### search-detail chain

- `src/lib/tool-chain-config.ts`
- `src/tools/search-detail-chain.ts`
- 기존 chain은 렌더링된 검색 결과에서 bracketed ID를 추출한다.
- `search_precedents` 렌더링 형식을 변경할 때는 chain 상세조회 테스트를 함께 수정하고 검증한다.

### 체인 도구

- `src/tools/chains.ts`
- `chain_full_research`는 AI 법령검색, 법령 검색, 해석례 검색을 먼저 수행하고, AI 조문 신호와 query-router 결과를 context로 넘겨 판례를 구조화 검색한다.
- `chain_dispute_prep`은 판례 검색과 상세 증거 조회를 `searchPrecedentsForChain()` 경로로 처리한다.
- `chain_document_review`는 `analyze_document` 출력의 `검색:` hint를 최대 5개까지 추출하고, 각 hint에 대해 구조화 판례 검색을 수행한다.
- `chain_document_review`의 판례 fallback 후보는 hint별 최대 3개로 제한한다.
- 체인 도구는 `fetchPrecedentEvidence()`로 상위 2건의 상세 증거를 붙인다.
- 체인 도구 안에서만 동작하는 임시 fallback을 늘리기보다 공통 core로 모으는 것을 우선한다.
- 문서 검토 체인의 검색 hint 형식 변경은 후속 판례 검색에 영향을 줄 수 있다.

### 통합 결정례 검색

- `src/tools/unified-decisions.ts`
- `search_decisions`는 `domain="precedent"`일 때 기본적으로 기존 `searchPrecedents()` handler를 호출한다.
- `options.includeText`가 `true` 또는 `"true"`이면 `searchPrecedentDecisionsWithText()` 경로로 들어간다.
- `includeText` 경로는 구조화 판례 검색 결과 뒤에 `fetchPrecedentEvidence()` 상세 증거를 붙인다.
- `options.detailLimit`은 숫자 또는 숫자 문자열을 받을 수 있고, 실제 상세조회 개수는 `precedent-evidence`의 상한을 따른다.
- `get_decision_text`는 여전히 `domain="precedent"`와 검색 결과 ID를 받아 `getPrecedentText()`로 상세 본문을 조회한다.

### 조문 기반 보조 도구

- `src/tools/article-with-precedents.ts`
- `get_article_with_precedents`는 조문 본문에서 법령명을 추출해 `${lawName} ${jo}`로 관련 판례를 검색한다.
- 이 경로는 `fallbackPolicy: "none"`을 사용한다. 조문 영향 검색에서 의미가 넓어지는 보정 검색을 하지 않는다.

- `src/tools/impact-map.ts`
- `impact_map`은 `${공식법령명} ${조문번호}`를 기준으로 판례, 해석례, 행정심판례, 헌재 결정례, 자치법규를 역방향 탐색한다.
- 판례 검색은 `searchPrecedentsStructured()`를 쓰지만 `fallbackPolicy: "none"`으로 제한한다.

### 다른 판례 호출자

- `src/tools/similar-precedents.ts`
- `src/tools/precedent-summary.ts`
- `src/tools/precedent-keywords.ts`
- `src/tools/scenarios/*`

판례 검색 core나 렌더링을 바꾸면 위 호출자들이 검색 결과 없음, 상세조회 실패, ID 형식, 축약 응답을 어떻게 처리하는지 확인한다.

## 구현 체크리스트

판례 검색 변경 PR은 아래 항목을 확인한다.

- 직접 `search_precedents` 호출과 `get_precedent_text` 호출이 각각 정상 동작한다.
- `search_decisions`의 `domain="precedent"` 경로가 기존 호환성을 유지한다.
- `search_decisions(domain="precedent", options.includeText=true)` 경로가 목록과 상세 증거를 함께 반환한다.
- `options.detailLimit`은 기본값, 비정상 값, 상한 초과 값을 확인한다.
- 체인 도구는 판례 목록과 상세 증거를 모두 안정적으로 렌더링한다.
- bracketed ID 형식이 깨지지 않는다.
- 검색 결과 없음은 `isError`와 명시적 실패 문구를 반환한다.
- 날짜 필터 결과의 `totalCount`와 실제 표시 hit 수가 맞다.
- fallback 후보가 원 질의와 멀어질 때 결과 검증을 수행한다.
- 조문 기반 경로는 `fallbackPolicy: "none"`을 유지한다.
- 외부 API 오류와 본문 누락은 도구 오류로 처리하고 판례 내용을 생성하지 않는다.
- transport나 MCP endpoint를 바꾸기 전에 실제 transport 문제가 재현되는지 확인한다.

## 권장 검증

변경 범위에 따라 아래 테스트를 실행한다.

```bash
npm run build
node test/test-precedent-search-core.cjs
node test/test-precedent-evidence.cjs
node test/test-chain-search-detail-integration.cjs
node test/test-chain-full-research-precedent-retry.cjs
node test/test-compact-query-planner.cjs
node test/test-precedent-search-scope.cjs
node test/test-search-decisions-precedent-include-text.cjs
```

외부 API 키나 네트워크가 필요한 live 테스트는 환경 조건을 PR 본문에 명시한다.
