# Korean Law MCP

**41 APIs compressed into 14 tools.** Search, retrieve, and analyze Korean law — statutes, precedents, ordinances, treaties, and more.

[![npm version](https://img.shields.io/npm/v/korean-law-mcp.svg)](https://www.npmjs.com/package/korean-law-mcp)
[![MCP 1.27](https://img.shields.io/badge/MCP-1.27-blue)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)

> MCP server + CLI for Korea's official legal database (법제처 Open API). Works with Claude Desktop, Cursor, Windsurf, Zed, and any MCP-compatible client.

[한국어](./README.md)

![Korean Law MCP demo](./demo.gif)

---

## What's New in v3.2.0 — Smart Scenarios

**Same 14 tools, 7 new analysis scenarios.** Just ask in natural language — the AI detects what you need and runs extra analysis automatically.

| Ask this | Get this |
|----------|---------|
| "Food Sanitation Act penalty reduction possible?" | Penalty schedule + violation clauses + appeal cases where penalties were reduced |
| "Import customs FTA check" | Customs Act + customs interpretations + FTA treaties + tariff tables + tax tribunal rulings |
| "Building Act permit procedure" | Legal basis (Act→Decree→Rule) + fees/forms + admin rules + local ordinance exceptions |
| "National Health Insurance Act delegation" | Finds delegated provisions where implementing decrees haven't been created yet |
| "Building Act impact analysis" | Subordinate laws + nationwide ordinances affected + related admin rules |
| "Labor Standards Act amendment timeline" | Old/new comparison + article history + precedents/interpretations mapped chronologically |
| "Parking ordinance compliance check" | Constitutional Court decisions + admin appeal cancellations + parent law basis |

> **No changes to how you use it.** Ask naturally, get deeper analysis automatically.

<details>
<summary>v3.3.0~v3.3.1 changes</summary>

**v3.3.1** — Law alias dictionary expansion (11 → 52 entries, +41)

Triggered by a lexdiff hallucination case where "산안기준규칙" (산업안전보건기준에 관한 규칙) got keyword-matched to "국가표준기본법" by Korea Law Open API's aiSearch. Expanded `LAW_ALIAS_ENTRIES` in `lib/search-normalizer.ts` with high-frequency abbreviations across labor/safety (산안법, 중처법, 근기법), privacy/telecom (개보법, 정보통신망법), anti-corruption (청탁금지법, 이해충돌방지법), public contracting (국가계약법, 지방계약법), real estate (주임법, 상임법, 부거법), antitrust (공정거래법, 하도급법, 약관법, 표시광고법, 가맹사업법), finance (자본시장법, 특금법, 전금법), urban planning (국토계획법, 도정법), environment/health (감염병예방법, 대기환경법), transport (여객운수법, 화물운수법), procedure (민소법, 형소법, 민집법), social insurance (국건법, 산재보험법, 고보법), and telecom (전기통신사업법). Since `api-client.ts` and `law-parser.ts` already consume `resolveLawAlias()`, the existing search pipeline gets the benefit automatically. 45/45 tests passing (41 new + 4 regression).

**v3.3.0** — HTTP stateless mode + kordoc 2.3.0

Root-cause fix for the remote server (`korean-law-mcp.fly.dev`) periodically losing sessions due to OOM-driven restarts. Switched to MCP's official stateless pattern (`sessionIdGenerator: undefined`): fresh `Server + Transport` per request, released on response close. Removed in-memory session Map, `InMemoryEventStore`, and idle cleanup — eliminating leak sources entirely. Survives restarts, scale-out, and rolling deploys with zero client disruption. `GET /mcp` and `DELETE /mcp` return `405` (matching the SDK example). API keys are isolated per-request via `AsyncLocalStorage`.

- **HTTP stateless transition** — [src/server/http-server.ts](src/server/http-server.ts) (ref: `@modelcontextprotocol/sdk/examples/server/simpleStatelessStreamableHttp.js`)
- **kordoc 2.2.5 → 2.3.0**
- **Session management code removed** — `sessions` Map, `MAX_SESSIONS`, 10-min idle `setInterval`, `InMemoryEventStore`, POST/GET/DELETE branching (~50 LOC net reduction)

**v3.2.2** — `get_annexes` direct exposure. Auto-fetch annexes on refund/fee keywords.

**v3.2.1** — kordoc 2.2.5 update.

</details>

<details>
<summary>v3.1.0~v3.1.5 changes</summary>

**v3.1.5** — kordoc 2.2.4 + README modernization.

**v3.1.4** — kordoc 2.2.4 update. HTML `<table>` for merged cells, markdownToHwpx improvements.

**v3.1.3** — Empty search result hints for 18 tools. Session cleanup interval reduced.

**v3.1.2** — kordoc 2.2.1 update. GFM table escaping.

**v3.1.1** — kordoc 2.1→2.2 update.

**v3.1.0** — Production hardening: 20 file fixes.

**v3.1.3** — Empty search result hints for 18 tools. Session cleanup interval reduced (30min→10min).

**v3.1.2** — kordoc 2.2.1 update. GFM table special character escaping and pipe collision prevention.

**v3.1.1** — kordoc 2.1→2.2 update.

**v3.1.0** — Production hardening: 20 file fixes. truncateResponse 50KB limit applied to 17 tools, HTTP session limit (MAX_SESSIONS=100), CORS wildcard warning, parameter pollution defense, chain tool auth error propagation, SSE server dead code removal.

</details>

<details>
<summary>v3.0.x changes</summary>

v2 structured 41 legal APIs into 89 MCP tools. v3 re-compresses them into **14 tools**.

| | Raw APIs | v2 | v3 |
|---|:---:|:---:|:---:|
| Tool count | 41 | 89 | **14** |
| AI context cost | - | ~110 KB | **~20 KB** |
| Coverage | - | 100% | **100%** |
| Profile management | - | lite/full split | **Single (none needed)** |

**What changed:** 34 individual search/get tools for precedents, constitutional court, tax tribunal, FTC, etc. are now unified into 2 tools: `search_decisions(domain)` + `get_decision_text(domain)`, covering **17 domains** with a single `domain` parameter.

- **kordoc 1.6 → 2.2.5** — Document parsing engine upgrade (XLSX/DOCX support, security hardening, form filler)
- **Bug fixes** — Admin appeal text retrieval, English law text retrieval

</details>

<details>
<summary>v2.2.0</summary>

- **23 New Tools (64 → 87)** — Treaties, law-ordinance linkage, institutional rules, special administrative appeals, document analysis, and more.
- **Document Analysis Engine** — 8 document types, 17 risk rules, amount/period extraction, clause conflict detection.
- **Law-Ordinance Linkage (4 tools)** — Trace delegation chains between national laws and local ordinances.
- **Treaty Support (2 tools)** — Bilateral/multilateral treaty search and retrieval.
- **Security Hardening** — CORS origin control, API key header-only, security headers, session ID masking.

</details>

<details>
<summary>v1.8.0 – v1.9.0 features</summary>

- **8 Chain Tools** — Composite research workflows in a single call: `chain_full_research` (AI search → statutes → precedents → interpretations), `chain_law_system`, `chain_action_basis`, `chain_dispute_prep`, `chain_amendment_track`, `chain_ordinance_compare`, `chain_procedure_detail`.
- **Batch Article Retrieval** — `get_batch_articles` accepts a `laws` array for multi-law queries in one call.
- **AI Search Type Filter** — `search_ai_law` now supports `lawTypes` filter.
- **Structured Error Format** — `[ErrorCode] + tool name + suggestion` across all 64 tools.
- **HWP Table Fix** — Legacy HWP parser now extracts tables from `paragraph.controls[].content` path.

</details>

---

## Why this exists

South Korea has **1,600+ active laws**, **10,000+ administrative rules**, and a precedent system spanning Supreme Court, Constitutional Court, tax tribunals, and customs rulings. All of this lives behind a clunky government API with zero developer experience.

This project wraps that entire legal system into **14 structured tools** that any AI assistant or script can call. Built by a Korean civil servant who got tired of manually searching [법제처](https://www.law.go.kr) for the hundredth time.

---

## Quick Start

### Option 1: MCP Server (Claude Desktop / Cursor / Windsurf)

**Auto setup (recommended):**

```bash
npx korean-law-mcp setup
```

Interactive wizard handles API key input, client selection, and config file registration.
Supports Claude Desktop, Claude Code, Cursor, VS Code, Windsurf, and Gemini CLI.

**Manual setup:**

```bash
npm install -g korean-law-mcp
```

Add to your MCP client config:

```json
{
  "mcpServers": {
    "korean-law": {
      "command": "korean-law-mcp",
      "env": {
        "LAW_OC": "your-api-key"
      }
    }
  }
}
```

Get your free API key at [법제처 Open API](https://open.law.go.kr/LSO/openApi/guideResult.do).

| Client | Config File |
|--------|------------|
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` (Win) / `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac) |
| Cursor | `.cursor/mcp.json` |
| Windsurf | `.windsurf/mcp.json` |
| Continue | `~/.continue/config.json` |
| Zed | `~/.config/zed/settings.json` |

### Option 2: Remote (No Install)

Include your API key in the URL:

```json
{
  "mcpServers": {
    "korean-law": {
      "url": "https://korean-law-mcp.fly.dev/mcp?oc=your-api-key"
    }
  }
}
```

**For web clients (Claude.ai, etc.)** — same URL works everywhere. v3 exposes only 14 tools by default, no profile selection needed.

> 14 tools (8 chains + 2 core + 2 unified + 2 meta) cover all 41 APIs. Use `discover_tools` → `execute_tool` for specialized tools.

**API Key Delivery** (priority order):

| Method | Example | Notes |
|--------|---------|-------|
| URL query | `?oc=your-key` | Simplest for web clients. Auto-applies to entire session |
| HTTP header | `apikey: your-key` | Also supports `law-oc`, `x-api-key`, `Authorization: Bearer` |
| Tool parameter | `apiKey: "your-key"` | Per-tool override |

> Get your free API key at [법제처 Open API](https://open.law.go.kr/LSO/openApi/guideResult.do).

### Option 3: CLI

```bash
npm install -g korean-law-mcp
export LAW_OC=your-api-key

korean-law search_law --query "관세법"
korean-law get_law_text --mst 160001 --jo "제38조"
korean-law search_precedents --query "부당해고"
korean-law list                          # all tools
korean-law list --category 판례          # filter by category
korean-law help search_law               # tool help
```

### Option 4: Docker

```bash
docker build -t korean-law-mcp .
docker run -e LAW_OC=your-api-key -p 3000:3000 korean-law-mcp
```

---

## Tool Structure (14 tools)

v3 exposes only 14 tools. Specialized tools are accessible via `discover_tools` → `execute_tool`.

| Category | Tool | Description |
|----------|------|-------------|
| **Chain** (8) | `chain_full_research` | Comprehensive research (AI search → statutes → precedents → interpretations) |
| | `chain_law_system` | Legal system analysis (3-tier comparison, delegation structure) |
| | `chain_action_basis` | Administrative action basis (permits, approvals, dispositions) |
| | `chain_dispute_prep` | Dispute preparation (appeals, litigation, tribunals) |
| | `chain_amendment_track` | Amendment tracking (old/new comparison, history) |
| | `chain_ordinance_compare` | Ordinance comparison (parent law → nationwide ordinances) |
| | `chain_procedure_detail` | Procedure/cost/form guide |
| | `chain_document_review` | Contract/terms risk analysis |
| **Law** (2) | `search_law` | Search statutes → get lawId, MST |
| | `get_law_text` | Full article text retrieval |
| **Unified** (2) | `search_decisions` | **17 domain** unified search (precedents, constitutional court, tax tribunal, FTC, NLRC, customs, interpretations, admin appeals, PIPC, ACR, appeal review, school rules, public corps, public institutions, treaties, English law) |
| | `get_decision_text` | **17 domain** full text retrieval |
| **Meta** (2) | `discover_tools` | Search specialized tools (terms, annexes, history, comparison, etc.) |
| | `execute_tool` | Execute discovered specialized tool |

---

## Usage Examples

```
User: "관세법 제38조 알려줘"
→ search_law("관세법") → get_law_text(mst, jo="003800")

User: "화관법 최근 개정 비교"
→ "화관법" → "화학물질관리법" auto-resolved → compare_old_new(mst)

User: "근로기준법 제74조 해석례"
→ search_interpretations("근로기준법 제74조") → get_interpretation_text(id)

User: "산업안전보건법 별표1 내용"
→ get_annexes("산업안전보건법 별표1") → HWPX download → Markdown table
```

---

## Features

- **41 APIs → 14 Tools** — Statutes, precedents, admin rules, ordinances, constitutional decisions, tax rulings, customs interpretations, treaties, institutional rules, legal terminology
- **MCP + CLI** — Use from Claude Desktop or from your terminal
- **17 Decision Domains** — `search_decisions` covers precedents, constitutional court, tax tribunal, FTC, NLRC, customs, and 11 more domains in one tool
- **Korean Law Intelligence** — Auto-resolves abbreviations (`화관법` → `화학물질관리법`), converts article numbers (`제38조` ↔ `003800`), visualizes 3-tier delegation
- **Annex Extraction** — Downloads HWPX/HWP/PDF/XLSX/DOCX annexes and converts to Markdown ([kordoc](https://github.com/chrisryugj/kordoc) v2.2.5 engine)
- **8 Chain Tools** — Composite research workflows in a single call (e.g. `chain_full_research`: AI search → statutes → precedents → interpretations)
- **Caching** — 1-hour search cache, 24-hour article cache
- **Remote Endpoint** — Use without installation via `https://korean-law-mcp.fly.dev/mcp`

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LAW_OC` | Yes | — | 법제처 API key ([get one free](https://open.law.go.kr/LSO/openApi/guideResult.do)) |
| `PORT` | No | 3000 | HTTP server port |
| `CORS_ORIGIN` | No | `*` | CORS allowed origin |
| `RATE_LIMIT_RPM` | No | 60 | Requests per minute per IP |

## Documentation

- [docs/API.md](docs/API.md) — Tool reference
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — System design
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — Development guide

## Credits

- [법제처](https://www.law.go.kr) Open API — Korea's official legal database
- [Anthropic](https://anthropic.com) — Model Context Protocol
- [kordoc](https://github.com/chrisryugj/kordoc) — HWP/HWPX parser (same author)

## License

[MIT](./LICENSE)

---

<sub>Made by a Korean civil servant @ 광진구청 AI동호회 AI.Do</sub>
