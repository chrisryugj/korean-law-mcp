# Korean Law MCP - API Reference

> **v1.6.0** | 58개 도구

도구 목록은 [README.md](../README.md#-available-tools-58-total) 참조.
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

**자치법규**는 `AABBCC` 형식:
- `AA`: 조 번호 (01~99)
- `BB`: 의X (00~99)
- `CC`: 서브 (00~99)

### 에러 응답

```json
{
  "content": [{ "type": "text", "text": "❌ 에러 메시지\n\n💡 해결 방법: ..." }],
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
| `search_all` | - | 통합 검색 |
| `suggest_law_names` | - | 법령명 자동완성 |
| `parse_jo_code` | - | 조문번호 ↔ 코드 변환 |
| `get_law_history` | - | 특정일 법령 변경 목록 |
| `advanced_search` | - | 기간/AND/OR 검색 |
| `get_annexes` | - | 별표/서식 조회 |

### 조회 (9개)

| 도구 | 설명 |
|------|------|
| `get_law_text` | 법령 조문 전문 |
| `get_admin_rule` | 행정규칙 전문 |
| `get_ordinance` | 자치법규 전문 |
| `get_precedent_text` | 판례 전문 |
| `get_interpretation_text` | 해석례 전문 |
| `get_batch_articles` | 여러 조문 일괄 조회 |
| `get_article_with_precedents` | 조문 + 관련 판례 |
| `compare_old_new` | 신구법 대조 |
| `get_three_tier` | 법률→시행령→시행규칙 |

### 분석 (9개)

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

### 전문 (4개)

| 도구 | 설명 |
|------|------|
| `search_tax_tribunal_decisions` | 조세심판원 재결례 검색 |
| `get_tax_tribunal_decision` | 조세심판원 재결례 전문 |
| `search_customs_interpretations` | 관세청 법령해석 검색 |
| `get_customs_interpretation` | 관세청 법령해석 전문 |

### v1.5.0 추가 (17개)

| 도구 | 설명 |
|------|------|
| `search_constitutional_decisions` | 헌재 결정례 검색 |
| `get_constitutional_decision_text` | 헌재 결정례 전문 |
| `search_admin_appeals` | 행정심판례 검색 |
| `get_admin_appeal_text` | 행정심판례 전문 |
| `search_english_law` | 영문법령 검색 |
| `get_english_law_text` | 영문법령 조문 |
| `search_legal_terms` | 법령용어 검색 |
| `search_ftc_decisions` | 공정위 결정문 검색 |
| `get_ftc_decision_text` | 공정위 결정문 전문 |
| `search_pipc_decisions` | 개보위 결정문 검색 |
| `get_pipc_decision_text` | 개보위 결정문 전문 |
| `search_nlrc_decisions` | 노동위 결정문 검색 |
| `get_nlrc_decision_text` | 노동위 결정문 전문 |
| `get_historical_law` | 연혁법령 조회 |
| `search_historical_law` | 연혁법령 목록 |
| `get_law_system_tree` | 법령체계도 |

### v1.6.0 추가 (8개)

| 도구 | 설명 |
|------|------|
| `search_ai_law` | AI 지능형 법령검색 (자연어) |
| `get_legal_term_kb` | 법령용어 지식베이스 |
| `get_legal_term_detail` | 법령용어 상세 정의 |
| `get_daily_term` | 일상용어 검색 |
| `get_daily_to_legal` | 일상용어→법령용어 |
| `get_legal_to_daily` | 법령용어→일상용어 |
| `get_term_articles` | 용어→조문 연계 |
| `get_related_laws` | 관련법령 조회 |

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

---

## 관련 문서

- [README.md](../README.md) - 시작 가이드
- [ARCHITECTURE.md](ARCHITECTURE.md) - 시스템 아키텍처
- [DEVELOPMENT.md](DEVELOPMENT.md) - 개발자 가이드
