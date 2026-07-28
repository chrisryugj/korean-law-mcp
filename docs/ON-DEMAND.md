# Korean Law 온디맨드 배포 가이드 / On-demand Distribution Guide

## 목적 / Goal

`korean-law` Skill은 Claude Code와 Codex에서 항상 발견되지만, 법률 질의가 있을 때만 짧은 CLI 프로세스를 실행하고 응답 후 종료합니다. The `korean-law` Skill remains discoverable in Claude Code and Codex, but starts a short-lived CLI process only for legal questions and exits after the response.

상시 MCP 서버 등록을 없애 여러 프로젝트와 동시 세션의 유휴 프로세스 비용을 줄이는 것이 목적입니다. Its purpose is to avoid persistent MCP registration and reduce idle-process cost across projects and concurrent sessions.

## 사용자 배포 / User rollout

“전역”은 현재 OS 사용자 범위입니다. 각 PC와 각 OS 사용자 계정에서 다음 명령을 한 번 실행합니다. “Global” means the current OS user; run this command once for every account on every computer:

```bash
npx --yes --ignore-scripts korean-law-mcp@4.10.0 setup --mode on-demand
```

설치기는 다음 상태를 모두 확인한 뒤에만 성공으로 끝납니다. Setup reports success only after verifying all of the following:

- 법제처 API 키를 숨김 입력으로 받아 사용자 설정에 저장 / Save the MOLEG API key in per-user config through hidden input
- Claude Code의 `~/.claude/skills/korean-law/SKILL.md` 복사본 / Claude Code copy at `~/.claude/skills/korean-law/SKILL.md`
- Codex의 `~/.agents/skills/korean-law/SKILL.md` 복사본 / Codex copy at `~/.agents/skills/korean-law/SKILL.md`
- 전역 Skill 목록의 `korean-law` 항목 / `korean-law` in the global Skill list
- 상시 `mcpServers` 항목을 만들지 않음 / No persistent `mcpServers` entry

기존 Claude Code MCP 플러그인은 자동으로 비활성화하지 않습니다. `/plugin`에서 기존 플러그인을 사용자 범위로 끈 뒤 새 세션을 여세요. Setup never disables the existing Claude Code MCP plugin; disable it at user scope in `/plugin`, then open a new session.

## 안전한 호출 / Safe invocation

에이전트는 구조화된 argv로 고정 명령을 시작하고 질문을 별도 표준입력으로 전달해야 합니다. Agents must start a fixed command with structured argv and send the question separately through stdin:

```text
argv: ["korean-law", "query", "--stdin"]
stdin: 사용자의 원문 질문 / the user's exact question
```

CLI가 PATH에 없으면 Skill은 다음 고정 버전을 일회 실행합니다. If the CLI is not on PATH, the Skill uses this pinned one-shot fallback:

```bash
npx --yes --ignore-scripts --package korean-law-mcp@4.10.0 -- korean-law query --stdin
```

사용자 텍스트를 셸 문자열, `eval`, 명령 치환 또는 파이프에 결합하지 않습니다. Never interpolate user text into a shell string, `eval`, command substitution, or a pipeline.

## 업데이트·복구·제거 / Update, repair, and removal

Skill은 npm 패키지의 로컬 복사본에서 설치되므로 일반 `skills update`의 원격 추적 대상이 아닙니다. 새 릴리스가 나오면 정확한 새 버전으로 setup을 다시 실행합니다. Because the Skill is installed from the package's local copy, it is not remotely tracked by generic `skills update`; re-run setup with the exact new release version.

같은 버전의 setup을 다시 실행하면 손상된 복사본도 교체하고 재검증합니다. Re-running setup with the same version also replaces and re-verifies damaged copies.

```bash
npx --yes --ignore-scripts korean-law-mcp@4.10.0 setup --mode on-demand
```

Skill만 제거하고 사용자 인증 설정은 유지하려면 다음 명령을 실행합니다. To remove only the Skill while retaining the user credential config:

```bash
npx --yes --ignore-scripts skills@1.5.18 remove korean-law --global --agent claude-code codex --yes
```

## 배포자 체크리스트 / Maintainer checklist

1. `npm run release:preflight`로 미사용 npm 버전인지 확인하고 package, plugin, marketplace, Skill, README의 고정 버전을 함께 갱신합니다. Run `npm run release:preflight` to confirm the npm version is unused, then update the package, plugin, marketplace, Skill, and README pins together.
2. Node 20에서 build, typecheck, Vitest, 온디맨드 회귀 테스트, dead-code 검사를 통과시킵니다. Pass build, typecheck, Vitest, on-demand regression tests, and dead-code checks on Node 20.
3. `npm audit --omit=dev --omit=optional`과 전체 optional dependency audit를 각각 기록하고 잔여 위험을 릴리스 판단에 포함합니다. Record both the core `npm audit --omit=dev --omit=optional` result and the full optional-dependency audit, then include residual risk in the release decision.
4. 격리된 사용자 홈에서 setup, 두 Skill 파일, 전역 목록, `0600` 인증 파일을 확인합니다. Verify setup, both Skill files, the global list, and the `0600` credential file in an isolated user home.
5. 고정 명령과 stdin으로 실제 법률 질의를 실행하고 프로세스가 남지 않는지 확인합니다. Run a live legal query with the fixed command and stdin, then confirm no process remains.
6. GitHub PR을 병합한 뒤 같은 커밋으로 npm 패키지와 GitHub Release를 게시합니다. After merging the GitHub PR, publish the npm package and GitHub Release from the same commit.
