# Exposing this MCP server as a network-addressable Bindu agent

This directory contains a complete, working example of how to take the
open-source **`korean-law-mcp`** Model Context Protocol server and expose
it as a network-addressable A2A agent using
[Bindu](https://github.com/GetBindu/Bindu).

> **Community-built example.** Not affiliated with or endorsed by the
> `korean-law-mcp` maintainer, 법제처 (the Korea Ministry of Government
> Legislation), any Korean government body, or any law firm. The MCP server
> is open source under its own LICENSE; this directory is example glue for
> one possible way to drive it.

It is contributed by the team at **Bindu**, where we are building a
**compliance operating system for small and medium businesses**. The agent
in this directory ("Lex Korea") is one of the reference agents we ship as
part of that work, and the present pull request is the result of
integrating the `korean-law-mcp` server into our compliance stack. We link
back to this repository from Bindu's documentation as a technical
reference — the canonical way to reach Korea's public legal corpora over
MCP.

## Maintenance

The upstream MCP server (everything under `src/`, built to `build/`) is
maintained by the `korean-law-mcp` author — please file issues there for
anything to do with the tools or the underlying 법제처 data.

For questions, bugs, or improvements specific to *this example* — the Bindu
glue (`bindu_agent.py`, `cli.py`), the system prompt (`prompts.py`), or
this README — please open an issue against
[Bindu](https://github.com/GetBindu/Bindu) and tag the title with
`[korean-law-mcp example]`, or reach the Bindu team on
[Discord](https://discord.gg/3w5zuYUuwt). We will keep this directory in
sync with the upstream server's tool surface.

---

## What the example does

A program written against this example can ask Korean legal questions in
plain Korean or English over a standard HTTP endpoint and receive answers
that are grounded entirely in the tools this MCP server exposes — with
citations to the underlying 법령, 판례, 해석례, 헌재 결정, and the
specialist tribunal decisions. The agent is given a structured system
prompt that requires it to call your tools rather than rely on the language
model's training memory, and to cite each statement against the primary
source it came from.

The agent uses two open-source libraries:

- **Bindu** — the framework we are building. It turns a Python function
  into a network-addressable agent with its own cryptographic identity
  (a Decentralized Identifier, or DID) and a public agent card, reachable
  over the Agent-to-Agent JSON-RPC protocol defined at
  https://github.com/google-a2a/A2A.
- **agno** — used as the internal agent loop. It handles the
  language-model API call, the tool-calling protocol, and short-term
  conversation memory.

The MCP server itself comes from this repository, unmodified. Because it is
a Node/TypeScript server, it is built once (`npm run build`) and then
launched as a child process; the agent communicates with it over standard
input and output, as defined by the Model Context Protocol.

---

## How the pieces connect

```
┌─────────────────────────┐   HTTP request    ┌─────────────────────────────┐
│ Any A2A-aware client    │ ────────────────▶ │  Bindu agent on :3773       │
│ (curl, another agent,   │                   │  (agent card + DID)         │
│  a frontend, …)         │                   └─────────────────────────────┘
└─────────────────────────┘                                 │
                                                            ▼
                                              ┌─────────────────────────────┐
                                              │  Language model             │
                                              │  (via OpenRouter)           │
                                              └─────────────────────────────┘
                                                            │
                                                  child process pipe (stdio)
                                                            ▼
                                              ┌─────────────────────────────┐
                                              │  korean-law-mcp (this repo) │
                                              │  build/index.js · MCP tools │
                                              └─────────────────────────────┘
                                                            │
                                                            ▼
                                          법제처 국가법령정보센터 open APIs
                                              (law.go.kr · open.law.go.kr)
```

---

## Setup

The MCP server is the Node project in this repository; the agno + Bindu
glue is a small, isolated Python environment that lives alongside it. The
two are kept separate on purpose — your Node build is untouched.

From the root of this repository, run:

```bash
# 1. Build the upstream Korean-law MCP server (Node ≥ 20.19).
npm install
npm run build            # tsc → build/index.js

# 2. Create an isolated Python env for the agno + Bindu glue and install it.
uv venv
uv pip install -r examples/agno-bindu/requirements.txt

# 3. Provide credentials.
cp examples/agno-bindu/.env.example examples/agno-bindu/.env
# Edit examples/agno-bindu/.env and set:
#   LAW_OC             — your 법제처 open-API key (free): https://open.law.go.kr/
#   OPENROUTER_API_KEY — your model key:                  https://openrouter.ai/keys
```

> **`LAW_OC` is required.** The MCP server reads its 법제처 (국가법령정보)
> open-API key from `LAW_OC` in its own process environment. Without it,
> every upstream API call returns empty and the agent has nothing to cite.
> This example passes `LAW_OC` through to the launched server for you — you
> only have to set it once in `.env`.

The default model is `anthropic/claude-sonnet-4.5`, selected because it
performs well on both tool use and Korean. You can switch the model by
setting `BINDU_AGENT_MODEL` in `.env` to any identifier supported by
OpenRouter — for example `openai/gpt-4o`, `google/gemini-2.5-pro`, or
`deepseek/deepseek-chat`.

---

## Network exposure & dependencies

This section flags three things that are easy to miss when running the
example for the first time. Read it before you change the defaults.

### Public network exposure is opt-in

Bindu can open an [FRP](https://github.com/fatedier/frp) reverse tunnel
that makes the agent's HTTP endpoint reachable on the public internet.
That is useful for cross-network agent-to-agent calls, but it has two
properties worth being explicit about:

- The HTTP endpoint at `:3773` is **unauthenticated** at the transport
  layer. Anyone who learns the FRP URL can hit `message/send`.
- Each request runs through your configured LLM (OpenRouter or whichever
  provider you set), so **your model-API key is on the billing path** for
  any caller who reaches the agent. Your `LAW_OC` quota is likewise on the
  path.

Because of this, `bindu_agent.py` sets `expose` from a `BINDU_EXPOSE`
env var and **defaults it to `false`**. Local development on
`http://localhost:3773` works without changing anything. To enable the FRP
tunnel, set `BINDU_EXPOSE=true` in `.env` deliberately, and review the rest
of this section first.

### `BINDU_AGENT_AUTHOR` ends up in the public DID

Once the tunnel is on, the agent's DID — visible in every agent card fetch
and embedded in every signed artifact — has the shape
`did:bindu:<author>:<name>:<uuid>`, with `<author>` derived from whatever
you set in `BINDU_AGENT_AUTHOR`. The example default in both `.env.example`
and the agent card snippet below is the literal placeholder
`your_email_here@example.com`, so you will notice immediately if you forgot
to substitute your own value before turning on `BINDU_EXPOSE`.

### Dependency breadth

The `bindu` package on PyPI pulls a wider dependency tree than the example
actually exercises, because Bindu integrates with several optional
infrastructure layers and ships their clients in the core distribution. As
of this PR, that includes (non-exhaustive): [OpenTelemetry](https://opentelemetry.io/)
traces, [Sentry](https://sentry.io/) error reporting (off unless a DSN is
set), an [Ory Hydra](https://www.ory.sh/hydra/) OAuth2 client (off unless
Hydra URLs are set), and an [x402](https://x402.io/) / USDC micropayment
client (off unless a wallet is configured). Each is **opt-in** via
environment variables — none is engaged in this example — but the libraries
are installed into the Python env regardless. If you prefer a narrower
footprint, run the example against `cli.py`, which exercises the agno + MCP
path without Bindu in the loop.

---

## Running the agent

The primary entry point is the Bindu A2A service:

```bash
uv run python examples/agno-bindu/bindu_agent.py
```

This starts a network-addressable agent on port 3773. The MCP server is
started once when the program loads and is kept running across all
subsequent requests, which avoids the cost of restarting the Node process
for every question. The endpoints the service exposes are documented in the
API reference below.

For quick local checks without spinning up the network service, you can
also use the command-line script. It opens the MCP server, asks one
question, prints the cited answer, and exits:

```bash
uv run python examples/agno-bindu/cli.py "민법 제750조의 현행 조문은?"
uv run python examples/agno-bindu/cli.py "음주운전 처벌 기준을 법령과 별표로 알려줘"
uv run python examples/agno-bindu/cli.py \
  "전세 사기 관련 대법원 판례를 찾아서 사건번호와 한 줄 요지만 알려줘"
```

---

## API reference

The Bindu A2A service exposes the endpoints below at
`http://localhost:3773` by default. The shapes shown here apply to any A2A
deployment of this example.

### `GET /.well-known/agent.json`

Returns the agent's public agent card. The card describes who the agent is,
what it can do, and how to talk to it. Any A2A-aware client should fetch
this first.

```bash
curl -s http://localhost:3773/.well-known/agent.json | jq
```

**Example response (abridged):**

```json
{
  "name": "bindu-lex-korea",
  "description": "An agentic Korean legal research assistant…",
  "url": "http://localhost:3773",
  "protocolVersion": "1.0.0",
  "kind": "agent",
  "capabilities": {
    "streaming": false,
    "pushNotifications": false,
    "extensions": [
      {
        "uri": "did:bindu:your_email_here_at_example_com:bindu-lex-korea:<uuid>",
        "description": "DID-based identity for bindu-lex-korea",
        "required": false
      }
    ]
  },
  "defaultInputModes": ["text/plain", "application/json"],
  "defaultOutputModes": ["text/plain", "application/json"]
}
```

The `capabilities.extensions[].uri` field contains the agent's
Decentralized Identifier (DID), which uniquely identifies this agent
instance.

### `GET /health`

Returns a small JSON health-check payload. Useful for liveness probes; look
for `health: healthy`, `runtime.task_manager_running: true`, and
`application.agent_did`.

```bash
curl -s http://localhost:3773/health | jq
```

### `POST /` (JSON-RPC 2.0)

This is the main endpoint. It accepts JSON-RPC 2.0 requests. The two
methods this example supports are `message/send` and `tasks/get`.

#### Method: `message/send`

Submits a new question. The agent runs asynchronously, so this method does
**not** return the final answer directly — it returns a task whose
`status.state` is `submitted`. The client then polls `tasks/get` until the
task reaches a terminal state.

All four identifier fields — the JSON-RPC `id`, `message.messageId`,
`message.contextId`, and `message.taskId` — **must be valid UUIDs** (a
plain `"1"` is rejected with a 400). Reuse `contextId` across turns of the
same conversation; use a fresh `taskId` per question.

```json
{
  "jsonrpc": "2.0",
  "id": "<a UUID for this RPC call>",
  "method": "message/send",
  "params": {
    "configuration": { "acceptedOutputModes": ["text/plain"] },
    "message": {
      "role": "user",
      "messageId": "<a UUID>",
      "contextId": "<a UUID identifying the conversation>",
      "taskId":    "<a UUID identifying the task>",
      "kind": "message",
      "parts": [
        { "kind": "text", "text": "민법 제750조의 현행 조문은?" }
      ]
    }
  }
}
```

#### Method: `tasks/get`

Fetches the current state of a previously submitted task. Note the params
take `{"taskId": "…"}` (the `taskId` from `message/send`), not `{"id": …}`.

```json
{
  "jsonrpc": "2.0",
  "id": "<a fresh UUID for this RPC call>",
  "method": "tasks/get",
  "params": { "taskId": "<the taskId from message/send>" }
}
```

When finished, the answer text is at
`result.artifacts[0].parts[0].text`. The `status.state` field moves through:

| State            | Meaning                                                   |
|------------------|-----------------------------------------------------------|
| `submitted`      | The request was accepted; processing has not started yet. |
| `working`        | The agent is processing the request.                      |
| `input-required` | The agent needs clarification before it can continue.     |
| `completed`      | The agent has finished; the answer is in `artifacts`.     |
| `failed`         | The agent could not complete the request.                 |

### Try it out

The shell snippet below sends one question and prints the final answer. It
generates the four required UUIDs, submits `message/send`, then polls
`tasks/get` until the task is terminal.

```bash
uuid() { uuidgen | tr 'A-Z' 'a-z'; }
RPC_ID=$(uuid); MSG_ID=$(uuid); CTX_ID=$(uuid); TASK_ID=$(uuid)

# Submit the question.
curl -s -X POST http://localhost:3773 \
  -H 'content-type: application/json' \
  -d "{
    \"jsonrpc\":\"2.0\",\"id\":\"$RPC_ID\",\"method\":\"message/send\",
    \"params\":{
      \"configuration\":{\"acceptedOutputModes\":[\"text/plain\"]},
      \"message\":{
        \"role\":\"user\",\"messageId\":\"$MSG_ID\",
        \"contextId\":\"$CTX_ID\",\"taskId\":\"$TASK_ID\",
        \"kind\":\"message\",
        \"parts\":[{\"kind\":\"text\",\"text\":\"민법 제750조의 현행 조문은? 한 줄로.\"}]
      }
    }
  }" > /dev/null

# Poll until the task is finished.
while true; do
  RESP=$(curl -s -X POST http://localhost:3773 \
    -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":\"$(uuid)\",\"method\":\"tasks/get\",
         \"params\":{\"taskId\":\"$TASK_ID\"}}")
  STATE=$(echo "$RESP" | jq -r '.result.status.state // "?"')
  echo "state: $STATE"
  case "$STATE" in
    completed|failed|input-required)
      echo "$RESP" | jq -r '.result.artifacts[0].parts[0].text'
      break ;;
  esac
  sleep 2
done
```

> **A note on file uploads.** Send questions as `text` parts, as shown. If
> you want the agent to review a contract or 약관, paste the **text** of the
> document into the message (the agent's `analyze_document` /
> `chain_document_review` tools take text). Binary file parts are not part
> of this example's supported surface.

---

## The MCP tools

The agent has access to the full read-mostly tool surface this server
exposes over the 법제처 국가법령정보 APIs — statute search and retrieval
(`search_law`, `get_law_text`, `get_article_detail`), administrative rules
and local ordinances, court precedents and interpretations
(`search_precedents`, `search_interpretations`), the specialist tribunals
(헌재 · 행정심판 · 조세심판 · 관세 · 공정위 · 개인정보위 · 노동위 · 권익위 ·
소청심사, reachable directly or via the unified `search_decisions`), and the
headline analysis tools `verify_citations` (citation hallucination guard),
`impact_map` (article impact graph), and `analyze_document`. Multi-database
`chain_*` orchestrators and the `discover_tools` / `execute_tool` meta-layer
cover complex and long-tail questions. The agent selects among them
automatically based on the question; the authoritative reference for each
tool is this repository's top-level `README.md` / `README-EN.md`.

---

## How the agent is instructed

The system prompt (`prompts.py`) is the part of the example that turns a
general-purpose language model into a Korean legal research assistant. It is
broken into labelled sections so each rule the agent must follow is
unambiguous, and it pins the agent to four behaviours:

1. **Every answer must come from this MCP server.** The agent is instructed
   never to answer from training memory when the question touches a Korean
   statute, precedent, interpretation, or tribunal decision.
2. **The agent must cite every claim** — statutes by 법령명 and 조문, cases
   by 사건번호 / 판례일련번호, decisions by their issuing body and number.
3. **The agent prefers the cheapest precise call.** It resolves a 법령명 via
   `search_law` and then fetches the article, rather than keyword-sweeping;
   it reserves the `chain_*` orchestrators for genuinely multi-database
   questions.
4. **The agent declines questions outside Korean jurisdiction** and asks one
   targeted clarifying question when the request is genuinely ambiguous,
   instead of guessing.

---

## End-to-end verification

The following queries were executed against the **live 법제처 국가법령정보
API** (via the local `korean-law-mcp` server) during integration testing of
this example — each one run **both** through `cli.py` and through the live
A2A service (`message/send` → poll `tasks/get` → `completed`). The model was
`anthropic/claude-sonnet-4.5` via OpenRouter.

| # | Capability (tool) | Question | Path | Outcome |
|---|---|---|---|---|
| 1 | Statute retrieval (`search_law`→`get_law_text`) | 민법 제750조의 현행 조문 전문 | CLI + A2A | Returned 제750조(불법행위의 내용) verbatim, `MST 284415`, 시행 2026-03-17, with a Sources citation. |
| 2 | 별표/서식 (`get_annexes`) | 산업안전보건법 시행규칙 [별표 1]의 제목·근거조문 | CLI + A2A | Returned the title (건설업체 산업재해발생률 산정 기준…) and 근거 조문 (제4조 관련). |
| 3 | Case law (`search_decisions` domain=precedent) | 전세 사기 관련 대법원 판례 한 건 + 사건번호·요지 | CLI + A2A | Returned 대법원 2025. 5. 29. 선고 `2023다244871` 판결 (판례일련번호 `613097`) with a one-line holding. |
| 4 | Citation hallucination guard (`verify_citations`) | 민법 제750조 / 제9999조 인용이 실존하는지 검증 | CLI + A2A | Verified 제750조 as real; flagged 제9999조 as non-existent (민법 ends at 제1118조). On A2A the tool hit a transient network blip and the agent fell back to a direct `get_law_text` check, reaching the same correct verdict. |
| 5 | Article impact graph (`impact_map`) | 민법 제103조를 인용한 판례·해석례 영향 맵 | CLI + A2A | Returned 9 citing sources (대법원 판례 1, 헌재 결정 6, 자치법규 2) with a mermaid diagram. |
| 6 | Out-of-scope (no tool call) | "Most recent U.S. Supreme Court ruling on affirmative action?" | CLI + A2A | Declined politely with **no tool call**, scoped itself to Korean law, pointed to Justia / SCOTUSblog / Oyez. |
| 7 | Ambiguous (no tool call) | "그 법 언제 개정됐어?" | CLI + A2A | Asked **one** clarifying question (which 법령?) in Korean and stopped — **no tool call**. |

Tests 6 and 7 demonstrate that the prompt's scope and ambiguity rules take
effect without any tool call, which is the desired behaviour.

Alongside the table, the following were confirmed:

- `GET /.well-known/agent.json` returns the agent's DID under
  `capabilities.extensions[].uri`
  (`did:bindu:…:bindu-lex-korea:…`).
- `GET /health` reports `health: healthy` and
  `runtime.task_manager_running: true`.
- A **single** `korean-law-mcp` Node subprocess (one `build/index.js`
  process) served **all** seven A2A calls — the background event loop keeps
  it warm rather than respawning it per request.

---

## Files in this directory

```
examples/agno-bindu/
├── README.md           This document.
├── prompts.py          The system prompt and the agent's description.
├── agent.py            The agent definition (model, instructions, MCP launch, memory).
├── cli.py              The one-shot command-line runner.
├── bindu_agent.py      Exposes the agent over the A2A protocol via Bindu.
├── requirements.txt    The Python packages the glue needs (agno + Bindu side).
├── .env.example        Required environment variables.
└── .gitignore          Local artefacts that should not be committed.
```

---

## A note on scope and dependencies

This example does not modify any code under `src/`, does not change your CI
configuration, and does not add any new dependencies to your `package.json`.
All extra packages live in `examples/agno-bindu/requirements.txt` (a
separate Python environment) and are strictly opt-in.

The intent is to make it easy for downstream users to extend your MCP server
into a fully autonomous, network-addressable agent without forking your
repository. If at any point you would prefer a different structure — for
example moving the example to its own repository under the Bindu org, or
different README pointers — the Bindu team is happy to accommodate.

Thank you for open-sourcing this server. The breadth of the 법제처 coverage
here — 법령, 자치법규, 판례, and the full set of specialist tribunals behind
one MCP surface — is what makes an agent like this possible.
