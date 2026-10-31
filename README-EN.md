# Korean Law MCP

**42 APIs compressed into 10 tools.** Search and retrieve Korean statutes, precedents, administrative rules, ordinances, treaties and legal interpretations, and **verify the legal citations in AI answers** — from your AI assistant or terminal.

[![npm version](https://img.shields.io/npm/v/korean-law-mcp.svg)](https://www.npmjs.com/package/korean-law-mcp)
[![MCP 1.27](https://img.shields.io/badge/MCP-1.27-blue)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)
[![MCP Registry](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fregistry.modelcontextprotocol.io%2Fv0%2Fservers%3Fsearch%3Dio.github.chrisryugj%2Fkorean-law-mcp%26version%3Dlatest&query=%24.servers%5B0%5D.server.version&label=MCP%20Registry&color=blue)](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.chrisryugj/korean-law-mcp)

<a href="https://jocohunt.com/p/5lkkxp3x" target="_blank" rel="noopener" title="조코헌트 주간 1등 Top 1 위너">
  <img
    src="https://jocohunt.com/images/badges/weekly-light.svg"
    alt="조코헌트 주간 1등 Top 1 위너"
    style="width: 250px; height: auto;"
  />
</a>

> MCP server + CLI for Korea's official legal database (법제처 Open API). Works with Claude Desktop, Cursor, Windsurf, Zed, and any MCP-compatible client.

[한국어](./README.md)

**Start in one line:** add `https://mcp.gomdori.app/law?oc=YOUR_KEY` as a custom connector in Claude.ai, or run `npx --ignore-scripts --omit=optional korean-law-mcp setup` → [Quick Start](#quick-start)

One-click install for VS Code and Cursor (works without a key on a shared quota; add `?oc=YOUR_KEY` to the URL for your own):

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_korean--law-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=korean-law&config=%7B%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fmcp.gomdori.app%2Flaw%22%7D) [![Install in Cursor](https://img.shields.io/badge/Cursor-Install_korean--law-000000?style=flat-square&logo=cursor&logoColor=white)](https://cursor.com/en/install-mcp?name=korean-law&config=eyJ1cmwiOiJodHRwczovL21jcC5nb21kb3JpLmFwcC9sYXcifQ%3D%3D)

If this saves you time, a GitHub ⭐ helps others find it.

[![Korean Law MCP — watch the demo](./docs/video-intro.jpg)](https://youtu.be/gmkuOqIV3dc)

<sub>▶ Click to play on YouTube. Narration is in Korean.</sub>

### Connect it to your AI

| Connect to Claude | Connect to ChatGPT |
|:---:|:---:|
| [![Connect to Claude](./docs/video-claude.jpg)](https://youtu.be/KaUKLOH7290) | [![Connect to ChatGPT](./docs/video-gpt.jpg)](https://youtu.be/-qMk-ajW-GQ) |

---

## Recent updates

Current version **v4.15.20**. All numbers come from the measurements recorded in the [CHANGELOG](CHANGELOG.md).

| Version | Main change | Measured change |
|---------|-------------|-----------------|
| 4.15.20 | Comparison table, proposed column: the period after a change that ends right before it no longer turns into 「-」 when a proviso or second sentence is added (#180) | Building Act Art. 79(5) regression test |
| 4.15.19 | Comparison-table HWPX body left-aligned — short lines left behind by wrapped dash runs no longer stretch | Checked in Hangul |
| 4.15.18 | `legal_analysis` description and title now carry the word users type, 「신구조문대비표」 (claude.ai tool search found nothing before) | Search-word gate test |
| 4.15.17 | The comparison table is now `legal_analysis(mode="amendment_table")` on an exposed tool (the demo showed Claude never looked for the hidden one); chat tables mark changes in bold | Still 10 exposed tools |
| 4.15.16 | Amendment comparison table (신·구조문대비표) `amendment_table` (via execute_tool): proposed article text → current text fetched and compared, underlines, `----`, `(생  략)`, `<신  설>`; local runs save a Hangul (.hwpx) file | 433 articles from 100 unseen laws: **67.7%** identical to the official tables (3.9% structural mismatch) |
| 4.15.15 | Annex parser kordoc 4.24.25 (PDF table row and unit-line fixes, among others), `@hono/node-server` 2.1.5 | `npm audit` 1 → **0**, 3 real annexes unchanged |
| 4.15.14 | Security: dependency vulnerabilities cleared — kordoc 4.24.8 (zod 4) underneath, zod 4.6.7, patched dev tools and transitive dependencies | `npm audit` 10 → **0** |
| 4.15.13 | The Claude Code plugin connects to the hosted server (`mcp.gomdori.app/law`) instead of running npx; the key is optional | Nothing to install |
| 4.15.12 | Cross-tool hints (e.g. `search_law_bulk` for watching many laws) moved from tool descriptions to the server `instructions` | Same tool choices on 4 test questions |
| 4.15.11 | Human-readable titles (`title` and `annotations.title`) on all 10 exposed tools, shown in client approval prompts | Titles 0 → 10 |
| 4.15.10 | National Tax Service interpretation full text: pass the `본문조회ID(ntstDcmId)` from search to `get_decision_text(domain="nts")` — summary, reply and body (#178) | List and link only → full text |

Earlier versions: see [CHANGELOG.md](CHANGELOG.md). Milestones:

- **v4.14.1**: single-article lookup 3.1s → 0.24s (13×); a 15-citation check went from ✓0 to ✓15
- **v4.13.0**: compliance-register monitoring from 98 `search_law` calls → 1–2 `search_law_bulk` calls
- **v4.4.0**: exposed tools 19 → 9, tool-list context ~15.1KB → ~7.2KB (52% smaller)
- **v3.4.0**: precedent / constitutional / admin-appeal responses use 74% fewer tokens on average

---

## Why this exists

South Korea has **1,600+ active laws**, **10,000+ administrative rules**, and a precedent system spanning Supreme Court, Constitutional Court, tax tribunals, and customs rulings. All of this lives behind a clunky government API with zero developer experience.

This project wraps that entire legal system into **10 tools** that any AI assistant or script can call. Built by a Korean civil servant who got tired of manually searching [법제처](https://www.law.go.kr) for the hundredth time.

---

## Quick Start

Listed on the official MCP Registry: [`io.github.chrisryugj/korean-law-mcp`](https://registry.modelcontextprotocol.io/v0/servers?search=io.github.chrisryugj/korean-law-mcp)

### Step 0: Get an API key (free, 1 minute)

Get a **법제처 Open API key (OC)** first. Local installs need it; options that use the hosted server also work without one on a shared quota. Go to the [법제처 Open API page](https://open.law.go.kr/LSO/openApi/guideList.do) → sign up and log in → **"Open API 사용 신청"** (apply) → fill in the form and you get a key (e.g. `honggildong`). Use that key in the configs below.

### Option 1: Claude Code plugin (easiest)

If you use [Claude Code](https://claude.com/claude-code), two lines are enough. The plugin asks for your API key during install and stores it as sensitive data; leave it empty to use the shared quota.

```
/plugin marketplace add chrisryugj/korean-law-mcp
/plugin install korean-law@korean-law-marketplace
```

Then just ask in natural language (`"근로기준법 제74조 알려줘"`, `"민법 제750조 판례 검증해줘"`) and the `korean-law` MCP tools are called automatically. Update to a new version with:

```
/plugin marketplace update korean-law-marketplace
```

> The plugin connects to the hosted server `https://mcp.gomdori.app/law` (nothing is installed on your machine) and sends your key in the `apikey` header. To avoid the hosted server, use the local install below.

#### Troubleshooting: `Permission denied (publickey)`

If install fails with `git@github.com: Permission denied (publickey).`, the installer tried to clone over SSH and you have no SSH key registered (common for first-time Git users). Either:

1. **Force HTTPS (simplest, recommended):** run this, then retry `/plugin install`. It is safe to leave in place afterwards (HTTPS clone always works)
   ```bash
   git config --global url."https://github.com/".insteadOf "git@github.com:"
   ```
2. **Create and register an SSH key:** if you plan to use SSH regularly
   ```bash
   ssh-keygen -t ed25519 -C "your-email@example.com"   # press Enter 3 times
   cat ~/.ssh/id_ed25519.pub                            # copy the output
   ```
   Paste the public key into [GitHub → Settings → SSH and GPG keys → New SSH key](https://github.com/settings/keys)

### Option 2: Claude.ai on the web (no install)

Requires a Claude Pro/Max/Team/Enterprise plan (Free allows only one connector).

1. Log in to [claude.ai](https://claude.ai) → your name at the bottom of the sidebar → **Settings** → **Connectors**
2. **Add custom connector** → name `korean-law` (anything works), URL below (replace `honggildong` with your own key from Step 0)

   ```
   https://mcp.gomdori.app/law?oc=honggildong
   ```

3. **Add** → open the connector's **Configure** and set every tool to **Always allow** (important: no approval prompt each time)
4. Ask "근로기준법 제74조 알려줘" in a chat

> To change the connector URL, delete it and add it again. No profile selection needed (10 tools cover all 42 APIs); an existing `?profile=lite&oc=...` URL keeps working.

### Option 3: Desktop apps (remote server, no install)

| Client | Config File |
|--------|------------|
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` (Win) / `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac) |
| Cursor | `.cursor/mcp.json` |
| Windsurf | `.windsurf/mcp.json` |
| Continue | `~/.continue/config.json` |
| Zed | `~/.config/zed/settings.json` |

**Claude Desktop** does not support remote HTTP MCP servers directly. Use the `mcp-remote` adapter (requires [Node.js](https://nodejs.org) 18+ for `npx`):

```json
{
  "mcpServers": {
    "korean-law": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://mcp.gomdori.app/law?oc=your-api-key"
      ]
    }
  }
}
```

**Cursor, Windsurf, and other clients with native remote HTTP support** — use the URL directly:

```json
{
  "mcpServers": {
    "korean-law": {
      "url": "https://mcp.gomdori.app/law?oc=your-api-key"
    }
  }
}
```

> If other MCP servers are already configured, add only the `"korean-law": { ... }` entry inside `"mcpServers"`. Restart the app after saving.

### Option 4: Local install

Requires [Node.js](https://nodejs.org) 20.19+ (22.12+ recommended).

**Auto setup (recommended):**

```bash
npx --ignore-scripts --omit=optional korean-law-mcp setup
```

Interactive wizard handles API key input, client selection, and config file registration.
Supports Claude Desktop, Claude Code, Cursor, VS Code, Windsurf, Gemini CLI, Zed, and Antigravity.
Project-folder configs (Claude Code `.mcp.json`, VS Code `.vscode/mcp.json`) may be committed to git, so the key is not written in plain text:
Claude Code gets a `${LAW_OC}` reference (add `export LAW_OC=your-key` to your shell profile), and VS Code prompts for the key on first run.

**Manual setup:**

```bash
npm install --ignore-scripts --omit=optional -g korean-law-mcp
```

Add to your MCP client config, then restart the app:

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

### Option 5: CLI

```bash
npm install --ignore-scripts --omit=optional -g korean-law-mcp
export LAW_OC=your-api-key               # Mac/Linux
set LAW_OC=your-api-key                  # Windows CMD
$env:LAW_OC="your-api-key"              # Windows PowerShell

korean-law "민법 제1조"                  # natural-language query
korean-law search_law --query "관세법"
korean-law get_law_text --mst 160001 --jo "제38조"
korean-law search_precedents --query "부당해고"
korean-law list                          # all tools
korean-law list --category 판례          # filter by category
korean-law help search_law               # tool help
```

### Option 6: Docker

```bash
docker build -t korean-law-mcp .
docker run -e LAW_OC=your-api-key -e MCP_HTTP_HOST=0.0.0.0 \
  -e MCP_AUTH_TOKEN=replace-with-a-secret -p 3000:3000 korean-law-mcp
```

### API key delivery (priority order)

| Method | Example | Notes |
|--------|---------|-------|
| URL query | `?oc=your-key` | Simplest for web clients. Auto-applies to entire session |
| HTTP header | `apikey: your-key` | Also supports `law-oc`, `x-api-key`, `Authorization: Bearer` |
| Environment variable | `LAW_OC=your-key` | Local install (Options 4, 5) |
| Tool parameter | `apiKey: "your-key"` | Per-tool override |

> Without a key, the public server (`mcp.gomdori.app/law`) falls back to a shared server key under a limit shared by all keyless users. Sending your own key bypasses that limit (free signup: https://open.law.go.kr).

### 법제처 API protocol

Calls to the 법제처 API use HTTPS by default. On internal or air-gapped networks where certificate validation is hard, set `LAW_API_PROTOCOL=http`. Allowed values are `http` and `https`; anything else (or unset) means `https`. Putting it in the client config's `env` block is clearest:

```json
{
  "mcpServers": {
    "korean-law": {
      "command": "korean-law-mcp",
      "env": {
        "LAW_OC": "your-api-key",
        "LAW_API_PROTOCOL": "http"
      }
    }
  }
}
```

A shell variable or a `.env` file (`LAW_OC=...` plus `LAW_API_PROTOCOL=http`) also works:

```bash
export LAW_API_PROTOCOL=http        # Mac/Linux
set LAW_API_PROTOCOL=http           # Windows CMD
$env:LAW_API_PROTOCOL="http"       # Windows PowerShell
```

### National Tax Service precedent server: TLS / proxy

When a National Tax Service precedent body is missing from the 법제처 JSON response, and always for National Tax Service interpretation (`nts`) bodies, the server queries `taxlaw.nts.go.kr`. That server redirects HTTP to HTTPS, so regardless of `LAW_API_PROTOCOL=http` the Node.js runtime must trust the `https://taxlaw.nts.go.kr` certificate. Behind corporate networks, firewalls or SSL-inspection proxies the page may open in a browser while Node.js `fetch()` fails with `[EXTERNAL_API_ERROR] fetch failed` (different certificate store and proxy settings). Check the connection from Node.js first:

```bash
node -e "fetch('https://taxlaw.nts.go.kr/qt/USEQTA002P.do?ntstDcmId=200000000000019303').then(r=>console.log(r.status,r.url)).catch(e=>console.error(e.name,e.message,e.cause))"
```

If you must go through a web proxy, set its address (applies to the external HTTPS connection of the NTS precedent fallback). On Windows, register the system variable from an administrator terminal with `setx`, then restart Windows or the Node.js process:

```env
LAW_EXTERNAL_HTTPS_PROXY=http://proxy-host:8080
```

```cmd
setx LAW_EXTERNAL_HTTPS_PROXY http://proxy-host:8080 /M
```

If certificate validation still fails through the proxy, you can temporarily disable TLS verification for this project's external HTTPS proxy path only, for diagnosis. Never leave it on in production; the second line removes it after diagnosis:

```cmd
setx LAW_EXTERNAL_TLS_REJECT_UNAUTHORIZED 0 /M
reg delete "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v LAW_EXTERNAL_TLS_REJECT_UNAUTHORIZED /f
```

---

## Usage Examples

### Basic lookups

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

Abbreviations are expanded even when combined with other words: `화관법 시행령` → `화학물질관리법 시행령`, `중처법 제4조 책임자` → `중대재해 처벌 등에 관한 법률 제4조 책임자`.

### Natural-language scenarios

Ask in natural language and the matching extra analysis is added automatically. Scenarios are detected from query keywords or set explicitly with the `scenario` parameter.

| Ask this | Get this |
|----------|---------|
| "Food Sanitation Act penalty reduction possible?" | Penalty schedule (1st/2nd/3rd offense) + penalty clauses + appeal cases where penalties were reduced + amendment history |
| "Import customs FTA check" | Customs Act + customs interpretations + FTA treaties + tariff tables + tax tribunal rulings |
| "Building Act permit procedure" | Legal basis (Act→Decree→Rule) + fees/forms + admin rules + local ordinance exceptions + interpretations |
| "Building Act impact analysis" | Subordinate laws + nationwide ordinances affected + related admin rules |
| "National Health Insurance Act delegation" | Delegated provisions whose implementing decrees haven't been created yet |
| "Parking ordinance compliance check" | Constitutional Court decisions + admin appeal cancellations + parent law basis |
| "Labor Standards Act amendment timeline" | Old/new comparison + article history + precedents/interpretations mapped chronologically |

Every result ends with suggested follow-up queries.

### Verification and analysis

| Feature | Ask this | What it does |
|---------|----------|--------------|
| `verify_citations` | Paste an AI-written legal answer | Checks cited articles and precedents against the 법제처 DB: exists ✓ / missing ✗ (with valid range) / wrong title `[CONTENT_MISMATCH]` / repealed `⌛ REPEALED` |
| `cite_check` | "2007다27670 아직 유효해?" | Back-traces later decisions citing the case via full-text search and detects en banc overruling language ("…변경하기로 한다") — a Korean Shepard's |
| `applicable_law` | "2023.5.10 당시 도로교통법 제44조" | Pins the version in force on that date (MST) → the article as it read then → diff with current → transitional provisions from later addenda. Handles former titles and administrative rules (notices) |
| `impact_map` | "민법 제103조 인용한 판례" | Reverse search across precedents, constitutional decisions, interpretations, admin appeals and ordinances + forward citations + a mermaid graph |
| `time_travel` | "개인정보보호법 2020-01-01 vs 2025-11-01" | Article-level diff between two points in time: added (+) / removed (-) / changed (△) |
| `action_plan` | "전세금 못 받았어" | Five steps: situation → rights and remedies → where and by when to file → documents and forms → pitfalls |
| `ordinance_radar` | "광진구 주차장 조례" | Extracts the parent statutes from the ordinance's Article 1 (Purpose), compares their current enforcement dates with the ordinance's, and flags ones to review |

Actual `verify_citations` output:

```
"Civil Act Art. 750 … Labor Standards Act Art. 60(1) … Commercial Act Art. 401-2(7) … Criminal Act Art. 9999"

✓ Civil Act Article 750 (Tort liability) — exists
✓ Labor Standards Act Article 60 (Annual paid leave) Paragraph 1 — exists
✗ Commercial Act Article 401-2 — Paragraph 7 doesn't exist (max Paragraph 2)
✗ Criminal Act Article 9999 — no such article (valid range: Art.1~Art.372)
```

### Handy options

| To do this | Call |
|------------|------|
| Read the addenda (effective dates, transitional provisions) | `get_law_text(mst, jo="부칙")` |
| Text as of a given date | `get_law_text(mst, efYd=<date>)`: a non-effective date (today, an incident date) resolves to the version in force that day |
| The annex in force on a date | `get_annexes(lawName, date)` |
| Title + full-text precedent search | `search_decisions(domain="precedent", options={search:"both"})` |
| Part of a long administrative rule | `get_admin_rule` with `jo:"제9-5조"`, `chapter:"제9장"`, `keyword:"해외직접투자"`, or `page:2` |
| Monitor many statutes for changes | `execute_tool(tool_name="search_law_bulk")`: an array of names plus `previous={law_id: previous_MST}` returns only statutes whose MST changed |
| Uncondensed decision text | `get_decision_text(..., full=true)` |

---

## Tool Structure (10 tools)

10 tools are advertised. The former 8 `chain_*` tools are `task` values of `legal_research`, and the 4 analysis features are `mode` values of `legal_analysis`. Other specialized tools stay reachable via `discover_tools` → `execute_tool`, and calling the old tool names directly still works.

| Category | Tool | Description |
|----------|------|-------------|
| **Research** (1) | `legal_research` | Multi-step legal research — pick one of 8 `task` values |
| **Analysis** (1) | `legal_analysis` | Verification & analysis — pick one of 4 `mode` values |
| **Law** (3) | `search_law` | Search statutes → get lawId, MST |
| | `get_law_text` | Full article text retrieval (`jo="부칙"` for addenda) |
| | `get_annexes` | Annex/form retrieval (fee tables, rate tables, forms; `date` for the version in force that day) |
| **Ordinance** (1) | `ordinance_radar` | Ordinance revision radar — auto-diffs the parent statutes a local ordinance cites |
| **Unified** (2) | `search_decisions` | **21 domain** unified search (precedents, interpretations, tax tribunal, customs, NTS, MOEL interpretations, constitutional court, admin appeals, FTC, PIPC, NLRC, industrial-accident review, employment-insurance review, ACR, appeal review, ACR special, school rules, public corps, public institutions, treaties, English law) |
| | `get_decision_text` | **21 domain** full text retrieval |
| **Meta** (2) | `discover_tools` | Search specialized tools (terms, annexes, history, comparison, etc.) |
| | `execute_tool` | Execute discovered specialized tool |

### `legal_research` tasks (formerly chain_*)

| task | Description | Scenario extensions |
|------|-------------|---------------------|
| `full_research` (default) | Full research (AI search → statutes → precedents → interpretations) | `customs`: customs & clearance / `action_plan`: five-step guide |
| `law_system` | Legal hierarchy (three-tier comparison, delegation) | `delegation`: delegated-legislation watch / `impact`: impact analysis |
| `action_basis` | Legal basis for permits and dispositions | `penalty`: dispositions & penalties |
| `dispute_prep` | Dispute preparation (objections, litigation, tribunals) | `domain`: tax/labor/privacy/competition |
| `amendment_track` | Amendment tracking (old/new comparison, history) | `timeline`: chronological timeline / `time_travel`: two-date diff |
| `ordinance_compare` | Ordinance comparison (parent law → ordinances nationwide) | `compliance`: parent-law conformity |
| `procedure_detail` | Procedures, fees and forms | `manual`: civil-servant handling manual |
| `document_review` | Contract / terms risk analysis (`text` required) | — |

### `legal_analysis` modes

| mode | Description | Required |
|------|-------------|----------|
| `verify_citations` | Hallucination guard: cited articles and precedents exist, and article titles match | `text` |
| `cite_check` | Precedent citator: later citations back-traced, overruling detected | `caseNumber` |
| `applicable_law` | Point-in-time law: version in force on a date + transitional provisions; former titles and administrative rules too | `lawName`, `date` |
| `impact_map` | Article impact graph: citing precedents, interpretations, ordinances + mermaid | `lawName`, `jo` |

Full tool reference: [docs/API.md](docs/API.md).

---

## Features

- **42 APIs → 10 Tools** — Statutes, precedents, admin rules, ordinances, constitutional decisions, tax rulings, customs interpretations, treaties, institutional rules, legal terminology
- **MCP + CLI** — Use from Claude Desktop or from your terminal
- **Korean Law Intelligence** — Auto-resolves abbreviations (`화관법` → `화학물질관리법`), converts article numbers (`제38조` ↔ `003800`), visualizes 3-tier delegation
- **Currency checks** — `[현행]` / `⚠️[연혁-과거버전]` labels in search results, pending amendments and renames shown alongside, repealed statutes point to the repeal reason and successor regulation
- **Point-in-time across renames** — versions are chained by statute ID, so lookups reach the years before a law was renamed
- **Failures are never reported as "not found"** — lookup failures, maintenance pages and exhausted budgets carry explicit markers such as `[NOT_FOUND]`
- **Annex Extraction** — Downloads HWPX/HWP/PDF/XLSX/DOCX annexes and converts to Markdown ([kordoc](https://github.com/chrisryugj/kordoc) engine)
- **8 chains + 9 scenarios** — Situation-specific analysis added automatically (penalty reduction, customs clearance, delegated legislation, etc.)
- **21 Decision Domains** — `search_decisions` covers precedents, constitutional court, tax tribunal, FTC, NLRC and more in one tool
- **Caching** — 1-hour search cache, 24-hour article cache
- **Remote Endpoint** — Use without installation via `https://mcp.gomdori.app/law` (the legacy `korean-law-mcp.fly.dev/mcp` stays backward compatible)

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LAW_OC` | Yes | — | 법제처 API key ([get one free](https://open.law.go.kr/LSO/openApi/guideResult.do)) |
| `LAW_API_PROTOCOL` | No | `https` | `http` for networks where HTTPS certificate validation fails |
| `LAW_EXTERNAL_HTTPS_PROXY` | No | — | Web proxy for the NTS precedent fallback (see above) |
| `LAW_USER_AGENT` / `LAW_REFERER` | No | — | Override the default User-Agent / Referer sent to 법제처 |
| `PORT` | No | 8000 | HTTP server port |
| `CORS_ORIGIN` | No | `*` | CORS allowed origin. Setting it explicitly also allows that origin to pass Origin validation |
| `ALLOWED_ORIGINS` | No | — | Comma-separated origin allowlist. Requests carrying an `Origin` header are rejected unless listed (DNS rebinding defense). If neither this nor `CORS_ORIGIN` is set, all browser requests are blocked |
| `MCP_AUTH_TOKEN` | No | — | When set, `/mcp` requires `x-mcp-token` or `Authorization: Bearer`. Required for non-loopback deployments unless explicitly overridden |
| `MCP_HTTP_HOST` | No | `127.0.0.1` | Bind address. A non-loopback host requires `MCP_AUTH_TOKEN`, unless the deliberate legacy override below is set |
| `MCP_ALLOW_UNAUTHENTICATED_REMOTE` | No | `0` | Set to `1` only for a deliberately public, non-loopback deployment without MCP access authentication |
| `TRUST_PROXY` | No | `false` | Set to a positive proxy-hop count (for example `1` behind one Fly/ingress proxy). Never use `true`/`all` |
| `ALLOW_QUERY_API_KEY` | No | `1` | Set to `0` to reject the `?oc=` query-string API key (it leaks into proxy access logs) |
| `ACCESS_LOG` | No | `0` | Set to `1` to log each request. Only `req.path` is recorded, never the query string, so the `oc=` key never reaches the log |
| `RATE_LIMIT_RPM` | No | 60 | Tool calls per minute per IP. `0` disables only the per-IP limiter; batch and execution limits remain active |
| `FALLBACK_DAILY_CAP` | No | `0` | Rolling daily cap on server-key fallback usage. `0` disables it |
| `MCP_MAX_BATCH_CALLS` | No | 20 | Maximum `tools/call` items in one JSON-RPC HTTP envelope |
| `MCP_MAX_BODY_BYTES` | No | 102400 | Maximum incoming JSON request size. The older `MCP_BODY_LIMIT` (`100kb`, etc.) is accepted for compatibility |
| `MCP_MAX_UPSTREAM_REQUESTS` | No | 48 | Request-wide upstream attempt budget, including retries and anti-bot hops |
| `MCP_MAX_UPSTREAM_BODY_BYTES` | No | 2097152 | Maximum bytes read from one upstream response body |
| `MCP_MAX_TOTAL_UPSTREAM_BODY_BYTES` | No | 8388608 | Maximum upstream body bytes read by one outer request |
| `MCP_MAX_TOOL_RESPONSE_CHARS` | No | 50000 | Maximum returned MCP tool-response characters |
| `MCP_CHAIN_DEADLINE_MS` | No | 45000 | Deadline for one chain. On expiry, the branches received so far are returned as a partial result with markers for the rest |

All numeric limits are validated as whole numbers during startup. Invalid values fail startup rather than weakening a limit. `legal_research` and other documented chain tools share the 48-attempt request budget; JSON-RPC batch siblings share accounting but retain independent MCP cancellation signals. `get_batch_articles` is capped at 20 statutes and 100 articles in total; HTTP disconnects and MCP cancellations propagate through fetches, retry waits and body reads.

### HTTP deployment defaults

HTTP mode is local by default: it binds only to `127.0.0.1`, does not trust `X-Forwarded-For`, and leaves token authentication optional for that loopback-only use. For a reverse-proxy deployment, set both the explicit public bind and the exact trusted hop count, for example:

```bash
MCP_HTTP_HOST=0.0.0.0 TRUST_PROXY=1 MCP_AUTH_TOKEN=replace-with-a-secret \
  korean-law-mcp --mode http --port 8000
```

`MCP_ALLOW_UNAUTHENTICATED_REMOTE=1` preserves intentionally public legacy deployments, but emits a startup warning and should only be used where another access boundary is in place.

### Dependency and install boundary

`kordoc` remains because annex parsing is a reachable server feature. Its known-good pure-JS `pdfjs-dist@4.10.38` runtime is pinned as a normal dependency; optional OCR/ML/native helpers are not needed by this server. Documented and Docker installs use `--omit=optional --ignore-scripts`. CI and publishing retain optional development-tool bindings with scripts disabled during validation, then prune to the production graph and run the PDF annex smoke test. Scanner reports for transitive HTTP-framework packages should be evaluated against the reachable server path rather than treated as proof that the server exposes the affected middleware.

---

## Documentation

- [docs/API.md](docs/API.md) — Tool reference
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — System design
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — Development guide
- [CHANGELOG.md](CHANGELOG.md) — Release history

## FAQ

**How do I search Korean statutes and court precedents from Claude or ChatGPT?**
Connect this MCP server. In Claude.ai, add `https://mcp.gomdori.app/law?oc=YOUR_KEY` as a custom connector. For Claude Desktop, Cursor, Windsurf and Zed see [Quick Start](#quick-start); for ChatGPT see the [connection video](https://youtu.be/-qMk-ajW-GQ) (in Korean).

**Is it free?**
Yes. The code is MIT-licensed, and the 법제처 Open API key it needs is free ([open.law.go.kr](https://open.law.go.kr/LSO/openApi/guideResult.do)).

**Can it catch legal citations an LLM made up?**
`legal_analysis(mode="verify_citations")` checks the statute articles and case numbers cited in a text against the official 법제처 source, for existence and for content. `mode="cite_check"` tells whether a precedent is still good law.

**What does it cover?**
Statutes, precedents, administrative rules, local ordinances, treaties and legal interpretations (including the National Tax Service), plus annexes and forms. It also resolves past versions of a law and points repealed statutes to their successors.

## Star History

<a href="https://star-history.dera.page/#chrisryugj/korean-law-mcp&type=timeline&legend=bottom-right">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://star-history.dera.page/svg?repos=chrisryugj/korean-law-mcp&type=timeline&theme=dark&legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://star-history.dera.page/svg?repos=chrisryugj/korean-law-mcp&type=timeline&legend=top-left" />
    <img alt="Star History Chart" src="https://star-history.dera.page/svg?repos=chrisryugj/korean-law-mcp&type=timeline&legend=top-left" />
  </picture>
</a>

## Data sources

Statute, precedent, administrative-rule, ordinance, treaty and interpretation texts come from the **법제처 National Law Information Center OPEN API** (https://open.law.go.kr/). National Tax Service interpretations use the NTS legal information system.

For any decision that needs legal force, always check the original text at the National Law Information Center. This tool may process and summarize what it retrieves.

Each user must obtain their own API key (`LAW_OC`) from 법제처; a key may be used only by the person it was issued to.

## Credits

- [법제처](https://www.law.go.kr) Open API — Korea's official legal database
- [Anthropic](https://anthropic.com) — Model Context Protocol
- [kordoc](https://github.com/chrisryugj/kordoc) — HWP/HWPX parser (same author)

## License

[MIT](./LICENSE)

Third-party implementation references and data-source notices: see [NOTICE](./NOTICE).

---

<sub>Made by a Korean civil servant @ 광진구청 AI동호회 AI.Do</sub>
