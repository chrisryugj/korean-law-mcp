# Korean Law MCP - API Reference

> **v1.4.0** | 33개 도구 완전 레퍼런스

이 문서는 Korean Law MCP Server가 제공하는 모든 도구의 상세 API 명세를 제공합니다.

---

## 목차

- [검색 도구 (11개)](#검색-도구-11개)
- [조회 도구 (9개)](#조회-도구-9개)
- [분석 도구 (9개)](#분석-도구-9개)
- [전문 도구 (4개)](#전문-도구-4개) ⭐ New in v1.4.0
- [공통 사항](#공통-사항)

---

## 검색 도구 (11개)

### 1. search_law

**기능**: 법령명으로 법령 검색

**파라미터**:
```typescript
{
  query: string        // 검색어 (법령명 또는 약칭)
  maxResults?: number  // 최대 결과 수 (기본값: 10, 최대: 20)
}
```

**응답 형식**:
```
검색 결과 (총 X건):

1. 법령명
   - 법령ID: XXXXXX
   - MST: XXXXXX
   - 공포일: YYYYMMDD
   - 구분: 법률/대통령령/부령

2. ...
```

**예제**:
```javascript
// 입력
{
  "query": "화관법",
  "maxResults": 5
}

// 출력
검색 결과 (총 1건):

1. 화학물질관리법
   - 법령ID: 010345
   - MST: 276801
   - 공포일: 20241029
   - 구분: 법률
```

**특징**:
- 약칭 자동 인식: `화관법` → `화학물질관리법`
- 오타 보정: `fta특례법`, `FTA특례법` 모두 인식
- 캐싱: 1시간 TTL

---

### 2. search_admin_rule

**기능**: 행정규칙 검색 (훈령, 예규, 고시, 공고)

**파라미터**:
```typescript
{
  query: string        // 검색어
  maxResults?: number  // 최대 결과 수 (기본값: 10, 최대: 20)
}
```

**응답 형식**:
```
행정규칙 검색 결과 (총 X건):

1. 행정규칙명
   - 행정규칙일련번호: XXXXXXXXXXXX
   - 행정규칙ID: XXXXX
   - 공포일: YYYYMMDD
   - 구분: 훈령/예규/고시/공고
   - 소관부처: XXX청
```

**예제**:
```javascript
{
  "query": "관세"
}

// 출력
행정규칙 검색 결과 (총 20건):

1. 과세자료 확보에 관한 훈령
   - 행정규칙일련번호: 2100000261222
   - 행정규칙ID: 88661
   - 공포일: 20250701
   - 구분: 훈령
   - 소관부처: 관세청
```

---

### 3. search_ordinance

**기능**: 자치법규 검색 (조례, 규칙)

**파라미터**:
```typescript
{
  query: string        // 검색어
  display?: number     // 결과 수 (기본값: 10, 최대: 100)
}
```

**응답 형식**:
```
자치법규 검색 결과 (총 X건, Y페이지):

[XXXXXX] 조례명/규칙명
  지자체: XX도 XX시
  공포일: YYYYMMDD
  시행일: YYYYMMDD
  링크: /DRF/lawService.do?...
```

**예제**:
```javascript
{
  "query": "환경 조례",
  "display": 5
}

// 출력
자치법규 검색 결과 (총 4591건, 1페이지):

[1121483] 가평군 건전한 음주문화 환경조성 및 지원에 관한 조례
  지자체: 경기도 가평군
  공포일: 20150302
  시행일: 20150302
```

---

### 4. search_precedents

**기능**: 판례 검색

**파라미터**:
```typescript
{
  query?: string       // 검색어 (선택)
  court?: string       // 법원명 (선택)
  caseNum?: string     // 사건번호 (선택)
  display?: number     // 결과 수 (기본값: 10, 최대: 100)
  sort?: string        // 정렬 (lawNm: 법령명, ddate: 날짜, caseNm: 사건명)
}
```

**응답 형식**:
```
판례 검색 결과 (총 X건, Y페이지):

[XXXXXX] 판례명
  사건번호: XXXXXXXXXX
  법원: XX법원
  선고일: YYYY.MM.DD
  판결유형: 판결/결정
  링크: /DRF/lawService.do?...
```

**예제**:
```javascript
{
  "query": "자동차",
  "court": "대법원",
  "display": 5
}

// 출력
판례 검색 결과 (총 124건, 1페이지):

[609561] 여객자동차운수사업법위반
  사건번호: 2025고단1110
  법원: 인천지방법원
  선고일: 2025.09.10
  판결유형: 판결 : 항소
```

---

### 5. search_interpretations

**기능**: 법령해석례 검색

**파라미터**:
```typescript
{
  query: string        // 검색어
  display?: number     // 결과 수 (기본값: 10, 최대: 100)
}
```

**응답 형식**:
```
해석례 검색 결과 (총 X건, Y페이지):

[XXXXXX] 해석례 제목
  해석례번호: XX-XXXX
  회신일자: YYYY.MM.DD
  해석기관: 법제처
  링크: /DRF/lawService.do?...
```

**예제**:
```javascript
{
  "query": "근로기준법",
  "display": 5
}

// 출력
해석례 검색 결과 (총 44건, 1페이지):

[333393] 고용노동부 - 「근로기준법」 제74조제5항에 따라 임신 중인 여성근로자에게 금지되는 "시간외근로"의 기준이 되는 시간은 법정근로시간인지 소정근로시간인지 등
  해석례번호: 22-0186
  회신일자: 2022.04.26
  해석기관: 법제처
```

---

### 6. search_all

**기능**: 통합 검색 (법령 + 행정규칙 + 자치법규 동시 검색)

**파라미터**:
```typescript
{
  query: string        // 검색어
  maxResults?: number  // 각 카테고리별 최대 결과 수 (기본값: 3, 최대: 10)
}
```

**응답 형식**:
```
=== 통합 검색 결과: "검색어" ===

📚 법령 검색 결과
------------------------------------------------------------
검색 결과 (총 X건):
1. ...
... (최대 maxResults개)

📋 행정규칙 검색 결과
------------------------------------------------------------
행정규칙 검색 결과 (총 X건):
1. ...

🏛️ 자치법규 검색 결과
------------------------------------------------------------
자치법규 검색 결과 (총 X건):
1. ...
```

**예제**:
```javascript
{
  "query": "환경",
  "maxResults": 3
}
```

---

### 7. suggest_law_names

**기능**: 법령명 자동완성

**파라미터**:
```typescript
{
  partial: string      // 부분 법령명
}
```

**응답 형식**:
```
'부분명'(으)로 시작하는 법령:

1. 법령명
2. ...
```

**예제**:
```javascript
{
  "partial": "근로"
}

// 출력
'근로'(으)로 시작하는 법령:

1. 근로기준법
2. 근로자퇴직급여보장법
3. 근로자참여 및 협력증진에 관한 법률
4. 근로자직업능력 개발법
```

---

### 8. parse_jo_code

**기능**: 조문번호 ↔ JO 코드 양방향 변환

**파라미터**:
```typescript
{
  joText: string                  // 변환할 문자열
  direction: "to_code" | "to_text"  // 변환 방향
}
```

**응답 형식**:
```json
{
  "input": "제38조",
  "output": "003800",
  "direction": "to_code"
}
```

**예제**:
```javascript
// 한글 → 코드
{
  "joText": "제38조",
  "direction": "to_code"
}
// → { "input": "제38조", "output": "003800", "direction": "to_code" }

// 코드 → 한글
{
  "joText": "003800",
  "direction": "to_text"
}
// → { "input": "003800", "output": "제38조", "direction": "to_text" }

// 지조 처리
{
  "joText": "제10조의2",
  "direction": "to_code"
}
// → { "input": "제10조의2", "output": "001002", "direction": "to_code" }
```

---

### 9. get_law_history

**기능**: 특정 날짜에 변경된 법령 목록 조회

**파라미터**:
```typescript
{
  date: string         // 날짜 (YYYYMMDD 형식)
  maxResults?: number  // 최대 결과 수 (기본값: 20)
}
```

**응답 형식**:
```
YYYY년 MM월 DD일 법령 변경 이력 (총 X건):

1. 법령명
   - 법령ID: XXXXXX
   - 공포일: YYYYMMDD
   - 시행일: YYYYMMDD
   - 제개정구분: 일부개정/전부개정/제정
```

**예제**:
```javascript
{
  "date": "20250101"
}
```

---

### 10. advanced_search

**기능**: 고급 검색 (기간 필터, AND/OR 검색)

**파라미터**:
```typescript
{
  query: string          // 검색어 (쉼표로 구분하여 여러 키워드)
  searchType?: string    // 검색 대상 (law/admrul/ordin, 기본값: law)
  fromDate?: string      // 시작일 (YYYYMMDD)
  toDate?: string        // 종료일 (YYYYMMDD)
  department?: string    // 소관부처 (행정규칙만 해당)
  operator?: "AND" | "OR"  // 키워드 연산자 (기본값: OR)
  maxResults?: number    // 최대 결과 수 (기본값: 10)
}
```

**응답 형식**:
```
고급 검색 결과:
검색어: keyword1, keyword2
연산자: AND/OR
기간: YYYY.MM.DD ~ YYYY.MM.DD
대상: 법령/행정규칙/자치법규

검색 결과 (총 X건):
1. ...
```

**예제**:
```javascript
{
  "query": "환경, 보호",
  "searchType": "law",
  "fromDate": "20200101",
  "toDate": "20251231",
  "operator": "AND"
}
```

---

### 11. get_annexes

**기능**: 법령 별표 및 서식 조회

**파라미터**:
```typescript
{
  lawName: string      // 법령명
  knd: string          // 유형 (1: 별표, 2: 서식, 3: 부칙별표, 4: 부칙서식)
}
```

**응답 형식**:
```
법령명: XXX법
별표 목록 (총 X건):

1. [XXXXXX] 별표명
   📎 파일: /LSW/flDownload.do?flSeq=XXXXX
   📚 관련법령: 관련 법령명
```

**예제**:
```javascript
{
  "lawName": "관세법",
  "knd": "1"  // 별표
}
```

---

## 조회 도구 (9개)

### 12. get_law_text

**기능**: 법령 조문 전문 조회

**파라미터**:
```typescript
{
  mst?: string         // 법령일련번호 (mst 또는 lawId 중 하나 필수)
  lawId?: string       // 법령ID
  jo?: string          // 조문번호 (선택, 한글 또는 6자리 코드)
  efYd?: string        // 시행일자 (선택, YYYYMMDD)
}
```

**응답 형식**:
```
법령명: XXX법
공포일: YYYYMMDD
시행일: YYYYMMDD

[조문번호 지정 시]
제XX조 조문제목
제XX조(조문제목)
① 조문 내용...
② 조문 내용...

[조문번호 미지정 시]
전체 법령 텍스트 (편, 장, 절 포함)
```

**예제**:
```javascript
// 특정 조문 조회
{
  "mst": "279811",
  "jo": "제38조"
}

// 전체 법령 조회
{
  "mst": "279811"
}

// lawId 사용
{
  "lawId": "관세법",
  "jo": "38조"  // "제" 없이도 가능
}
```

**특징**:
- 조문번호 자동 변환: `제38조` → `003800`
- 캐싱: 24시간 TTL
- 조문 미지정 시 전문 반환

---

### 13. get_admin_rule

**기능**: 행정규칙 전문 조회

**파라미터**:
```typescript
{
  id: string           // 행정규칙일련번호
}
```

**응답 형식**:
```
행정규칙명: XXX
공포일: YYYYMMDD
종류: 훈령/예규/고시/공고
소관부처: XXX청

━━━━━━━━━━━━━━━━━━━━━━

제1조(목적) ...
제2조(정의) ...

[부칙이 있는 경우]
━━━━━━━━━━━━━━━━━━━━━━
부칙
━━━━━━━━━━━━━━━━━━━━━━
부칙 내용...

[별표가 있는 경우]
━━━━━━━━━━━━━━━━━━━━━━
별표
━━━━━━━━━━━━━━━━━━━━━━
[별표명]
별표 내용...
```

**예제**:
```javascript
{
  "id": "2100000261222"
}
```

**특징**:
- XML 파싱으로 조문 추출
- 조문이 없는 경우 첨부파일 링크 제공

---

### 14. get_ordinance

**기능**: 자치법규 전문 조회

**파라미터**:
```typescript
{
  ordinSeq: string     // 자치법규일련번호
}
```

**응답 형식**:
```
조례명/규칙명
지자체: XX도 XX시
공포일: YYYYMMDD
시행일: YYYYMMDD

[조문 내용]
```

**예제**:
```javascript
{
  "ordinSeq": "1526175"
}
```

---

### 15. get_precedent_text

**기능**: 판례 전문 조회

**파라미터**:
```typescript
{
  id: string           // 판례 ID
}
```

**응답 형식**:
```
=== 판례명 ===

📋 Basic Information:
  Case Number: 사건번호
  Court: 법원명
  Date: YYYYMMDD
  Case Type: 형사/민사
  Judgment Type: 판결/결정

📌 Holdings (판시사항):
판시사항 내용...

📖 Summary (판결요지):
판결요지 내용...

⚖️ Decision (주문):
주문 내용...

📝 Full Text:
전문 내용...
```

**예제**:
```javascript
{
  "id": "609561"
}
```

---

### 16. get_interpretation_text

**기능**: 법령해석례 전문 조회

**파라미터**:
```typescript
{
  id: string           // 해석례 ID
}
```

**응답 형식**:
```
=== 해석례 제목 ===

📋 기본 정보:
  해석례번호: XX-XXXX
  회신일자: YYYYMMDD
  질의기관: 기관명
  해석기관: 법제처

📌 질의요지:
질의 내용...

💡 회답:
회답 내용...
```

**예제**:
```javascript
{
  "id": "333393"
}
```

---

### 17. get_batch_articles

**기능**: 여러 조문 일괄 조회

**파라미터**:
```typescript
{
  mst?: string         // 법령일련번호 (mst 또는 lawId 중 하나 필수)
  lawId?: string       // 법령ID
  articles: string[]   // 조문번호 배열
}
```

**응답 형식**:
```
법령명: XXX법
조회 조문: 제XX조, 제YY조, 제ZZ조

제XX조 조문제목
제XX조(조문제목)
① ...

제YY조 조문제목
제YY조(조문제목)
① ...
```

**예제**:
```javascript
{
  "mst": "279811",
  "articles": ["제38조", "제39조", "제40조"]
}
```

**특징**:
- 1번의 API 호출로 여러 조문 조회
- 성능 최적화

---

### 18. get_article_with_precedents

**기능**: 조문 + 관련 판례 통합 조회

**파라미터**:
```typescript
{
  mst?: string           // 법령일련번호
  lawId?: string         // 법령ID
  jo: string             // 조문번호
  includePrecedents?: boolean  // 판례 포함 여부 (기본값: true)
}
```

**응답 형식**:
```
법령명: XXX법
공포일: YYYYMMDD
시행일: YYYYMMDD

제XX조 조문제목
제XX조(조문제목)
① ...

━━━━━━━━━━━━━━━━━━━━━━
관련 판례 (총 X건)
━━━━━━━━━━━━━━━━━━━━━━

[XXXXXX] 판례명
  사건번호: ...
  법원: ...
  선고일: ...
```

**예제**:
```javascript
{
  "mst": "276787",
  "jo": "제74조",
  "includePrecedents": true
}
```

---

### 19. compare_old_new

**기능**: 신구법 대조 (개정 전후 비교)

**파라미터**:
```typescript
{
  mst?: string         // 법령일련번호
  lawId?: string       // 법령ID
}
```

**응답 형식**:
```
법령명: XXX법

━━━━━━━━━━━━━━━━━━━━━━
신구법 대조
━━━━━━━━━━━━━━━━━━━━━━

현행                          개정안
━━━━━━━━━━━━━━━━━━━━━━
제XX조(조문제목)              제XX조(조문제목)
① 내용...                     ① 내용...
                              [신설] ② 새로운 내용...
━━━━━━━━━━━━━━━━━━━━━━

제YY조 삭제                   <신설>
```

**예제**:
```javascript
{
  "mst": "279811"
}
```

---

### 20. get_three_tier

**기능**: 3단 비교 (법률 → 시행령 → 시행규칙 위임 관계)

**파라미터**:
```typescript
{
  mst?: string         // 법령일련번호
  lawId?: string       // 법령ID
  knd: string          // 비교 유형 (1: 위임조문, 2: 인용조문)
}
```

**응답 형식**:
```
법령명: XXX법

━━━━━━━━━━━━━━━━━━━━━━
제XX조 조문제목
━━━━━━━━━━━━━━━━━━━━━━

📜 시행령 시행령명 제YY조 (조문제목)
   ① 시행령 내용...

   📜 시행규칙 시행규칙명 제ZZ조 (조문제목)
      ① 시행규칙 내용...
```

**예제**:
```javascript
{
  "mst": "279811",
  "knd": "1"  // 위임조문
}
```

---

## 분석 도구 (9개)

### 21. compare_articles

**기능**: 두 법령의 특정 조문 비교

**파라미터**:
```typescript
{
  law1: {
    mst?: string       // 첫 번째 법령 일련번호
    lawId?: string     // 또는 법령ID
    jo: string         // 조문번호
  },
  law2: {
    mst?: string       // 두 번째 법령 일련번호
    lawId?: string     // 또는 법령ID
    jo: string         // 조문번호
  }
}
```

**응답 형식**:
```
=== 조문 비교 ===

📋 법령명: 첫 번째 법령
------------------------------------------------------------
제XX조 (조문제목)
① ...

📋 법령명: 두 번째 법령
------------------------------------------------------------
제YY조 (조문제목)
① ...
```

**예제**:
```javascript
{
  "law1": {
    "lawId": "근로기준법",
    "jo": "제74조"
  },
  "law2": {
    "lawId": "파견근로자보호 등에 관한 법률",
    "jo": "제18조"
  }
}
```

---

### 22. get_law_tree

**기능**: 법령 계층 구조 시각화 (법률 → 시행령 → 시행규칙)

**파라미터**:
```typescript
{
  mst?: string         // 법령일련번호
  lawId?: string       // 법령ID
}
```

**응답 형식**:
```
=== 법령 트리 구조 ===

📜 법률 법률명
  ├─ 💼 시행령 시행령명
  │   └─ 📋 시행규칙 시행규칙명
  └─ 💼 다른 시행령

💡 상세한 위임 관계는 get_three_tier Tool을 사용하세요.
```

**예제**:
```javascript
{
  "lawId": "관세법"
}
```

---

### 23. get_article_history

**기능**: 특정 조문의 개정 연혁 추적

**파라미터**:
```typescript
{
  lawId: string        // 법령ID
  jo: string           // 조문번호
}
```

**응답 형식**:
```
법령명: XXX법
조문: 제XX조

조문 연혁:

[20YY.MM.DD] 개정 유형
변경 내용 요약...

[20YY.MM.DD] 개정 유형
변경 내용 요약...
```

**예제**:
```javascript
{
  "lawId": "근로기준법",
  "jo": "제74조"
}
```

---

### 24. summarize_precedent

**기능**: 판례 요약 (판시사항, 판결요지, 주문 추출)

**파라미터**:
```typescript
{
  id: string           // 판례 ID
}
```

**응답 형식**:
```
=== 판례 요약 ===

사건번호: XXXX
법원: XX법원
선고일: YYYY.MM.DD

📌 판시사항:
판시사항 요약 (최대 500자)...

📖 판결요지:
판결요지 요약 (최대 500자)...

⚖️ 주문:
주문 내용 (최대 200자)...
```

**예제**:
```javascript
{
  "id": "609561"
}
```

**특징**:
- 구조화된 섹션 자동 추출
- 길이 제한으로 가독성 확보

---

### 25. extract_precedent_keywords

**기능**: 판례에서 주요 키워드 추출

**파라미터**:
```typescript
{
  id: string           // 판례 ID
  maxKeywords?: number // 최대 키워드 수 (기본값: 10)
}
```

**응답 형식**:
```
=== 판례 키워드 추출 ===

사건: 사건명
법원: XX법원

주요 키워드 (빈도순):
1. 키워드1 (빈도: X회)
2. 키워드2 (빈도: Y회)
...
```

**예제**:
```javascript
{
  "id": "609561",
  "maxKeywords": 10
}
```

**특징**:
- 법률 용어 우선 추출 (법, 권, 의무, 책임 등)
- 조문 참조 자동 추출 (제X조)

---

### 26. find_similar_precedents

**기능**: 유사 판례 검색 (키워드 기반 유사도)

**파라미터**:
```typescript
{
  query?: string       // 검색 쿼리 (query 또는 precedentId 중 하나 필수)
  precedentId?: string // 기준 판례 ID
  maxResults?: number  // 최대 결과 수 (기본값: 5)
}
```

**응답 형식**:
```
=== 유사 판례 검색 ===

기준: 검색어 또는 기준 판례

유사 판례 (유사도순):

1. [XXXXXX] 판례명
   유사도: XX%
   사건번호: ...
   법원: ...
   선고일: ...

2. ...
```

**예제**:
```javascript
// 검색어 기반
{
  "query": "근로기준법 제74조 임신 근로자",
  "maxResults": 5
}

// 판례 기반
{
  "precedentId": "609561",
  "maxResults": 5
}
```

**특징**:
- 키워드 빈도 기반 유사도 계산
- 향후 벡터 임베딩 적용 가능

---

### 27. get_law_statistics

**기능**: 법령 통계 (최근 개정, 부처별, 연도별)

**파라미터**:
```typescript
{
  type: "recent_changes" | "by_department" | "by_year"  // 통계 유형
  days?: number          // 최근 N일 (recent_changes 시, 기본값: 30)
}
```

**응답 형식**:
```
=== 법령 통계 ===

[type="recent_changes"]
최근 X일간 개정된 법령 (총 Y건):
1. 법령명 (개정일: YYYY.MM.DD)
2. ...

[type="by_department"]
소관부처별 법령 수:
- 기획재정부: X건
- 법무부: Y건
...

[type="by_year"]
연도별 제정 법령 수:
- 2024년: X건
- 2023년: Y건
...
```

**예제**:
```javascript
{
  "type": "recent_changes",
  "days": 7
}
```

---

### 28. parse_article_links

**기능**: 조문 내 참조 파싱 ("제X조", "같은 조", "전항" 등)

**파라미터**:
```typescript
{
  mst?: string         // 법령일련번호
  lawId?: string       // 법령ID
  jo: string           // 조문번호
}
```

**응답 형식**:
```
=== 조문 참조 분석 ===

법령: XXX법
조문: 제XX조

참조 조문 (총 X개):

1. "제YY조" → 제YY조로 링크
   컨텍스트: ...앞뒤 30자...

2. "같은 조 제Z항" → 제XX조 제Z항
   컨텍스트: ...

3. "전항" → 제XX조 제(현재항-1)항
   컨텍스트: ...
```

**예제**:
```javascript
{
  "lawId": "관세법",
  "jo": "제38조"
}
```

**특징**:
- 다양한 참조 패턴 인식 (제X조, 같은 조, 전항, 다음 각 호, 이 법 등)
- 컨텍스트 제공 (앞뒤 30자)

---

### 29. get_external_links

**기능**: 외부 링크 생성 (법제처, 법원도서관 등)

**파라미터**:
```typescript
{
  type: "law" | "precedent" | "interpretation" | "ordinance" | "admin_rule"
  name?: string        // 법령명/판례명 (선택)
  id?: string          // ID (선택)
  jo?: string          // 조문번호 (law 타입에서 선택)
}
```

**응답 형식**:
```
=== 외부 링크 ===

🔗 법제처 국가법령정보센터:
   https://www.law.go.kr/법령/법령명

🔗 법원 종합법률정보:
   https://glaw.scourt.go.kr/...

🔗 자치법규정보시스템 (ELIS):
   https://www.elis.go.kr/...
```

**예제**:
```javascript
{
  "type": "law",
  "name": "근로기준법",
  "jo": "제74조"
}
```

---

## 전문 도구 (4개)

⭐ **v1.4.0 신규 추가**

### 30. search_tax_tribunal_decisions

**기능**: 조세심판원 재결례 검색

**파라미터**:
```typescript
{
  query: string        // 검색 키워드
  maxResults?: number  // 최대 결과 수 (기본값: 10, 최대: 20)
}
```

**응답 형식**:
```
조세심판원 재결례 검색 결과 (총 X건):

1. 재결 제목
   - 결정번호: XXXX-XXXX
   - 결정일: YYYY-MM-DD
   - 심판청구인: XXX
   - 처분청: XXX세무서
```

**예제**:
```javascript
{
  "query": "부가가치세"
}

// 출력
조세심판원 재결례 검색 결과 (총 5건):

1. 부가가치세 과세표준 산정 관련
   - 결정번호: 2024-0123
   - 결정일: 2024-03-15
   - 심판청구인: 주식회사 ABC
   - 처분청: 서울지방국세청
```

**특징**:
- 조세 관련 재결 사례 검색
- 결정번호로 정확한 재결 검색 가능
- 처분청, 심판청구인 정보 제공

---

### 31. get_tax_tribunal_decision

**기능**: 조세심판원 재결례 전문 조회

**파라미터**:
```typescript
{
  decisionNumber: string  // 결정번호 (예: "2024-0123")
}
```

**응답 형식**:
```
📋 조세심판원 재결례

결정번호: XXXX-XXXX
결정일: YYYY-MM-DD
심판청구인: XXX
처분청: XXX

【주문】
...

【이유】
...
```

**예제**:
```javascript
{
  "decisionNumber": "2024-0123"
}

// 출력
📋 조세심판원 재결례

결정번호: 2024-0123
결정일: 2024-03-15
심판청구인: 주식회사 ABC
처분청: 서울지방국세청

【주문】
청구인의 심판청구를 기각한다.

【이유】
1. 처분개요
...
```

**특징**:
- 재결 전문 내용 제공
- 주문 및 이유 구분 표시
- 처분 개요 및 판단 근거 제공

---

### 32. search_customs_interpretations

**기능**: 관세청 법령해석 검색

**파라미터**:
```typescript
{
  query: string        // 검색 키워드
  maxResults?: number  // 최대 결과 수 (기본값: 10, 최대: 20)
}
```

**응답 형식**:
```
관세청 법령해석 검색 결과 (총 X건):

1. 해석 제목
   - 해석번호: 관세-XXXX-XXXX
   - 해석일: YYYY-MM-DD
   - 관련 법령: 관세법 제XX조
   - 질의기관: XXX
```

**예제**:
```javascript
{
  "query": "원산지 표시"
}

// 출력
관세청 법령해석 검색 결과 (총 3건):

1. 원산지 표시 방법에 관한 해석
   - 해석번호: 관세-2024-0056
   - 해석일: 2024-02-10
   - 관련 법령: 관세법 제232조
   - 질의기관: 한국무역협회
```

**특징**:
- 관세 관련 법령해석 검색
- 해석번호로 정확한 해석 검색 가능
- 관련 법령 조문 정보 제공

---

### 33. get_customs_interpretation

**기능**: 관세청 법령해석 전문 조회

**파라미터**:
```typescript
{
  interpretationNumber: string  // 해석번호 (예: "관세-2024-0056")
}
```

**응답 형식**:
```
📋 관세청 법령해석

해석번호: 관세-XXXX-XXXX
해석일: YYYY-MM-DD
관련 법령: 관세법 제XX조
질의기관: XXX

【질의요지】
...

【회답】
...
```

**예제**:
```javascript
{
  "interpretationNumber": "관세-2024-0056"
}

// 출력
📋 관세청 법령해석

해석번호: 관세-2024-0056
해석일: 2024-02-10
관련 법령: 관세법 제232조
질의기관: 한국무역협회

【질의요지】
원산지 표시 방법에 대한 질의

【회답】
관세법 제232조에 따르면...
```

**특징**:
- 해석 전문 내용 제공
- 질의요지 및 회답 구분 표시
- 관련 법령 조문 정보 포함

---

## 공통 사항

### 에러 응답

모든 도구는 에러 발생 시 다음 형식으로 응답합니다:

```json
{
  "content": [{
    "type": "text",
    "text": "❌ 에러 메시지\n\n💡 해결 방법: ..."
  }],
  "isError": true
}
```

### ID 형식

| 유형 | ID 이름 | 형식 | 예시 |
|------|---------|------|------|
| 법령 | mst (법령일련번호) | 6자리 숫자 | 279811 |
| 법령 | lawId (법령ID) | 6자리 숫자 | 001556 |
| 행정규칙 | id (행정규칙일련번호) | 13자리 숫자 | 2100000261222 |
| 행정규칙 | 행정규칙ID | 5자리 숫자 | 88661 |
| 자치법규 | ordinSeq (자치법규일련번호) | 7자리 숫자 | 1526175 |
| 판례 | id (판례 ID) | 6자리 숫자 | 609561 |
| 해석례 | id (해석례 ID) | 6자리 숫자 | 333393 |

### JO 코드 형식

조문번호는 6자리 코드로 표현됩니다:

```
AAAABB
└┬┘└┬┘
 │  └─ 지조 번호 (00 ~ 99)
 └──── 조 번호 (0001 ~ 9999)
```

**예시**:
- 제5조 → `000500`
- 제38조 → `003800`
- 제10조의2 → `001002`
- 제156조의23 → `015623`

### 캐싱

다음 도구들은 캐싱을 지원합니다:

| 도구 | TTL | 캐시 키 패턴 |
|------|-----|-------------|
| `search_law` | 1시간 | `search:{query}:{maxResults}` |
| `search_admin_rule` | 1시간 | `admrul_search:{query}:{maxResults}` |
| `search_ordinance` | 1시간 | `ordinance_search:{query}:{display}` |
| `get_law_text` | 24시간 | `lawtext:{mst}:{jo}:{efYd}` |

### 응답 크기 제한

- 조문 내용: 최대 5,000자
- 판례 전문: 최대 10,000자
- 검색 결과: 최대 100건

---

**관련 문서**:
- [README.md](../README.md) - 시작 가이드
- [ARCHITECTURE.md](ARCHITECTURE.md) - 시스템 아키텍처
- [DEVELOPMENT.md](DEVELOPMENT.md) - 개발자 가이드
