# Changelog

## [3.0.1] - 2026-04-08

### Added
- get_ordinance: `jo` 파라미터 추가 — 특정 조문 본문 직접 조회 가능 (#19)
- 대형 조례(20개 초과) 목차 반환 시 `jo` 사용법 안내 메시지 추가

### Fixed
- get_ordinance: JO 코드 생성 시 `buildJO`(법률용 AAAABB) → `buildOrdinanceJO`(자치법규용 AABBCC) 수정
- get_ordinance: 조문 필터링에서 "제20조" 검색 시 "제20조의2" 등 의X 조문이 잘못 매칭되는 문제 수정

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
