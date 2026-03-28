# Korean Law MCP

**64 tools to search, retrieve, and analyze Korean law** — statutes, precedents, ordinances, and more.

[![npm version](https://img.shields.io/npm/v/korean-law-mcp.svg)](https://www.npmjs.com/package/korean-law-mcp)
[![MCP 1.27](https://img.shields.io/badge/MCP-1.27-blue)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)

> MCP server + CLI for Korea's official legal database (법제처 Open API). Works with Claude Desktop, Cursor, Windsurf, Zed, and any MCP-compatible client.

[한국어](./README-KR.md)

---

## Why this exists

South Korea has **1,600+ active laws**, **10,000+ administrative rules**, and a precedent system spanning Supreme Court, Constitutional Court, tax tribunals, and customs rulings. All of this lives behind a clunky government API with zero developer experience.

This project wraps that entire legal system into **64 structured tools** that any AI assistant or script can call. Built by a Korean civil servant who got tired of manually searching [법제처](https://www.law.go.kr) for the hundredth time.

---

## Features

- **64 Legal Tools** — Statutes, precedents, admin rules, ordinances, constitutional decisions, tax rulings, customs interpretations, legal terminology
- **MCP + CLI** — Use from Claude Desktop or from your terminal. Same 64 tools.
- **Korean Law Intelligence** — Auto-resolves abbreviations (`화관법` → `화학물질관리법`), converts article numbers (`제38조` ↔ `003800`), visualizes 3-tier delegation
- **Annex Extraction** — Downloads HWPX/HWP annexes and converts tables to Markdown automatically
- **7 Chain Tools** — Composite research workflows in a single call (e.g. `chain_full_research`: AI search → statutes → precedents → interpretations)
- **Caching** — 1-hour search cache, 24-hour article cache
- **Remote Endpoint** — Use without installation via `https://korean-law-mcp.fly.dev/mcp`

---

## Quick Start

### Option 1: MCP Server (Claude Desktop / Cursor / Windsurf)

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

```json
{
  "mcpServers": {
    "korean-law": {
      "url": "https://korean-law-mcp.fly.dev/mcp"
    }
  }
}
```

### Option 3: CLI

```bash
npm install -g korean-law-mcp
export LAW_OC=your-api-key

korean-law search_law --query "관세법"
korean-law get_law_text --mst 160001 --jo "제38조"
korean-law search_precedents --query "부당해고"
korean-law list                          # all 64 tools
korean-law list --category 판례          # filter by category
korean-law help search_law               # tool help
```

### Option 4: Docker

```bash
docker build -t korean-law-mcp .
docker run -e LAW_OC=your-api-key -p 3000:3000 korean-law-mcp
```

---

## Tool Categories (64 total)

### Search (11)

| Tool | Description |
|------|-------------|
| `search_law` | Search statutes (auto-resolves abbreviations) |
| `search_admin_rule` | Search administrative rules |
| `search_ordinance` | Search local ordinances |
| `search_precedents` | Search court precedents |
| `search_interpretations` | Search legal interpretations |
| `search_all` | Unified search across all categories |
| `suggest_law_names` | Law name autocomplete |
| `advanced_search` | Advanced search with date/keyword filters |
| `get_law_history` | Law amendment history by date |
| `get_annexes` | Retrieve annexes + extract HWPX/HWP to Markdown |
| `parse_jo_code` | Article number ↔ JO code conversion |

### Retrieve (9)

| Tool | Description |
|------|-------------|
| `get_law_text` | Full statute text |
| `get_admin_rule` | Full administrative rule |
| `get_ordinance` | Full local ordinance |
| `get_precedent_text` | Full precedent text |
| `get_interpretation_text` | Full interpretation text |
| `get_batch_articles` | Batch article retrieval (multiple laws) |
| `get_article_with_precedents` | Article + related precedents |
| `compare_old_new` | Old vs. new law comparison |
| `get_three_tier` | Law → Decree → Rule 3-tier comparison |

### Analyze (9)

| Tool | Description |
|------|-------------|
| `compare_articles` | Cross-law article comparison |
| `get_law_tree` | Delegation structure tree |
| `get_article_history` | Article amendment history |
| `summarize_precedent` | Precedent summary |
| `extract_precedent_keywords` | Precedent keyword extraction |
| `find_similar_precedents` | Similar precedent search |
| `get_law_statistics` | Law statistics |
| `parse_article_links` | Parse in-text legal references |
| `get_external_links` | Generate external links |

### Specialized (10)

| Tool | Description |
|------|-------------|
| `search_tax_tribunal_decisions` | Tax tribunal decisions |
| `search_customs_interpretations` | Customs interpretations |
| `search_constitutional_decisions` | Constitutional Court decisions |
| `search_admin_appeals` | Administrative appeal decisions |
| `search_ftc_decisions` | Fair Trade Commission decisions |
| `search_nlrc_decisions` | Labor Relations Commission decisions |
| `search_pipc_decisions` | Privacy Commission decisions |
| + `get_*_text` for each | Full text retrieval |

### Knowledge Base (7)

| Tool | Description |
|------|-------------|
| `get_legal_term_kb` | Legal terminology search |
| `get_legal_term_detail` | Term definition |
| `get_daily_term` | Everyday language search |
| `get_daily_to_legal` | Everyday → legal term mapping |
| `get_legal_to_daily` | Legal → everyday term mapping |
| `get_term_articles` | Articles using a term |
| `get_related_laws` | Related laws |

### Chain Tools (7)

Composite research workflows — multiple tools in a single call.

| Tool | Workflow |
|------|----------|
| `chain_law_system` | Search → 3-tier comparison → batch articles |
| `chain_action_basis` | Law system → interpretations → precedents → appeals |
| `chain_dispute_prep` | Precedents + appeals + specialized decisions |
| `chain_amendment_track` | Old/new comparison + article history |
| `chain_ordinance_compare` | Parent law → nationwide ordinance search |
| `chain_full_research` | AI search → statutes → precedents → interpretations |
| `chain_procedure_detail` | Law system → annexes → enforcement rule annexes |

### Other (4)

| Tool | Description |
|------|-------------|
| `search_ai_law` | Natural language AI search |
| `search_english_law` / `get_english_law_text` | English law search/retrieval |
| `search_historical_law` / `get_historical_law` | Historical law search/retrieval |
| `search_legal_terms` | Legal dictionary search |

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

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LAW_OC` | Yes | — | 법제처 API key ([get one free](https://open.law.go.kr/LSO/openApi/guideResult.do)) |
| `PORT` | No | 3000 | HTTP server port |
| `CORS_ORIGIN` | No | `*` | CORS allowed origin |
| `RATE_LIMIT_RPM` | No | 60 | Requests per minute per IP |

## Documentation

- [docs/API.md](docs/API.md) — 64-tool reference
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
