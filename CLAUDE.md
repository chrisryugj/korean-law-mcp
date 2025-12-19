# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Korean Law MCP Server - 국가법령정보센터(법제처) API 기반 Model Context Protocol 서버

**Purpose**: Provides Claude with tools to search, retrieve, and compare Korean legal statutes through the Korea Ministry of Government Legislation Open API.

**Key Features**:
- Law search with automatic abbreviation resolution (화관법 → 화학물질관리법)
- Article text retrieval with automatic article number conversion (제38조 → 003800)
- Old-new law comparison (신구법 대조)
- Three-tier delegation mapping (법률→시행령→시행규칙)

## Development Commands

```bash
# Install dependencies
npm install

# Build TypeScript to JavaScript
npm run build

# Watch mode (rebuild on file changes)
npm run watch

# Run locally in STDIO mode (for Claude Desktop)
LAW_OC=your-api-key node build/index.js

# Run locally in SSE mode (for remote deployment testing)
LAW_OC=your-api-key node build/index.js --mode sse --port 3000
# Alternative: npm run start:sse

# Test with MCP Inspector
npx @modelcontextprotocol/inspector build/index.js
```

## Environment Variables

**Required**:
- `LAW_OC`: Korea Ministry of Government Legislation API key
  - Obtain from: https://www.law.go.kr/DRF/lawService.do
  - Store in `.env` or `.env.local` for local development
  - Set in deployment platform (Railway, Render) for production

## Architecture

### Core Components

**Entry Point** ([src/index.ts](src/index.ts)):
- Initializes MCP server with 9 tools
- Supports dual transport modes: STDIO (local) and SSE (remote)
- Parses CLI arguments to determine mode

**API Client** ([src/lib/api-client.ts](src/lib/api-client.ts)):
- Singleton HTTP client for Korea Law API
- All API calls go through this class
- Handles URL construction and error responses

**Tools** ([src/tools/](src/tools/)):
- Each tool is a separate module with Zod schema validation
- `search.ts`: Law search with abbreviation resolution
- `law-text.ts`: Article text retrieval
- `comparison.ts`: Old-new law comparison
- `three-tier.ts`: Delegation relationship mapping
- `admin-rule.ts`: Administrative rule search and retrieval
- `annex.ts`: Annexes and forms retrieval
- `ordinance.ts`: Local ordinances retrieval
- `utils.ts`: JO code conversion utility

**Data Normalization** ([src/lib/](src/lib/)):
- `search-normalizer.ts`: Law name abbreviation resolution (imported from LexDiff project)
- `law-parser.ts`: Article number parsing and JO code conversion
- `three-tier-parser.ts`: JSON parsing for delegation data

**SSE Server** ([src/server/sse-server.ts](src/server/sse-server.ts)):
- Express-based SSE transport for remote deployment
- CORS enabled for cross-origin access
- Health check endpoints for monitoring

### Data Flow

1. **Search Flow**:
   - User query → `search_law` tool
   - Normalize query → Resolve abbreviations → API call
   - Return law list with `mst` and `lawId`

2. **Article Retrieval Flow**:
   - `mst` or `lawId` + optional `jo` → `get_law_text` tool
   - Convert Korean article number to JO code if needed
   - API call → JSON response

3. **JO Code Conversion**:
   - Korean notation (제38조, 제10조의2) ↔ 6-digit code (003800, 001002)
   - Used internally by `get_law_text` and exposed as `parse_jo_code` tool

### Key Patterns

**Abbreviation Resolution**:
- Implemented in `search-normalizer.ts`
- Uses pre-built lookup map with common law abbreviations
- Also normalizes typos and spacing inconsistencies
- Code imported from production LexDiff project (battle-tested)

**Article Number Parsing**:
- Handles various formats: "38조", "제38조", "10조의2", "제10조의2"
- Converts to 6-digit JO code: AAAABB (AAAA=article, BB=branch)
- Example: "제10조의2" → 001002

**Dual Transport Support**:
- STDIO mode: For local Claude Desktop integration
- SSE mode: For remote deployment (Railway, Render)
- Mode selected via `--mode` CLI argument

## Deployment

### Local (Claude Desktop)

Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "korean-law": {
      "command": "node",
      "args": ["path/to/korean-law-mcp/build/index.js"],
      "env": {
        "LAW_OC": "your-api-key-here"
      }
    }
  }
}
```

### Remote (Railway/Render)

1. Deploy from GitHub repository
2. Platform auto-detects Dockerfile
3. Set environment variable: `LAW_OC=your-api-key`
4. SSE endpoint available at: `https://your-app.railway.app/sse`

## Important Implementation Notes

### LexDiff Code Reuse
- `search-normalizer.ts` and `law-parser.ts` are imported from LexDiff project
- These modules have been battle-tested in production
- `debugLogger` calls removed during import
- Do not modify core normalization logic without consulting LexDiff source

### XML vs JSON API Responses
- `searchLaw`: Returns XML (parsed in tool layer)
- `getLawText`: Returns JSON
- `compareOldNew`: Returns XML
- `getThreeTier`: Returns JSON

### Error Handling
- API client checks for HTML error pages disguised as responses
- Zod schema validation on all tool inputs
- Tool errors wrapped in MCP error response format

### JO Code Format
- Always 6 digits: `AAAABB`
- AAAA: Article number (zero-padded)
- BB: Branch number (00 if none)
- Examples: 000500 (제5조), 003800 (제38조), 001002 (제10조의2)

## File Size Management

All source files are under 200 lines. When adding features:
- Keep tool implementations focused and single-purpose
- Extract shared logic to `src/lib/`
- Split large parsers into separate modules
