---
name: korean-law
description: "대한민국 법령, 시행령, 시행규칙, 판례, 행정규칙, 자치법규, 조약, 법률용어, 조문 인용, 시행일 또는 행위시법을 공식 law.go.kr 데이터로 확인할 때 사용한다. Use for Korean statutes, cases, ordinances, administrative rules, treaties, legal terminology, citation verification, effective dates, historical law, and questions asking what Korean law applies."
---

# Korean Law / 대한민국 법령

공식 법령 데이터가 필요한 질의에만 실행한다. Run only when the request needs official Korean legal data.

## 실행 절차 / Workflow

1. 현재 세션에 Korean Law MCP 도구가 이미 있으면 해당 도구를 우선 사용한다. If Korean Law MCP tools are already available, use them first.
2. MCP 도구가 없으면 설치된 `korean-law query "<질문>"` CLI를 실행한다. Without MCP tools, run the installed `korean-law query "<question>"` CLI.
3. CLI가 PATH에 없으면 다음 일회성 명령을 사용한다. If the CLI is not on PATH, use this one-shot fallback:

   ```bash
   npx --yes --ignore-scripts --package korean-law-mcp@4.5.0 -- korean-law query "<question>"
   ```

4. 특정 도구가 더 정확하면 `korean-law list`와 `korean-law help <tool-name>`으로 인자를 확인한 뒤 직접 호출한다. For precise operations, inspect `list` and `help <tool-name>` before calling a tool directly.
5. 복합 리서치는 `legal_research`, 인용·판례생사·행위시법 검증은 `legal_analysis`를 우선 검토한다. Prefer `legal_research` for multi-step research and `legal_analysis` for citations, case validity, or applicable-law checks.

## 초기 설정 / Initial setup

인증정보가 없다는 오류가 나오면 사용자의 승인을 받은 뒤 다음 명령을 안내한다. If credentials are missing, ask before directing the user to run:

```bash
npx --yes --ignore-scripts korean-law-mcp@4.5.0 setup --mode on-demand
```

이 설정은 전역 Agent Skill과 사용자별 API 키만 구성하며 상시 MCP 서버를 등록하지 않는다. This configures the global Agent Skill and a per-user API key without registering a persistent MCP server.

## 안전 및 인용 / Safety and citations

- Claude 또는 다른 클라이언트의 Korean Law MCP 플러그인을 자동으로 활성화하지 않는다. Never enable a Korean Law MCP plugin automatically.
- `LAW_OC`, `KOREAN_LAW_API_KEY` 또는 저장된 인증정보를 출력·로그·응답에 포함하지 않는다. Never print or log credentials.
- 법령명, 조문, 시행일과 현재법·연혁법 여부를 함께 제시한다. Include the law name, article, effective date, and current-versus-historical status.
- 공식 결과의 누락, 시점 불명확, 출처 한계를 밝힌다. State omissions, date uncertainty, and source limitations.
- 결과를 법률 자문이 아닌 조사 지원으로 취급한다. Treat results as research support, not legal advice.
