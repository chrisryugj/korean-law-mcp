# Korean Law MCP - 개발 로드맵

## ✅ 완료된 기능 (v1.3.0)

### v1.3.0 신규 기능 (Tools 21-29)
- [x] **조문 연혁 추적** (Tool 21: `get_article_history`)
  - 일자별 조문 개정 이력 조회
  - 특정 조문의 시간에 따른 변화 추적
  - 법제처 API (`lsJoHstInf`) 활용

- [x] **법령 변경이력** (Tool 22: `get_law_history`)
  - 특정 날짜에 변경된 법령 이력 조회
  - 법령 개정 트렌드 분석
  - 법제처 API (`lsHstInf`) 활용

- [x] **판례 분석 기능** (Tools 23-25)
  - Tool 23: `summarize_precedent` - 판례 요약 (판시사항, 판결요지 추출)
  - Tool 24: `extract_precedent_keywords` - 핵심 키워드 추출 (빈도 기반)
  - Tool 25: `find_similar_precedents` - 유사 판례 검색 (키워드 유사도)

- [x] **법령 통계** (Tool 26: `get_law_statistics`)
  - 최근 개정 법령 TOP N
  - 소관부처별 법령 통계
  - 제정연도별 법령 통계

- [x] **조문 링크 파싱** (Tool 27: `parse_article_links`)
  - 조문 내 참조 자동 인식 ("제X조", "같은 조", "전항" 등)
  - 참조 링크 자동 생성

- [x] **외부 링크 생성** (Tool 28: `get_external_links`)
  - 법제처 국가법령정보센터 직접 링크
  - 법원도서관 판례 링크
  - 법령해석례 링크

- [x] **고급 검색** (Tool 29: `advanced_search`)
  - 기간 필터링 (제정일 범위)
  - 소관부처 필터링
  - AND/OR 복합 검색

---

## ✅ 완료된 기능 (v1.2.0)

### 핵심 기능 (Tools 1-18)
- [x] 법령 검색 (약칭 자동 인식)
- [x] 조문 조회 (한글 조문번호 자동 변환)
- [x] 신구법 대조
- [x] 3단 비교 (법률→시행령→시행규칙)
- [x] 행정규칙 검색/조회
- [x] 별표/서식 조회
- [x] 자치법규 검색/조회
- [x] 판례 검색/전문 조회
- [x] 법령해석례 검색/전문 조회
- [x] 자치법규 검색 툴 (Tool 11)
- [x] 조문 비교 (Tool 12)
- [x] 법령 트리 뷰 (Tool 13)
- [x] 통합 검색 (Tool 14)
- [x] 법령명 자동완성 (Tool 15)

### 성능 개선 (v1.2.0)
- [x] 캐싱 시스템 구현
  - 조문 조회 캐싱 (24시간 TTL)
  - 검색 결과 캐싱 (1시간 TTL)
  - API 호출 절약

### 편의 기능 (v1.2.0)
- [x] 배치 조회 (Tool 19)
  - 여러 조문을 한번에 조회
  - 법령 전문 캐싱 활용
- [x] 관련 판례 자동 조회 (Tool 20)
  - 조문 + 판례 통합 조회
  - 법률 실무 지원

### 개선사항
- [x] Tools 9-13 버그 수정
- [x] 자치법규 검색 API 추가
- [x] 100% 테스트 통과

---

## 🎯 로드맵 완료 현황

### ✅ 완료된 모든 기능
**v1.3.0 기준으로 로드맵의 모든 중장기 과제가 완료되었습니다!**

1. ✅ **검색 개선**
   - 자치법규 검색 툴 ✓
   - 통합 검색 ✓
   - 고급 검색 (기간/부처 필터링, AND/OR 연산) ✓

2. ✅ **조문 분석**
   - 조문 비교 ✓
   - 조문 연혁 추적 ✓

3. ✅ **판례/해석례 강화**
   - 관련 판례 자동 조회 ✓
   - 판례 요약 ✓
   - 판례 키워드 추출 ✓
   - 유사 판례 검색 ✓

4. ✅ **캐싱 & 성능**
   - 로컬 캐싱 ✓
   - 배치 조회 ✓

5. ✅ **편의 기능**
   - 법령명 자동완성 ✓
   - 조문 링크 파싱 ✓
   - 법령 트리 뷰 ✓

6. ✅ **외부 연동**
   - 법제처 외부 링크 생성 ✓
   - 법원도서관 링크 생성 ✓

7. ✅ **데이터 분석**
   - 통계 기능 (최근 개정, 소관부처별, 연도별) ✓

---

## 🚀 향후 개선 가능 영역

### 1. AI 고도화
- Claude API 활용한 고급 판례 요약
- 벡터 DB 기반 유사 판례 검색 (현재: 키워드 기반)
- 법률 질의응답 시스템

### 2. 실시간 데이터
- 최신 개정 법령 알림
- 법령 변경 감시 기능

### 3. 사용자 경험
- 자주 조회하는 법령 북마크
- 검색 이력 저장
- 맞춤형 대시보드

---

## 📊 현재 상태

**총 도구 수**: 29개 (v1.0: 18개 → v1.2: 20개 → v1.3: 29개)

### Tool 목록
1. `search_law` - 법령 검색
2. `get_law_text` - 조문 조회
3. `parse_jo_code` - JO 코드 변환
4. `compare_old_new` - 신구법 대조
5. `get_three_tier` - 3단 비교
6. `search_admin_rule` - 행정규칙 검색
7. `get_admin_rule` - 행정규칙 조회
8. `get_annexes` - 별표/서식 조회
9. `get_ordinance` - 자치법규 조회
10. `search_ordinance` - 자치법규 검색
11. `compare_articles` - 조문 비교
12. `get_law_tree` - 법령 트리 뷰
13. `search_all` - 통합 검색
14. `suggest_law_names` - 법령명 자동완성
15. `search_precedents` - 판례 검색
16. `get_precedent_text` - 판례 전문
17. `search_interpretations` - 해석례 검색
18. `get_interpretation_text` - 해석례 전문
19. `get_batch_articles` - 배치 조문 조회
20. `get_article_with_precedents` - 조문+판례 통합
21. `get_article_history` - 조문 연혁 (신규)
22. `get_law_history` - 법령 변경이력 (신규)
23. `summarize_precedent` - 판례 요약 (신규)
24. `extract_precedent_keywords` - 키워드 추출 (신규)
25. `find_similar_precedents` - 유사 판례 검색 (신규)
26. `get_law_statistics` - 법령 통계 (신규)
27. `parse_article_links` - 조문 링크 파싱 (신규)
28. `get_external_links` - 외부 링크 생성 (신규)
29. `advanced_search` - 고급 검색 (신규)

**주요 개선사항**:
- v1.2: 캐싱으로 API 호출 50% 이상 절감, 검색 응답 시간 단축
- v1.3: 조문 연혁, 판례 분석, 통계, 고급 검색 등 고급 기능 추가
- 로드맵 중장기 과제 100% 완료
