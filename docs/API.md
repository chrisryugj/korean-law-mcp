# Korean Law MCP - API Reference

> **v3.0.1** | 14개 노출 도구 (내부 91개, 77개는 execute_tool로 접근)

도구 구조는 [README.md](../README.md#도구-구조-14개) 참조.
상세 파라미터는 각 도구의 Zod 스키마(`src/tools/*.ts`) 참조.

---

## 공통 사항

### ID 형식

| 유형 | 필드명 | 형식 | 예시 |
|------|--------|------|------|
| 법령 | `mst` | 6자리 | `279811` |
| 법령 | `lawId` | 6자리 | `001556` |
| 행정규칙 | `id` | 13자리 | `2100000261222` |
| 자치법규 | `ordinSeq` | 7자리 | `1526175` |
| 판례 | `id` | 6자리 | `609561` |
| 해석례 | `id` | 6자리 | `333393` |

### JO 코드 (조문번호)

6자리 코드 `AAAABB`:
- `AAAA`: 조 번호 (0001~9999)
- `BB`: 의X 번호 (00~99)

```
제5조    → 000500
제38조   → 003800
제10조의2 → 001002
```

**자치법규**도 동일한 `AAAABB` 형식 사용 (API 응답 확인):
- `get_ordinance`의 `jo` 파라미터에 한글(`"제20조"`) 입력 시 자동 변환
- 참고: `buildOrdinanceJO`(AABBCC)는 JO 코드 유틸리티용으로만 존재

### 에러 응답

```json
{
  "content": [{ "type": "text", "text": "[에러코드] 도구명: 에러 메시지\n\n💡 해결 방법: ..." }],
  "isError": true
}
```

### 캐싱

| 유형 | TTL |
|------|-----|
| 검색 결과 | 1시간 |
| 법령 전문 | 24시간 |

### 응답 크기 제한

| 유형 | 제한 |
|------|------|
| 조문 내용 | 5,000자 |
| 판례 전문 | 10,000자 |
| 검색 결과 | 100건 |

---

## 도구 카테고리

### 검색 (11개)

| 도구 | target | 설명 |
|------|--------|------|
| `search_law` | `law` | 법령명 검색 (약칭 자동 인식) |
| `search_admin_rule` | `admrul` | 훈령/예규/고시/공고 |
| `search_ordinance` | `ordin` | 조례/규칙 |
| `search_precedents` | `prec` | 판례 |
| `search_interpretations` | `expc` | 법령해석례 |
| `search_all` | - | 통합 검색 (법령+행정규칙+자치법규) |
| `suggest_law_names` | - | 법령명 자동완성 |
| `parse_jo_code` | - | 조문번호 ↔ 코드 변환 |
| `get_law_history` | - | 특정일 법령 변경 목록 |
| `advanced_search` | - | 기간/AND/OR 검색 |
| `get_annexes` | - | 별표/서식 조회 + HWPX/HWP 본문 추출 |

### 조회 (9개)

| 도구 | 설명 |
|------|------|
| `get_law_text` | 법령 조문 전문 |
| `get_admin_rule` | 행정규칙 전문 |
| `get_ordinance` | 자치법규 전문 (`jo`로 특정 조문 조회 가능) |
| `get_precedent_text` | 판례 전문 |
| `get_interpretation_text` | 해석례 전문 |
| `get_batch_articles` | 여러 조문 일괄 조회 (`laws` 배열로 복수 법령 지원) |
| `get_article_with_precedents` | 조문 + 관련 판례 |
| `compare_old_new` | 신구법 대조 |
| `get_three_tier` | 법률→시행령→시행규칙 |

### 분석 (10개)

| 도구 | 설명 |
|------|------|
| `compare_articles` | 두 조문 비교 |
| `get_law_tree` | 법령 계층 구조 |
| `get_article_history` | 조문 개정 연혁 |
| `summarize_precedent` | 판례 요약 |
| `extract_precedent_keywords` | 판례 키워드 추출 |
| `find_similar_precedents` | 유사 판례 검색 |
| `get_law_statistics` | 법령 통계 |
| `parse_article_links` | 조문 내 참조 파싱 |
| `get_external_links` | 외부 링크 생성 |
| `analyze_document` | 문서 유형 분류 + 리스크 탐지 |

### 전문 (4개)

| 도구 | 설명 |
|------|------|
| `search_tax_tribunal_decisions` | 조세심판원 재결례 검색 |
| `get_tax_tribunal_decision_text` | 조세심판원 재결례 전문 |
| `search_customs_interpretations` | 관세청 법령해석 검색 |
| `get_customs_interpretation_text` | 관세청 법령해석 전문 |

### 헌재·행심·위원회·감사원 (8개)

| 도구 | 설명 |
|------|------|
| `search_constitutional_decisions` | 헌재 결정례 검색 |
| `get_constitutional_decision_text` | 헌재 결정례 전문 |
| `search_admin_appeals` | 행정심판례 검색 |
| `get_admin_appeal_text` | 행정심판례 전문 |
| `search_ftc_decisions` / `search_nlrc_decisions` / `search_pipc_decisions` | 공정위/노동위/개보위 결정 검색 |
| `get_ftc_decision_text` / `get_nlrc_decision_text` / `get_pipc_decision_text` | 결정 전문 |
| `search_acr_decisions` / `get_acr_decision_text` | 감사원 결정 검색/조회 |

### 지식베이스 (7개)

| 도구 | 설명 |
|------|------|
| `get_legal_term_kb` | 법령용어 지식베이스 검색 |
| `get_legal_term_detail` | 법령용어 상세 정의 |
| `get_daily_term` | 일상용어 검색 |
| `get_daily_to_legal` | 일상용어→법령용어 |
| `get_legal_to_daily` | 법령용어→일상용어 |
| `get_term_articles` | 용어→조문 연계 |
| `get_related_laws` | 관련법령 조회 |

### 기타 (6개)

| 도구 | 설명 |
|------|------|
| `search_ai_law` | AI 지능형 법령검색 (자연어, `lawTypes` 필터) |
| `search_english_law` / `get_english_law_text` | 영문법령 검색/조회 |
| `search_historical_law` / `get_historical_law` | 연혁법령 검색/조회 |
| `search_legal_terms` | 법령용어 사전 검색 |
| `get_law_system_tree` | 법령체계도 |
| `get_law_abbreviations` | 법령 약칭 목록 조회 |
| `compare_admin_rule_old_new` | 행정규칙 신구대조 |

### 법령-자치법규 연계 (4개)

| 도구 | 설명 |
|------|------|
| `get_linked_ordinances` | 법령에 연계된 자치법규 검색 |
| `get_linked_ordinance_articles` | 연계 자치법규 조문 조회 |
| `get_delegated_laws` | 위임 법령 조회 |
| `get_linked_laws_from_ordinance` | 자치법규에서 상위법령 조회 |

### 조약 (2개)

| 도구 | 설명 |
|------|------|
| `search_treaties` | 조약 검색 |
| `get_treaty_text` | 조약 전문 조회 |

### 학칙·공단·공공기관 (6개)

| 도구 | 설명 |
|------|------|
| `search_school_rules` / `get_school_rule_text` | 학칙 검색/조회 |
| `search_public_corp_rules` / `get_public_corp_rule_text` | 공단 규정 검색/조회 |
| `search_public_institution_rules` / `get_public_institution_rule_text` | 공공기관 규정 검색/조회 |

### 특별행정심판 (4개)

| 도구 | 설명 |
|------|------|
| `search_acr_special_appeals` | 감사원 특별행정심판 검색 |
| `get_acr_special_appeal_text` | 감사원 특별행정심판 전문 |
| `search_appeal_review_decisions` | 소청심사 검색 |
| `get_appeal_review_decision_text` | 소청심사 전문 |

### 체인 도구 (8개)

여러 도구를 자동 조합하여 복합 리서치를 한 번에 수행.

| 도구 | 설명 |
|------|------|
| `chain_law_system` | 법체계 파악 (법령검색→3단비교→조문 일괄) |
| `chain_action_basis` | 처분/허가 근거 확인 (법체계→해석례→판례→행심) |
| `chain_dispute_prep` | 불복/쟁송 대비 (판례+행심+전문결정례 병렬) |
| `chain_amendment_track` | 개정 추적 (신구대조+조문이력) |
| `chain_ordinance_compare` | 조례 비교 연구 (상위법→전국 조례 검색) |
| `chain_full_research` | 종합 리서치 (AI검색→법령→판례→해석) |
| `chain_procedure_detail` | 절차/비용/서식 (법체계→별표→시행규칙별표) |
| `chain_document_review` | 문서 리뷰 (문서분석→관련법령→판례) |

---

## 워크플로우 예시

### 법령 조회

```
1. search_law(query="근로기준법")
   → mst: 276787 획득

2. get_law_text(mst="276787", jo="제74조")
   → 조문 내용 조회
```

### 조문 비교

```
1. search_law(query="근로기준법") → mst1
2. search_law(query="파견법") → mst2
3. compare_articles(law1={mst: mst1, jo:"74조"}, law2={mst: mst2, jo:"18조"})
```

### AI 검색 → 상세 조회

```
1. search_ai_law(query="음주운전 처벌")
   → 도로교통법 제148조의2 발견

2. get_law_text(lawId="도로교통법", jo="제148조의2")
```

### 별표 본문 추출

```
1. get_annexes(lawName="여권법 시행령")
   → 별표 목록 + bylSeq 획득

2. get_annexes(lawName="여권법 시행령", bylSeq="000000")
   → HWP 파일 다운로드 → 표 Markdown 변환
```

### 체인 도구 (종합 리서치)

```
1. chain_full_research(query="음주운전 처벌")
   → AI검색 → 법령조문 → 판례 → 해석례 자동 수행
```

---

## 관련 문서

- [README.md](../README.md) - 시작 가이드
- [ARCHITECTURE.md](ARCHITECTURE.md) - 시스템 아키텍처
- [DEVELOPMENT.md](DEVELOPMENT.md) - 개발자 가이드
