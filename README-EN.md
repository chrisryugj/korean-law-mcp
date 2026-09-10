# Korean Law MCP

**42 APIs compressed into 10 tools.** Search, retrieve, and analyze Korean law — statutes, precedents, ordinances, treaties + **LLM hallucination guard for legal citations (statutes and precedents, existence + content)** + **precedent citator (cite_check)** + **point-in-time law resolution (applicable_law)** + **ordinance revision radar (ordinance_radar)** + **successor lookup for repealed statutes**.

[![npm version](https://img.shields.io/npm/v/korean-law-mcp.svg)](https://www.npmjs.com/package/korean-law-mcp)
[![MCP 1.27](https://img.shields.io/badge/MCP-1.27-blue)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)

<a href="https://jocohunt.com/p/5lkkxp3x" target="_blank" rel="noopener" title="조코헌트 주간 1등 Top 1 위너">
  <img
    src="https://jocohunt.com/images/badges/weekly-light.svg"
    alt="조코헌트 주간 1등 Top 1 위너"
    style="width: 250px; height: auto;"
  />
</a>

> MCP server + CLI for Korea's official legal database (법제처 Open API). Works with Claude Desktop, Cursor, Windsurf, Zed, and any MCP-compatible client.

[한국어](./README.md)

[![Korean Law MCP — watch the demo](./docs/video-intro.jpg)](https://youtu.be/gmkuOqIV3dc)

<sub>▶ Click to play on YouTube. Narration is in Korean.</sub>

### Connect it to your AI

| Connect to Claude | Connect to ChatGPT |
|:---:|:---:|
| [![Connect to Claude](./docs/video-claude.jpg)](https://youtu.be/KaUKLOH7290) | [![Connect to ChatGPT](./docs/video-gpt.jpg)](https://youtu.be/KCFIzervxtE) |

---

## v4.13.0 — Compliance-register monitoring: 98 calls down to 1-2

Three field reports from running an ISO compliance register (108 laws across 8 domains) against this server:
[#157](https://github.com/chrisryugj/korean-law-mcp/issues/157) · [#158](https://github.com/chrisryugj/korean-law-mcp/issues/158) · [#159](https://github.com/chrisryugj/korean-law-mcp/issues/159) (@thkim660207-cmd). Tests 738 → **758**.

- **`search_law_bulk`**: takes an array of law names and returns one compact line each — `law_id · MST · effective_date · upcoming`.
  Pass `previous={law_id: previous_MST}` for diff mode: only laws whose MST changed come back, so a full register sweep
  costs one or two calls. The response ends with a snapshot JSON you feed straight into the next run. Amendments that are
  promulgated but not yet in force do not change the current MST, so they are reported separately instead of silently
  reading as "unchanged"
- **Per-article amendment history is now opt-in** (`includeHistory=true` to restore): it used to be dumped from original
  enactment every time, and on the Occupational Safety and Health Act (enacted 1981) that section alone exhausted the
  50k-char response budget — truncating the old-vs-new comparison table people actually needed
- **Image-only annexes now say so**: some notices return discharge-limit tables as `<img>` tags with no text. That used to
  pass through as "has content", which is exactly where a model starts guessing numbers. Now it carries a warning plus the
  source URL and the **original attachment (hwpx/pdf) links** — which the API was already returning but the code never surfaced

---

## v4.12.0 — 62-issue batch + closing the "it doesn't exist" failure paths

A batch that measured three axes (legal correctness, token efficiency, response latency) and closed **62 filed issues** ([#88–#149](https://github.com/chrisryugj/korean-law-mcp/issues), PR [#150](https://github.com/chrisryugj/korean-law-mcp/pull/150) by @humdrum00001010), plus follow-up repairs for 31 defects found in pre-merge domain review. Tests 196 → **701**.

**The server no longer claims a record is absent when it is merely unreachable.** For a legal research tool, the worst failure is not slowness — it is asserting that an existing statute or precedent does not exist.

- Precedent lookups treated **a single empty response right after a 503 or network error** as confirmed absence; confirmation is now based on observation history, not attempt count
- The HTML fallback path declared `[NOT_FOUND]` for **real precedents** when it received a maintenance or anti-bot page; it now distinguishes a broken recovery path from a missing record
- Annex lookups silently turned HTML responses into empty lists and hardened into "not in the 법제처 database"

**Requests no longer stall or get dropped whole.**

- Research chains take a **45-second deadline** (`MCP_CHAIN_DEADLINE_MS`) — on expiry they assemble whatever branches returned and ship a **partial result**, marking the rest. Slow upstreams used to blow past the MCP client timeout (60s) and lose everything
- Bodies over 2 MiB: **300-second hang → 13 ms explicit error** (fixes a v4.11.0 regression)
- Precedent miss 12.5s → **2.2s**; system-tree hit 10.6–11.6s → 6.3–8.3s
- Routing an 8.5k-character query takes 476 ms; the regex that took up to 45.9s on adversarial input is gone

**Citation verification got sharper.**

- `verify_citations` now covers **precedents** as well as statutes, separating "cannot exist" from "unverified"
- `impact_map` matches the **statute name** in addition to the article number — 군형법 Article 1 no longer contaminates a 형법 Article 1 query. Undecidable cases are held rather than dropped (including "구 OO법" citations common in constitutional review)
- `cite_check` reads holdings that arrive as arrays or objects (previously a silent failure)

**Annexes and search.** Reaches annexes beyond the 100-item window (verified on 도로교통법 시행규칙: annex 28 of 263), blocks the silent substitution of annex 1 for annex `1의2`, and cuts `discover_tools` responses by 65% with 10/10 correct answers retained.

> Two user-visible changes: dates are now formatted `2024.01.05` instead of `2024.1.5.` (empty enforcement dates render as `N/A`), and `discover_tools` returns a ranked pointer format.

## v4.11.0 — Request and release boundary hardening

Closed the structures that let one request amplify into hundreds of upstream calls, or let the server keep working after the client disconnected.

- **Per-request execution budget**: retries and anti-bot hops draw from the same budget (`MCP_MAX_UPSTREAM_REQUESTS`, default 48)
- **Cancellation propagation**: HTTP disconnects and MCP cancellations now reach tools, chains, upstream fetches, and backoff waits
- **Packaging verification**: artifacts without sources and missing `exports` targets are blocked before publish

> ⚠️ Breaking: HTTP bind default `0.0.0.0` → `127.0.0.1`; `TRUST_PROXY` default `1` → `false` (only integers 1–10 accepted); `get_batch_articles` input caps (20 statutes, 50 articles each, 100 per request). See the [CHANGELOG](./CHANGELOG.md#4110---2026-08-16) for migration details.

## v4.10.0 — Repealed statutes now point to their successors

Searching for a repealed statute used to return nothing. The server now **traces the revision history and reports the repeal reason along with the consolidated successor regulation**, for both statutes and administrative rules — so questions about laws that no longer exist don't dead-end.

## v4.9.7 — Fixing the 429 storm for shared-key users (token-bucket fallback quota)

Users hitting the public server (`mcp.gomdori.app/law`) without their own 법제처 key kept getting 429s. The server-key fallback quota is a **global limit shared by every keyless user**, and it used a fixed window — so once a few callers drained it early in the window, everyone else was blocked for the rest of it. Production measurement (2026-08-12): 2 of every 3 keyless requests were rejected immediately.

- **Replaced with a token bucket** (`src/lib/rate-limit.ts`): continuous refill means a caller gets through seconds after depletion instead of waiting out the window. Same average throughput, bursts absorbed — which matches how MCP clients call several tools per conversation turn
- **`Retry-After` header + wait seconds in the message**: 429 bodies now say `retry in Ns`, and the IP-limit response is JSON-RPC shaped (the previous plain `{error}` body could not be parsed by MCP clients)
- **New `FALLBACK_DAILY_CAP`**: caps rolling 24h total usage so the per-minute limit can be relaxed without exposing the server key's upstream quota. `0` disables it (default)
- Public server settings: per-minute `30 → 120`, daily cap `43,200` (the 24h theoretical total of the old 30 rpm) — same total, 4× the burst headroom

Requests that carry their own 법제처 key via the `apikey` header never hit this gate (free signup: https://open.law.go.kr).

## v4.9.0 — Three notations that made citation verification **silently skip** (current)

When `verify_citations` is wired into a pipeline as a hallucination gate, the dangerous failure is not "verification failed" but **verification never ran**. Without a law name it never reaches article-existence checking, yet the output only shows a warning (⚠) — so a fabricated article in the same text still produces no `✗`. Users read that as "passed". Three notations, all found via real-world reports:

```
「노인장기요양보험법」 제38조제1항 및 같은 법 시행규칙 제30조
  ("Article 38(1) of the Long-Term Care Insurance Act and Article 30 of the
    Enforcement Rule of the same Act")

before  ⚠ 0 verified / 2 needs-check — matched only '119 Emergency Report ... Enforcement Rule'
after   ✓ Article 38(1) verified · ✓ Enforcement Rule Article 30 verified
        └ Article 999 in the same text → ✗ NOT_FOUND (range: 1–44) — gate actually fires
```

- **Extraction failure inside `「…」`** (#69, @BW-YU): `LAW_NAME_REGEX` anchors the law-name ending with `$`, but the **closing bracket left at the end of the lookback** blocked the anchor (only trailing whitespace was stripped).
- **Interpunct mismatch** (#69, @BW-YU): official statute names use the Hangul interpunct `ㆍ`(U+318D) while real documents, judgments and LLM output use `·`(U+00B7). Now absorbs `·ㆍ‧•・` — unrelated-law blocking (`민법`→`난민법`) is unchanged.
- **`같은 법` (same Act) anaphora** (#70, @gonnarun): the standard notation in statutes and government forms. Candidate shrinking produced suffix-only candidates (`시행규칙`) that pull in unrelated statutes, and the preceding law name was never inherited. Now inherited — but **not across a blank line, and never without an antecedent**: judging on the wrong statute is worse than not judging. With no viable candidate it reports `⚠ law name unclear` instead of labelling zero search hits as `✗ NOT_FOUND`.

### + v4.8.0 — Five external contributions (#63–#67)

Point-in-time law determination, history parsing, search resolver, retries, repealed-law handling.

## v4.7.0 — Ordinance revision radar (`ordinance_radar`)

**"The parent statute changed — is our ordinance stale?"** One call answers the question local-government officials chase every year.

- **Automatic basis-law extraction**: Parses the ordinance's Article 1 (Purpose) for its statutory basis — the parent act, enforcement decree, and enforcement rules cited in 「」 (including the "같은 법 시행령" shorthand). Scanning only the purpose article avoids false alarms from unrelated statutes cited in annex tables.
- **Revision cross-check**: Compares each parent law's current enforcement date against the ordinance's enforcement date and flags "parent law amended after the ordinance took effect → review for revision", with MST identifiers for follow-up.
- The official ordinance-linkage API (lnkOrd) has poor coverage, so this parses the standard citation format in ordinance text instead.
- Also in this release: JSON-RPC batch requests now count each `tools/call` against rate/fallback quotas (amplification fix, per-request cap 20 via `MCP_MAX_BATCH_CALLS`), clean graceful shutdown, and exact-match-first law resolution in `get_article_history`.

### + v4.7.1–v4.7.4 — Search accuracy & citation-verification patches

- **v4.7.4**: Stop `search_law` from returning the wrong statute. The common name "인공지능법" isn't a substring of the official title 「인공지능 발전과 신뢰 기반 조성 등에 관한 기본법」, so the LIKE search returned 0 hits and the expanded query ("AI법") got back **50 unrelated statutes with the query ignored**. Registers the aliases and adds a `hasRelatedHit` guard: if no result's title or alias overlaps the query, the response is rejected instead of accepted.
- **v4.7.2**: `verify_citations` degraded to `PARTIAL_VERIFIED` — and thus **missed hallucinations** — when a modifier preceded the statute name ("절도죄는 형법 제329조…"). Fixed by retrying `findLaws` while progressively trimming leading words (#55). Also patches hono (5 HIGH advisories, #54).
- **v4.7.1**: `legal_research` now absorbs a `scenario` value mistakenly passed as `task` instead of failing the tool call, and `ordinance_radar` accepts a `query` alias (PlayMCP review feedback).

## v4.6.0 — Citation verification goes deeper (content) + cloud anti-bot

- **`verify_citations` content check**: Beyond confirming an article exists, it now catches content hallucinations like `민법 제750조(계약해제)` — a real article (§750) tagged with the wrong title. It compares the cited article title against the actual one (`[CONTENT_MISMATCH]`) using LexDiff's `citation-content-matcher` (normalized common substring + character bigram Jaccard). Same for `legal_analysis(mode=verify_citations)`.
- **law.go.kr JS anti-bot bypass**: When 법제처 serves a `location.assign` JS redirect instead of API data to cloud IPs (GCP/AWS/Fly), the client parses the obfuscated URL and follows the tokenized redirect (up to 3 hops, retrying the original URL on a 404). No-op on local/registered IPs — a defense layer for cloud deployments where `Referer` injection (v4.0.9) isn't enough.

## v4.5.0 — Upcoming-law detection (prevents "renamed law not found" errors)

`search_law` runs a supplementary `target=eflaw` (enforcement-date) search and annotates results.

- **Pending rename**: e.g. 「데이터기반행정 활성화에 관한 법률」 → 「인공지능 및 데이터 기반 행정 활성화에 관한 법률」 (effective 2026-08-28). Maps old ↔ new titles so searching the new name doesn't return only "no exact match" and mislead the LLM into "the law doesn't exist."
- **Pending amendment**: when a current law has an amendment awaiting enforcement, surfaces its enforcement date, promulgation number, and pending-version MST.
- **Not-yet-in-force new law**: separately flags promulgated-but-not-yet-effective laws that return 0 hits in a current search (with a no-legal-effect warning).

## v4.4.1–4.4.3 — Stability patches

- **v4.4.3**: Pin `zod` to `^4` — fixes a crash where a fresh install resolving zod 3.x threw `z.toJSONSchema is not a function` on the first `listTools` call.
- **v4.4.2**: Restore `get_annexes` for administrative-rule tables/forms — parse the `admrulbyl` key first, auto-detect "...시행세칙", and split table/form collisions that share a bylSeq (#50/#49/#51).
- **v4.4.1**: Fix advertised-schema `required` bug — `.default()` fields (`legal_research.task`, `search_law.display`) were exposed as required inputs (fixed via `io:"input"`); pass through `legal_analysis` cost options; warn on incompatible scenarios.

## v4.4.0 — Exposed tools consolidated 19 → 9 (52% context reduction)

Shrinks the ListTools payload every MCP client reads per session from ~15.1KB to ~7.2KB.

- 8 `chain_*` tools → one **`legal_research`** (`task` param: full_research·law_system·action_basis·dispute_prep·amendment_track·ordinance_compare·procedure_detail·document_review)
- 4 killer features (`verify_citations`·`cite_check`·`applicable_law`·`impact_map`) → one **`legal_analysis`** (`mode` param)
- **Backward compatible**: direct tool-name calls and `execute_tool` routing both still work; only the advertised list changes.

## What's New in v4.3 — Precedent Citator + Point-in-Time Law

### `cite_check` — "Is this precedent still good law?" (Korean Shepard's)

Give it a case number (e.g. `2007다27670`). It back-traces every later decision citing that case via full-text search, deep-scans en banc decisions for overruling language ("…변경하기로 한다"), and tracks alias references like "(이하 '2008년 전원합의체 판결'이라 한다)". Verdict: ✅ still cited / ⚠️ en banc successor exists / ❌ overruling detected — with the exact holding context.

### `applicable_law` — "Which version of the law applies to my case date?"

Give it a statute + a date. It pins the version in force on that date (MST), fetches the article as it read then, diffs against the current text, and extracts transitional provisions (적용례·경과조치) from every later amendment's addenda — plus lex temporis guidance (Criminal Act §1, General Act on Public Administration §14).

---

## v3.5 — Citation Hallucination Guard

**Catches fake article citations in AI-generated legal answers in real time.** Cross-verifies every citation against Korea's official law database.

```
"Under Civil Act Article 750, damages may be claimed for tort;
 Labor Standards Act Article 60 Paragraph 1 provides annual leave;
 Commercial Act Article 401-2 Paragraph 7 imposes director liability;
 Criminal Act Article 9999 imposes aggravated punishment."
```

→ Run `verify_citations` (actual verification result against 법제처 API):

- ✓ Civil Act Article 750 (Tort liability) — exists
- ✓ Labor Standards Act Article 60 (Annual paid leave) Paragraph 1 — exists
- ✗ **Commercial Act Article 401-2 — Paragraph 7 doesn't exist (max Paragraph 2)**
- ✗ **Criminal Act Article 9999 — no such article (valid range: Art.1~Art.372)**

**Don't blindly trust ChatGPT/Claude legal answers.** Essential reliability check for legal AI services, law firms, students, contract review.

---

## What's New in v3.2.0+ — Smart Scenarios

**Same 10 tools, 9 analysis scenarios.** Just ask in natural language — the AI detects what you need and runs extra analysis automatically.

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
npx --ignore-scripts --omit=optional korean-law-mcp setup
```

Interactive wizard handles API key input, client selection, and config file registration.
Supports Claude Desktop, Claude Code, Cursor, VS Code, Windsurf, Gemini CLI, Zed, and Antigravity.

**Manual setup:**

```bash
npm install --ignore-scripts --omit=optional -g korean-law-mcp
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

**Claude Desktop** does not support remote HTTP MCP servers directly. Use the `mcp-remote` adapter (requires [Node.js](https://nodejs.org) 18+ for `npx`):

```json
{
  "mcpServers": {
    "korean-law": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://korean-law-mcp.fly.dev/mcp?oc=your-api-key"
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
      "url": "https://korean-law-mcp.fly.dev/mcp?oc=your-api-key"
    }
  }
}
```

**For web clients (Claude.ai, etc.)** — same URL works everywhere. Only 10 tools are advertised by default, no profile selection needed.

> 10 tools (research + analysis + 3 law + ordinance radar + 2 unified + 2 meta) cover all 42 APIs. Use `discover_tools` → `execute_tool` for specialized tools.

**API Key Delivery** (priority order):

| Method | Example | Notes |
|--------|---------|-------|
| URL query | `?oc=your-key` | Simplest for web clients. Auto-applies to entire session |
| HTTP header | `apikey: your-key` | Also supports `law-oc`, `x-api-key`, `Authorization: Bearer` |
| Tool parameter | `apiKey: "your-key"` | Per-tool override |

> Get your free API key at [법제처 Open API](https://open.law.go.kr/LSO/openApi/guideResult.do).

### Option 3: CLI

```bash
npm install --ignore-scripts --omit=optional -g korean-law-mcp
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
docker run -e LAW_OC=your-api-key -e MCP_HTTP_HOST=0.0.0.0 \
  -e MCP_AUTH_TOKEN=replace-with-a-secret -p 3000:3000 korean-law-mcp
```

---

## Tool Structure (10 tools)

v4.4.0 consolidated the advertised tools (52% context reduction). The former 8 `chain_*` tools became `task` values of `legal_research`, and the 4 analysis features became `mode` values of `legal_analysis`. Other specialized tools stay reachable via `discover_tools` → `execute_tool`, and calling the old tool names directly still works for backward compatibility. v4.7.0 added `ordinance_radar`, bringing the total to 10.

| Category | Tool | Description |
|----------|------|-------------|
| **Research** (1) | `legal_research` | Multi-step legal research — pick one of 8 `task` values |
| **Analysis** (1) | `legal_analysis` | Verification & analysis — pick one of 4 `mode` values |
| **Law** (3) | `search_law` | Search statutes → get lawId, MST |
| | `get_law_text` | Full article text retrieval |
| | `get_annexes` | Annex/form retrieval (fee tables, rate tables, forms) |
| **Ordinance** (1) | `ordinance_radar` | Ordinance revision radar — auto-diffs the parent statutes a local ordinance cites (v4.7.0) |
| **Unified** (2) | `search_decisions` | **18 domain** unified search (precedents, constitutional court, tax tribunal, NTS, FTC, NLRC, customs, interpretations, admin appeals, PIPC, ACR, ACR special, appeal review, school rules, public corps, public institutions, treaties, English law) |
| | `get_decision_text` | **18 domain** full text retrieval |
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

- **42 APIs → 10 Tools** — Statutes, precedents, admin rules, ordinances, constitutional decisions, tax rulings, customs interpretations, treaties, institutional rules, legal terminology
- **MCP + CLI** — Use from Claude Desktop or from your terminal
- **17 Decision Domains** — `search_decisions` covers precedents, constitutional court, tax tribunal, FTC, NLRC, customs, and 11 more domains in one tool
- **Korean Law Intelligence** — Auto-resolves abbreviations (`화관법` → `화학물질관리법`), converts article numbers (`제38조` ↔ `003800`), visualizes 3-tier delegation
- **Annex Extraction** — Downloads HWPX/HWP/PDF/XLSX/DOCX annexes and converts to Markdown ([kordoc](https://github.com/chrisryugj/kordoc) engine)
- **8 Chain Tools** — Composite research workflows in a single call (e.g. `chain_full_research`: AI search → statutes → precedents → interpretations)
- **Caching** — 1-hour search cache, 24-hour article cache
- **Remote Endpoint** — Use without installation via `https://korean-law-mcp.fly.dev/mcp`

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LAW_OC` | Yes | — | 법제처 API key ([get one free](https://open.law.go.kr/LSO/openApi/guideResult.do)) |
| `PORT` | No | 8000 | HTTP server port |
| `CORS_ORIGIN` | No | `*` | CORS allowed origin. Setting it explicitly also allows that origin to pass Origin validation |
| `ALLOWED_ORIGINS` | No | — | Comma-separated origin allowlist. Requests carrying an `Origin` header are rejected unless listed (DNS rebinding defense) |
| `MCP_AUTH_TOKEN` | No | — | When set, `/mcp` requires `x-mcp-token` or `Authorization: Bearer`. Required for non-loopback deployments unless explicitly overridden |
| `MCP_HTTP_HOST` | No | `127.0.0.1` | Bind address. A non-loopback host requires `MCP_AUTH_TOKEN`, unless the deliberate legacy override below is set |
| `MCP_ALLOW_UNAUTHENTICATED_REMOTE` | No | `0` | Set to `1` only for a deliberately public, non-loopback deployment without MCP access authentication |
| `TRUST_PROXY` | No | `false` | Set to a positive proxy-hop count (for example `1` behind one Fly/ingress proxy). Never use `true`/`all` |
| `ALLOW_QUERY_API_KEY` | No | `1` | Set to `0` to reject the `?oc=` query-string API key (it leaks into proxy access logs) |
| `RATE_LIMIT_RPM` | No | 60 | Tool calls per minute per IP. `0` disables only the per-IP limiter; batch and execution limits remain active |
| `MCP_MAX_BATCH_CALLS` | No | 20 | Maximum `tools/call` items in one JSON-RPC HTTP envelope |
| `MCP_MAX_BODY_BYTES` | No | 102400 | Maximum incoming JSON request size. The older `MCP_BODY_LIMIT` (`100kb`, etc.) is accepted for compatibility |
| `MCP_MAX_UPSTREAM_REQUESTS` | No | 48 | Request-wide upstream attempt budget, including retries and anti-bot hops |
| `MCP_MAX_UPSTREAM_BODY_BYTES` | No | 2097152 | Maximum bytes read from one upstream response body |
| `MCP_MAX_TOTAL_UPSTREAM_BODY_BYTES` | No | 8388608 | Maximum upstream body bytes read by one outer request |
| `MCP_MAX_TOOL_RESPONSE_CHARS` | No | 50000 | Maximum returned MCP tool-response characters |

All numeric limits are validated as whole numbers during startup. Invalid values fail startup rather than weakening a limit. `legal_research` and other documented chain tools share the 48-attempt request budget; JSON-RPC batch siblings share accounting but retain independent MCP cancellation signals.

### HTTP deployment defaults

HTTP mode is local by default: it binds only to `127.0.0.1`, does not trust `X-Forwarded-For`, and leaves token authentication optional for that loopback-only use. For a reverse-proxy deployment, set both the explicit public bind and the exact trusted hop count, for example:

```bash
MCP_HTTP_HOST=0.0.0.0 TRUST_PROXY=1 MCP_AUTH_TOKEN=replace-with-a-secret \
  korean-law-mcp --mode http --port 8000
```

`MCP_ALLOW_UNAUTHENTICATED_REMOTE=1` preserves intentionally public legacy deployments, but emits a startup warning and should only be used where another access boundary is in place.

### Dependency and install boundary

`kordoc` remains because annex parsing is a reachable server feature. Its known-good pure-JS `pdfjs-dist@4.10.38` runtime is pinned as a normal dependency; optional OCR/ML/native helpers are not needed by this server. Plugin, documented, and Docker installs use `--omit=optional --ignore-scripts`. CI and publishing retain optional development-tool bindings with scripts disabled during validation, then prune to the production graph and run the PDF annex smoke test. Scanner reports for transitive HTTP-framework packages should be evaluated against the reachable server path rather than treated as proof that the server exposes the affected middleware.

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
