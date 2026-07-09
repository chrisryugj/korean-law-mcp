# 커밋 + 푸시 + 통합 호스트 배포

⚠️ 2026-07-02부터 프로덕션은 [gomdori-mcp](https://github.com/chrisryugj/gomdori-mcp) 통합 호스트(fly 앱 `korean-law-mcp`, MCP 5종 동거)가 서빙합니다.
**이 레포에서 `fly deploy`를 직접 실행하면 통합 이미지가 law 단독 이미지로 덮여 stats·patent·archhub·school까지 전부 죽습니다. 절대 금지.**

## 실행할 작업

### 1단계: 커밋 & 푸시
1. `git status` / `git diff`로 변경 확인
2. `git log -3 --oneline`로 커밋 스타일 확인
3. `git add` (단, `.claude/memory/`는 제외) → 한글 prefix 커밋(feat/fix/refactor/docs/chore) → `git push`

### 2단계: npm 릴리스
4. `npm run build`로 빌드 확인 (실패 시 중단)
5. `npm version patch|minor` → `npm publish` → `git push --follow-tags`

### 3단계: 통합 호스트 반영
6. `~/workspace/gomdori-mcp/Dockerfile`의 `korean-law-mcp@X.Y.Z` 핀을 새 버전으로 갱신
7. gomdori-mcp 레포 커밋·푸시
8. `cd ~/workspace/gomdori-mcp && fly deploy -c fly.production.toml`
9. 검증: `curl https://mcp.gomdori.app/healthz` (5개 서비스 up) + `/law` initialize 응답에 새 버전 확인

## 배포 환경
- 통합 호스트: fly 앱 `korean-law-mcp` (nrt, 512MB+swap) — [gomdori-mcp/fly.production.toml](https://github.com/chrisryugj/gomdori-mcp)
- 공식 URL: `https://mcp.gomdori.app/law` (구 `https://korean-law-mcp.fly.dev/mcp` 하위호환 유지)
- 롤백: `fly releases -a korean-law-mcp` → `fly deploy -a korean-law-mcp -i <직전 이미지>`
