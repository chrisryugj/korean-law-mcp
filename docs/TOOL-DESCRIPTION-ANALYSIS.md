# MCP 도구 설명 분석 및 최적화 제안

> **분석 일자**: 2025-12-23
> **대상 버전**: v1.5.0 (51개 도구)
> **분석 목적**: 컨텍스트 토큰 효율화 vs MCP 툴 콜링 성능 밸런스

---

## 1. 현황 분석

### 1.1 토큰 사용량 측정

| 항목 | 측정값 |
|------|--------|
| 총 도구 수 | 51개 |
| 평균 description 길이 | ~350-600 토큰/도구 |
| 평균 inputSchema 길이 | ~100-200 토큰/도구 |
| **전체 도구 정의 예상 토큰** | **~25,000-40,000 토큰** |

> 💡 MCP 프로토콜에서 `ListTools` 호출 시 모든 도구 정의가 LLM 컨텍스트에 로드됨

### 1.2 도구 설명 패턴 분석

#### 현재 description 구조 (search_law 예시)
```
[STEP 1] 법령 검색 - 법령명으로 lawId와 mst를 획득합니다.

사용 시점:
- 사용자가 법령명/약칭 언급 시 (예: "관세법", "화관법")
- 조문 조회 전 반드시 실행 (get_law_text에 필요한 lawId, mst 획득)

특징:
- 약칭 자동 변환 (화관법 → 화학물질관리법)
- 결과에서 lawId, mst 추출 → get_law_text에 전달 필수

워크플로우:
1. search_law로 법령 검색
2. 결과에서 lawId, mst 저장
3. get_law_text(lawId="...", mst="...", jo="제X조")로 조문 조회
...
```

**문제점**:
1. **과도한 장황함**: 평균 300-600 토큰/도구
2. **반복되는 섹션**: 워크플로우, 예시, 관련 도구 등 모든 도구에서 유사 패턴 반복
3. **apiKey 설명 중복**: 51개 도구 모두에서 동일한 API 키 설명 반복

---

## 2. 발견된 문제점

### 2.1 토큰 낭비 요인

| 문제 | 영향 | 예상 토큰 낭비 |
|------|------|---------------|
| apiKey 파라미터 설명 중복 | 51개 도구 × 50토큰 | ~2,550 토큰 |
| 워크플로우 섹션 중복 | 30개 도구 × 80토큰 | ~2,400 토큰 |
| "관련 도구" 섹션 중복 | 25개 도구 × 60토큰 | ~1,500 토큰 |
| 장황한 예시 | 40개 도구 × 50토큰 | ~2,000 토큰 |
| **합계** | | **~8,450 토큰** |

### 2.2 일관성 문제

```typescript
// precedents.ts - 영어 설명
query: z.string().optional().describe("Search keyword (e.g., '자동차', '담보권')"),

// search.ts - 한글 설명
query: z.string().describe("검색할 법령명 (예: '관세법', 'fta특례법', '화관법')"),
```

- **언어 혼용**: 일부 영어, 일부 한글
- **설명 스타일 불일치**: 일부는 상세, 일부는 간략

### 2.3 구조적 문제

1. **51개 도구 평면 나열**: 그룹화 없이 나열되어 LLM이 관련 도구 파악 어려움
2. **도구 간 관계 설명 반복**: 각 도구에서 관련 도구 설명 → 중복
3. **워크플로우 분산**: 동일 워크플로우가 여러 도구에서 반복 설명

---

## 3. 최적화 제안

### 3.1 도구 설명 간소화 전략

#### Before (현재)
```typescript
description: `[STEP 1] 법령 검색 - 법령명으로 lawId와 mst를 획득합니다.

사용 시점:
- 사용자가 법령명/약칭 언급 시
- 조문 조회 전 반드시 실행

특징:
- 약칭 자동 변환
- 결과에서 lawId, mst 추출

워크플로우:
1. search_law로 법령 검색
2. 결과에서 lawId, mst 저장
3. get_law_text로 조문 조회
...`
```

#### After (권장)
```typescript
description: `법령 검색 → lawId, mst 획득. 약칭 자동 변환 지원 (화관법→화학물질관리법). 조문 조회(get_law_text) 전 반드시 실행.`
```

**토큰 감소**: ~400 → ~50 토큰 (**87.5% 감소**)

### 3.2 도구 그룹화 제안

```
법령 기본 (7개)
├─ search_law          # 법령 검색 (Entry point)
├─ get_law_text        # 법령 조문 조회
├─ get_batch_articles  # 다중 조문 일괄 조회
├─ get_law_tree        # 법령 계층 구조
├─ get_three_tier      # 3단비교 (법률→시행령→시행규칙)
├─ compare_old_new     # 신구법 대조
└─ compare_articles    # 조문 간 비교

행정규칙 (2개)
├─ search_admin_rule   # 행정규칙 검색
└─ get_admin_rule      # 행정규칙 조회

자치법규 (2개)
├─ search_ordinance    # 자치법규 검색
└─ get_ordinance       # 자치법규 조회

판례 (5개)
├─ search_precedents           # 판례 검색
├─ get_precedent_text          # 판례 전문
├─ summarize_precedent         # 판례 요약
├─ extract_precedent_keywords  # 키워드 추출
└─ find_similar_precedents     # 유사 판례

... (이하 생략)
```

### 3.3 inputSchema 최적화

#### Before
```typescript
{
  apiKey: {
    type: "string",
    description: "사용자 API 키 (https://open.law.go.kr 에서 발급, 없으면 서버 기본값 사용)"
  }
}
```

#### After (중복 제거)
- 공통 파라미터(apiKey)는 도구 설명 헤더에서 한 번만 언급
- 또는 MCP 서버 레벨 문서로 분리

### 3.4 권장 description 템플릿

```typescript
description: `[핵심 동작] [필수 선행/후속 도구] [특징/주의사항]`
```

**예시**:
```typescript
// search_law
description: `법령 검색→lawId,mst 획득. 약칭 자동변환. → get_law_text 전 필수`

// get_law_text
description: `조문 조회. mst/lawId 필수(search_law에서). jo 생략시 전문 반환`

// search_precedents
description: `판례 검색(키워드/법원/사건번호). → get_precedent_text로 전문 조회`
```

---

## 4. 구현 우선순위

| 우선순위 | 작업 | 예상 토큰 절감 | 난이도 |
|---------|------|---------------|--------|
| 🔴 P0 | description 간소화 | ~15,000-20,000 | 중 |
| 🟠 P1 | apiKey 설명 통합 | ~2,500 | 하 |
| 🟡 P2 | inputSchema 설명 축약 | ~3,000 | 하 |
| 🟢 P3 | 도구 그룹화 prefix 추가 | (구조 개선) | 중 |

### 예상 총 효과

| 항목 | 현재 | 최적화 후 | 감소율 |
|------|------|----------|--------|
| 전체 도구 정의 토큰 | ~30,000 | ~10,000 | **67%** |
| 평균 도구당 토큰 | ~600 | ~200 | **67%** |

---

## 5. 트레이드오프 분석

### 5.1 토큰 감소 vs 툴 콜링 정확도

| 전략 | 토큰 감소 | 정확도 영향 | 권장 |
|------|----------|------------|------|
| description 50% 축약 | ⭐⭐⭐ | 영향 적음 | ✅ |
| description 80% 축약 | ⭐⭐⭐⭐⭐ | 주의 필요 | ⚠️ |
| 워크플로우 완전 제거 | ⭐⭐ | 정확도 저하 | ❌ |
| 예시 완전 제거 | ⭐ | 정확도 저하 | ❌ |

### 5.2 권장 축약 수준

- **핵심 유지**: 도구 목적, 필수 파라미터, 선행/후속 도구
- **축약 가능**: 상세 워크플로우, 에러 처리 가이드, 대안 도구 목록
- **제거 가능**: 반복되는 API 키 설명, 장황한 예시

---

## 6. 참고: 최적화된 도구 정의 예시

### 간소화된 51개 도구 설명 샘플

```typescript
// 검색
search_law: "법령 검색→lawId,mst. 약칭 자동변환. →get_law_text"
search_admin_rule: "행정규칙 검색(훈령/예규/고시). →get_admin_rule"
search_ordinance: "자치법규 검색(조례/규칙). →get_ordinance"
search_all: "통합검색(법령+행정규칙+자치법규)"
search_precedents: "판례 검색. →get_precedent_text"
search_interpretations: "법령해석례 검색. →get_interpretation_text"

// 조회
get_law_text: "조문 조회. mst/lawId 필수. jo 생략시 전문"
get_admin_rule: "행정규칙 전문. id 필수"
get_ordinance: "자치법규 전문. ordinSeq 필수"
get_precedent_text: "판례 전문. id 필수"
get_interpretation_text: "법령해석례 전문. id 필수"

// 분석
compare_old_new: "신구법 대조. ld(공포일) 필수"
get_three_tier: "3단비교(법률→시행령→시행규칙). knd=1인용/2위임"
compare_articles: "두 법령 조문 비교"
get_law_tree: "법령 계층 구조 시각화"
```

---

## 7. 완료된 최적화 작업

1. [x] 도구 description 간소화 작업 (P0) - **완료**
2. [x] inputSchema 내 apiKey 설명 통합 (P1) - **완료** (45개 → "API 키" 3자)
3. [x] inputSchema 파라미터 설명 축약 (P2) - **완료**
4. [x] 도구 그룹화 prefix 추가 (P3) - **완료** ([법령], [판례], [헌재] 등 14개 카테고리)
5. [x] 최적화 전/후 토큰 사용량 비교 측정 - **완료**

### 최적화 결과

| 항목 | 최적화 전 | 최적화 후 | 감소율 |
|------|----------|----------|--------|
| 파일 크기 | 87,480 bytes | 53,096 bytes | **39.3%** |
| 줄 수 | 2,727줄 | 1,650줄 | **39.5%** |
| 추정 토큰 | ~29,160 | ~17,698 | **39.3%** |

### 추가 개선사항
- 도구 카테고리 prefix로 LLM의 도구 선택 정확도 향상
- 중복 설명 제거로 컨텍스트 효율성 극대화

---

*이 문서는 korean-law-mcp v1.5.1 기준으로 업데이트되었습니다.*
