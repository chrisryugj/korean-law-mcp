# 프로덕션 리뷰 — 4.15.3

검토일: 2026-10-02. 목적은 조회 정확성, 외부 API 부하, 메모리와 실행 한도 개선이다. 기능을 추가하지 않는다.

## 범위

| 경로 | 확인 내용 |
|---|---|
| MCP 등록·메타 도구·CLI | 입력·출력 최종 게이트, 스키마 광고, 상세 파이프라인 오류 전달 |
| HTTP·업스트림 공통 | 인증·Origin·쿼리 키·rate limit·요청 예산 연결, retry·deadline·본문 크기·취소·안티봇 정리 |
| 판례 | 직접·통합 검색, includeText, evidence, fallback 관련성, 상세 JSON·국세 HTML 복구, 캐시, 인용 추적 |
| 법령·행정규칙·연혁 | 조문 선택, 기준일 버전·분리 시행, 조문 개정 이력, 행정규칙 뷰·캐시 |
| 별표·체인 | 번호·가지·묶음 선택, 법령 전문 중복 조회, 시간 한도와 완료 작업 정리 |
| 기타 결정 도메인 | 헌재·행정심판·위원회·해석례 JSON 필드 보존 |
| 패키지·통합 배포 | npm 산출물, optional 없는 프로덕션 의존성, Node 하한, 5종 MCP 핸드셰이크·쿼리 키·대형 본문 |

별도 리뷰에서 변경분의 P1/P2 회귀를 찾지 못했다. 이 기록은 코드·회귀 테스트·명시된 실호출의 검증 범위를 뜻하며, 모든 외부 자료나 법률 판단을 검증했다는 뜻은 아니다.

## 수정한 문제와 재현 근거

| 문제 | 수정 | 회귀 테스트 |
|---|---|---|
| 사건번호 query가 대상 대신 인용 판례를 반환 | 순수 번호는 nb 우선, 이웃 사건 제외, 실패 시 다른 사건으로 대체하지 않음 | precedent-production |
| 여러 판례의 키워드를 합쳐 관련성 인증, 기간 완화 때 검증 우회 | 개별 판례 기준 검증, 기간 밖 후보도 검증 | precedent-production |
| 판례 복구·검증·근거 조회가 취소·예산 소진을 삼킴 | fatal 오류 전파, 추가 복구·재검색 중단 | precedent-production |
| 사건번호 prefix를 정확 대상·변경 신호로 오인 | 정확 인용 경계, 대상 보정 후 실제 번호로 후속 검색 | cite-check-production |
| 미스캔 또는 본문 대상 인용 불일치를 계속 인용으로 인증 | 미확정·인용 확인 불가 표시, 대상보다 오래된 판결 제외 | cite-check-production |
| wrapped JSON 필드가 `[object Object]`로 출력 | 공유 fieldText로 필드 평탄화 | precedent-production, decision-body.review |
| 헤더·검사 이후 전체 timeout 해제, 계속 오는 청크가 무제한 | 반환 Response의 공용 본문 리더까지 절대 deadline 적용 | fetch-deadline, response-body.deadline |
| 호출자 취소가 본문 검사·최종 본문에 누락 | 해당 읽기에 취소 전파, 만료된 미독 본문도 정리 | fetch-deadline |
| 취소 Promise를 기다리며 retry·안티봇·HTTP 오류 처리 중단 | 정리 취소를 기다리지 않음, 오류 상태 본문 버퍼링 제거 | api-client.error-body, law-antibot.cleanup |
| 같은 MST의 다른 시행일 비교 누락, 목 내용 누락, 잘못된 달력 날짜 수용 | mst+efYd 비교, 공용 조문 포맷터, 달력 유효성 검사 | applicable-law.review |
| 다른 법령의 첫 LIKE 결과로 개정 이력 조회 | 정확 명칭·약칭이 없으면 lawId 재확인 안내 | article-history |
| JO가 무시되면 다른 조문이 성공 응답 | 반환 조문번호·가지 확인, 기존 조문 표기 변환 재사용 | law-text.review |
| 숫자 조문번호 오류, 같은 법령 중복 조회, 마지막 처리 중 취소 후 성공 | 숫자 정규화, 요청 내부 진행 중 전문 공유, 완료 전 취소 확인 | batch-articles.review |
| 별표 1에 10/1의2, 1의2에 1의20/묶음 오선택 | 숫자·가지 경계, 가지 요청의 묶음 범위 제외 | annex-select.review |
| 완료된 체인 작업의 abort listener 잔류 | race 완료·실패 시 listener 제거 | chain-deadline.review |
| CLI 상세 실패를 JSON 성공·종료 코드 0으로 출력 | 전체 파이프라인 isError 누적, 오류 종료 코드 | cli-executor.errors |

새 회귀는 수정 전 실패를 재현한 뒤 수정 후 통과를 확인했다. 수정한 경로의 정상 입력과 기존 통합 계약도 함께 검증했다.

## 성능 근거

- 판례 원문: 종전 전역 500건 raw JSON 캐시 대신 전용 20건 parsed record 캐시. 24시간 TTL, full/compact/cite_check 공유. 원시 JSON 사본을 함께 보관하지 않는다.
- 동일 판례 full+compact 조회는 상세 API 1회·JSON.parse 1회. full→cite_check→cite_check도 상세 API 합계 1회. 회귀 테스트로 횟수 확인.
- 100만자 JSON 100회 합성 측정: raw 캐시 후 재파싱 103.8ms, parsed 캐시 조회 0.14ms. 네트워크·렌더를 제외한 측정이며 전체 응답 속도 개선율로 해석하지 않는다.
- 같은 법령의 동시 batch 항목 2개: 전문 API 호출 2회→1회. 공유 범위는 한 get_batch_articles 호출 안이며, 완료 후 진행 중 참조를 해제한다.
- 오류 HTTP 상태는 이미 분류 가능하므로 본문을 읽고 버퍼링하지 않는다. 멈춘 본문·끝나지 않는 cancel Promise로 오류 처리가 지연되는 회귀를 차단했다.

## 검증

- 기준: 119개 파일 / 1,119개 테스트 통과. 수정본: 131개 파일 / 1,181개 테스트 통과.
- `npm run gc`: 타입·미사용 코드·전체 테스트·clean build 통과.
- `npm run verify:package`: 302개 패키지 파일 검증. `npm audit --omit=dev`: 취약점 0.
- 실제 npm tarball을 별도 디렉터리에 `--omit=dev --omit=optional --ignore-scripts`로 설치해 Node 20.19.0의 PDF 별표 파싱과 stdio 초기화·10개 도구 목록·JO 변환을 확인했다.
- 지원 런타임 Node 20.19.0과 22.12.0에서 전체 테스트 검증.
- 판례 core·evidence·HTML fallback·검색 범위·includeText·research/detail 체인 및 통합 도구 디스패치 CJS 회귀 검증.
- 실제 HTTP 청크 스트림에서 전체 한도 만료 후 업스트림 연결 종료 검증.
- 배포 전 통합 호스트의 5종 핸드셰이크, `?oc=` 실호출, 도로교통법 시행규칙 큰 본문 조회 통과.

## 유지하는 한계

- 판례 캐시는 건수 제한이며 바이트별 제한은 아니다. 서로 다른 요청의 동시 cache miss를 전역 Promise로 합치지 않는다.
- 인용 추적은 법제처 수록 범위와 최대 3건 본문 스캔·휴리스틱에 따른다. 변경 신호가 없는 것이 판례의 법적 유효성을 증명하지 않는다.
- 전체 fetch deadline은 공용 readResponse* 리더에 적용한다. Native Response 메서드를 변형하지 않으며 프로덕션의 직접 본문 읽기 우회가 없음을 확인했다.
- 배포 머신은 현재 nrt의 기존 머신을 제자리 갱신한다. 통합 호스트의 리전·다른 MCP 핀은 변경하지 않는다.
