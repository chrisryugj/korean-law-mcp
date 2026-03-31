# 다음 세션 프롬프트

## 세션 2: 호출 테스트 검증

```
korean-law-mcp v2.2 업그레이드 세션 2 — 호출 테스트.

커밋 88f94a5에서 65→88개 도구로 확장했어. 신규 23개 도구를 전수 호출 테스트해서 검증해줘.

테스트 대상 (신규 도구):
1. date-parser: "최근 3년 음주운전 판례" CLI 실행
2. analyze_document: 샘플 계약서 텍스트로 테스트
3. chain_document_review: 엔드투엔드
4. search_treaties / get_treaty_text
5. get_linked_ordinances / get_linked_ordinance_articles / get_delegated_laws / get_linked_laws_from_ordinance
6. get_article_detail (조항호목)
7. compare_admin_rule_old_new
8. get_law_abbreviations
9. search_school_rules / get_school_rule_text
10. search_public_corp_rules / get_public_corp_rule_text
11. search_public_institution_rules / get_public_institution_rule_text
12. search_acr_decisions / get_acr_decision_text
13. search_appeal_review_decisions / get_appeal_review_decision_text
14. search_acr_special_appeals / get_acr_special_appeal_text
15. precedents/interpretations 날짜 필터 테스트

방법: MCP 도구 직접 호출 또는 CLI로 테스트. 실패하는 건 즉시 수정.
끝나면 메모리 저장 + 세션 3 프롬프트 확인 + 커밋/푸시.
```

## 세션 3: 프로덕션 리뷰 + 배포

```
korean-law-mcp v2.2 업그레이드 세션 3 — 프로덕션 리뷰 + 배포.

세션 2에서 88개 도구 호출 테스트 완료. 이제 최종 마무리:

1. 코드 품질 리뷰
   - 보안 (API 키 노출, 입력 검증)
   - 에러 처리 (엣지 케이스)
   - 파일 크기 200줄 규칙 준수
   - risk-rules.ts 543줄 → 분리 필요 여부

2. 문서 업데이트
   - CLAUDE.md: 88개 도구 반영
   - README.md / README-KR.md: 신규 도구 카테고리 추가
   - docs/API.md: 신규 도구 레퍼런스

3. 버전 범프 + 배포
   - package.json → 2.2.0
   - npm publish
   - fly deploy (원격 서버)

끝나면 메모리 저장 + 커밋/푸시.
```
