# 커밋 + 푸시 + 통합 호스트 배포

⚠️ 2026-07-02부터 프로덕션은 [gomdori-mcp](https://github.com/chrisryugj/gomdori-mcp) 통합 호스트(fly 앱 `korean-law-mcp`, MCP 5종 동거)가 서빙합니다.
**이 레포에서 `fly deploy`를 직접 실행하면 통합 이미지가 law 단독 이미지로 덮여 stats·patent·archhub·school까지 전부 죽습니다. 절대 금지.**

> 절차의 정본은 이 레포 `CLAUDE.md` 상단 "반영 절차" 입니다. 아래는 그 실행판이며, 어긋나면 CLAUDE.md 가 이깁니다.

## 실행할 작업

### 1단계: 커밋 & 푸시
1. `git status` / `git diff`로 변경 확인
2. `git log -3 --oneline`로 커밋 스타일 확인
3. `git add` (단, `.claude/memory/`는 제외) → 한글 prefix 커밋(feat/fix/refactor/docs/chore) → `git push`

### 2단계: 게시 전 게이트 — 로컬에서 먼저 통과시킬 것
4. `npm test` → `npm run build` → `npm run verify:package` → **`npm audit --omit=dev`**
   - 이 넷이 `publish.yml` 의 게이트와 같다. **`npm audit --omit=dev` 는 새 권고가 공시되면 내 코드와 무관하게 터진다** — 실제로 v4.12.4 가 여기서 막혔다(fast-uri high 외 2건).
   - 취약점이 나오면 `npm audit fix` 후 `package.json` 이 안 바뀌는지(= semver 범위 내 lock 변경인지) 확인하고 테스트를 다시 돌린다.

### 3단계: npm 게시 — **로컬 `npm publish` 가 정규 경로**
5. `npm version patch|minor` → `git push --follow-tags`
6. `npm publish`
   - `.github/workflows/publish.yml`(Release → OIDC trusted publishing + provenance)은 **npm 쪽 trusted publisher 등록이 아직 안 됐다.** 그래서 게시는 로컬 `npm publish` 로 한다. 워크플로는 같은 버전이 레지스트리에 이미 있으면 게시를 건너뛰고 위 게이트만 재확인한다.
7. **npm 전파 대기** — `npm view korean-law-mcp version` 이 새 버전을 반환할 때까지 (보통 30초 안쪽).
   - **전파 전에 배포하면 이미지가 옛 버전을 설치한다.** 배포는 성공했다고 나오는데 프로덕션은 그대로인, 가장 잡기 어려운 형태의 사고다.

### 4단계: 통합 호스트 반영
8. `~/workspace/gomdori-mcp/Dockerfile`의 `korean-law-mcp@X.Y.Z` 핀을 새 버전으로 갱신
9. gomdori-mcp 레포 커밋·푸시
10. `cd ~/workspace/gomdori-mcp && fly deploy -c fly.production.toml`

### 5단계: 릴리스와 검증 — 배포 **뒤에**
11. `gh release create vX.Y.Z` — 노트 본문은 CHANGELOG 의 해당 절을 옮긴다.
    - **릴리스는 배포와 항상 같이 간다.** npm 게시만 하고 Release 를 빠뜨리면 릴리스 이력에 구멍이 남는다(v4.10.0·v4.11.0 이 그렇게 비었다가 2026-08-17 에 소급 생성됐다).
12. `bash ~/workspace/gomdori-mcp/scripts/verify-deploy.sh`
    - 핀 드리프트 + 5종 라이브 핸드셰이크 + `?oc=` 키 채널 + 큰 본문 회귀를 한 번에 본다.
    - `/healthz` 가 `up` 이라고 답하는 것과 **무엇이 배포됐는지는 다른 질문이다.** `up` 만 보고 판단하지 말 것 — `/law` initialize 응답의 `serverInfo.version` 으로 실제 나간 버전을 확인한다.

## 배포 환경
- 통합 호스트: fly 앱 `korean-law-mcp` — **1GB / shared-cpu 2 vCPU + swap 512MB**, 리전 `sin`
  - vCPU 는 2026-09-08 에 1→2. shared-cpu-1x 로는 baseline 을 다 태워 steal 92%·idle 0% 였고, 그 지연이 헬스프로브 3초를 넘겨 멀쩡한 law 가 반복 SIGKILL 됐다.
  - **리전 `sin` 은 의도된 값이다.** `nrt` egress 에서 law.go.kr·kosis.kr·apis.data.go.kr 아웃바운드가 전면 TCP 타임아웃이라 옮겼다. 되돌리지 말 것 — 자세한 근거는 `fly.production.toml` 주석.
- 공식 URL: `https://mcp.gomdori.app/law` (구 `https://korean-law-mcp.fly.dev/mcp` 하위호환 유지)
- 롤백: `fly releases -a korean-law-mcp` → `fly deploy -a korean-law-mcp -i <직전 이미지>`
