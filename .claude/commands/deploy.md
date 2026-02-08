# 커밋 + 푸시 + Fly.io 배포

변경사항을 커밋, 푸시하고 Fly.io에 배포합니다.

## 실행할 작업

### 1단계: 커밋 & 푸시
1. `git status`로 변경된 파일 확인
2. `git diff`로 변경 내용 확인
3. `git log -3 --oneline`로 최근 커밋 스타일 확인
4. 변경사항 분석 후 적절한 커밋 메시지 작성
5. `git add`로 변경사항 스테이징 (단, `.claude/memory/` 폴더는 `git reset -- .claude/memory/`로 제외)
6. `git commit`으로 커밋
7. `git push`로 원격에 푸시

### 2단계: 빌드 검증
8. `npm run build`로 빌드 확인 (실패 시 중단)

### 3단계: Fly.io 배포
9. flyctl로 배포 실행:
   ```
   "C:\Users\Chris\AppData\Local\Microsoft\WinGet\Packages\Fly-io.flyctl_Microsoft.Winget.Source_8wekyb3d8bbwe\flyctl.exe" deploy
   ```
   - flyctl이 PATH에 없으므로 반드시 위 전체 경로 사용
   - `fly` 또는 `flyctl` 명령은 실패함 → 전체 경로 필수
10. 배포 결과 확인 및 요약

## 제외 대상
- `.claude/memory/` 폴더: 메모리 파일은 로컬 전용 (커밋 금지)

## 커밋 메시지 형식
- 한글로 작성
- prefix 사용: feat, fix, refactor, docs, style, chore
- 예: `feat: 별표 텍스트 추출 기능 추가`

## 배포 환경
- 플랫폼: Fly.io (앱: korean-law-mcp)
- 리전: nrt (도쿄)
- Dockerfile: node:20-alpine, SSE 모드
- URL: https://korean-law-mcp.fly.dev/
