# 툴 의존성 분석 및 개선 방안

## 현재 툴 분류 (총 20개)

### 🟢 독립 실행 가능 (11개)
사용자가 직접 호출 가능, 별도 준비 작업 불필요

1. **search_law** - 법령 검색 (법령명만 입력)
2. **parse_jo_code** - 조문 번호 변환 (조문 번호만 입력)
3. **search_admin_rule** - 행정규칙 검색 (키워드만 입력)
4. **get_annexes** - 별표/서식 조회 (법령명만 입력)
5. **search_ordinance** - 자치법규 검색 (키워드만 입력)
6. **search_all** - 통합 검색 (키워드만 입력)
7. **suggest_law_names** - 자동완성 (부분 입력만)
8. **search_precedents** - 판례 검색 (키워드만 입력)
9. **search_interpretations** - 해석례 검색 (키워드만 입력)
10. **get_law_history** - 법령 변경이력 (날짜만 입력)
11. **advanced_search** - 고급 검색 (키워드만 입력)

### 🟡 약한 의존성 (5개)
선행 툴 필요하지만, Claude가 자동으로 워크플로우 구성 가능

12. **get_law_text** - 조문 조회
    - 필요: `mst` 또는 `lawId` (from search_law)
    - Claude 워크플로우: search → extract ID → get_law_text ✅

13. **compare_old_new** - 신구법 대조
    - 필요: `mst` 또는 `lawId`
    - Claude 워크플로우: search → extract ID → compare ✅

14. **get_three_tier** - 3단비교
    - 필요: `mst` 또는 `lawId`
    - Claude 워크플로우: search → extract ID → get_three_tier ✅

15. **compare_articles** - 조문 비교
    - 필요: 두 개의 `mst/lawId` + `jo`
    - Claude 워크플로우: search → extract IDs → compare ✅

16. **get_law_tree** - 법령 트리
    - 필요: `mst` 또는 `lawId`
    - Claude 워크플로우: search → extract ID → get_tree ✅

### 🔴 강한 의존성 (4개)
선행 툴 필수, ID가 숨겨져 있어 사용자가 직접 얻기 어려움

17. **get_admin_rule** - 행정규칙 조회
    - 필요: `id` (from search_admin_rule)
    - 문제: ID가 내부적이고 사용자가 모름
    - 해결: search_admin_rule 결과에 ID 노출 필요

18. **get_ordinance** - 자치법규 조회
    - 필요: `ordinSeq` (from search_ordinance)
    - 문제: ID가 내부적
    - 해결: search_ordinance 결과에 ID 노출 (✅ 이미 수정됨!)

19. **get_precedent_text** - 판례 전문
    - 필요: `id` (from search_precedents)
    - 상태: search_precedents 결과에 ID 노출됨 ✅

20. **get_interpretation_text** - 해석례 전문
    - 필요: `id` (from search_interpretations)
    - 상태: search_interpretations 결과에 ID 노출됨 ✅

---

## 🔍 실제 MCP 사용 시나리오 분석

### ✅ 정상 동작 시나리오

**시나리오 1: 법령 조문 조회**
```
User: "관세법 제38조 내용 알려줘"

Claude의 워크플로우:
1. search_law("관세법") 호출
2. 응답에서 mst=279811 추출
3. get_law_text(mst="279811", jo="제38조") 호출
4. 결과 제시
```
→ **작동함** ✅ (Claude가 자동으로 2단계 처리)

**시나리오 2: 판례 검색 후 전문 보기**
```
User: "자동차 관련 판례 찾아줘"

Claude:
1. search_precedents("자동차") 호출
2. 결과 목록 제시 (ID 포함: [609561])

User: "첫 번째 판례 전문 보여줘"

Claude:
3. get_precedent_text(id="609561") 호출
4. 전문 제시
```
→ **작동함** ✅ (ID가 응답에 노출됨)

### ⚠️ 문제 시나리오

**시나리오 3: 행정규칙 조회**
```
User: "WCO관세평가규정해설 전문 보여줘"

Claude:
1. search_admin_rule("WCO관세평가규정") 호출
2. 응답에서 ID=48938 추출 가능 ✅
3. get_admin_rule(id="48938") 호출
4. 하지만... "행정규칙 데이터를 찾을 수 없습니다" ❌
```
→ **API 문제** (툴은 정상, API 응답이 비어있음)

**시나리오 4: 자치법규 조회**
```
User: "서울특별시 강동구 공무원 행동강령 규칙 전문 보여줘"

Claude:
1. search_ordinance("강동구 공무원 행동강령") 호출
2. 응답에서 ordinSeq=1526175 추출 ✅
3. get_ordinance(ordinSeq="1526175") 호출
4. 전문 제시 ✅
```
→ **작동함** ✅ (수정 후)

---

## 📊 통폐합 필요성 검토

### Option 1: 현재 구조 유지 (권장) ⭐

**장점:**
- 세밀한 제어 가능 (검색만, 조회만 선택)
- 캐싱 효율적 (검색 결과 재사용)
- API 호출 최소화

**단점:**
- 2단계 워크플로우 필요

**결론:** Claude가 자동으로 워크플로우를 구성하므로 문제없음

### Option 2: 통합 툴 추가 (선택적)

일부 자주 사용되는 패턴만 통합 툴 제공

**추천 통합 툴:**

1. **search_and_get_law** (검색 + 조문 조회)
   ```typescript
   input: { lawName: "관세법", jo: "제38조" }
   내부 동작:
   1. search_law("관세법")
   2. get_law_text(mst, jo="제38조")
   ```

2. **search_and_get_precedent** (검색 + 전문)
   ```typescript
   input: { query: "자동차", index: 0 }  // 첫 번째 결과
   내부 동작:
   1. search_precedents("자동차")
   2. get_precedent_text(results[0].id)
   ```

**판단:** 불필요. 기존 툴 조합으로 충분하고 오히려 복잡도만 증가.

---

## 🔧 개선 방안

### 1. ✅ 완료된 개선

- [x] search_ordinance에서 자치법규일련번호 노출 (XML 파싱 수정)
- [x] search_precedents에서 판례ID 노출 (이미 구현됨)
- [x] search_interpretations에서 해석례ID 노출 (이미 구현됨)

### 2. 🔄 즉시 개선 필요

#### A. get_admin_rule 툴 검증

**문제:** API 호출 성공하지만 빈 응답 반환

**조사 필요:**
1. API 문서 확인 - 올바른 엔드포인트인가?
2. 실제 API 응답 확인
3. 파라미터 검증 (ID vs MST?)

#### B. 배치 툴 실제 사용성 검증

**툴:** `get_batch_articles`, `get_article_with_precedents`

**검증 항목:**
- 실제 사용 빈도가 높은가?
- 단순 반복 호출보다 나은가?
- 성능 이점이 있는가?

### 3. 📝 문서화 개선

#### CLAUDE.md 업데이트
```markdown
# 툴 사용 가이드

## 법령 조회 워크플로우

1단계: 법령 검색
search_law(query="관세법")
→ mst=279811, lawId=001556 획득

2단계: 조문 조회
get_law_text(mst="279811", jo="제38조")

## 판례 조회 워크플로우

1단계: 판례 검색
search_precedents(query="자동차")
→ [609561] 판례명... (ID 확인)

2단계: 전문 조회
get_precedent_text(id="609561")
```

---

## 🎯 최종 권장사항

### ✅ 유지할 것

1. **현재 툴 구조** - 20개 툴 모두 필요하고 적절함
2. **2단계 워크플로우** - Claude가 자동으로 처리 가능
3. **ID 노출 방식** - 검색 결과에 `[ID]` 형식으로 표시

### 🔧 수정할 것

1. **get_admin_rule 조사** - API 응답 문제 해결
2. **배치 툴 검증** - 실제 사용성 확인 후 유지/제거 결정
3. **문서화** - 워크플로우 가이드 추가

### ❌ 하지 않을 것

1. **툴 통폐합** - 현재 구조가 최적
2. **단일 대형 툴 생성** - 복잡도만 증가
3. **자동 체이닝** - MCP는 상태 비저장, Claude가 처리

---

## 📌 결론

**현재 툴 구조는 MCP 실사용에 적합합니다.**

- 독립 실행 툴 11개 - 즉시 사용 가능
- 약한 의존성 툴 5개 - Claude가 자동 워크플로우 구성
- 강한 의존성 툴 4개 - ID 노출로 해결됨 (3개 완료, 1개 API 문제)

**즉시 조치:** get_admin_rule API 응답 문제 조사
