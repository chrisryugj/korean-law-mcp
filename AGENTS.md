# AGENTS.md

## Node HTTPS/proxy debugging

When fixing external legal-data providers in this repo, do not start with retries, sleeps, or iframe polling. First isolate whether the failure is data parsing, HTTP status handling, TLS, or proxy routing.

Important facts:

- Browser success does not prove Node.js success. Browsers may use different proxy and CA settings.
- `LAW_API_PROTOCOL` only controls the Law OpenAPI base URL (`www.law.go.kr/DRF`). It does not make other providers avoid HTTPS.
- Some external providers, including `taxlaw.nts.go.kr`, redirect HTTP to HTTPS.
- Never expose `LAW_OC`, `OC`, or other API keys in logs, PR text, screenshots, or test output.

For proxy-only environments:

- Use `LAW_EXTERNAL_HTTPS_PROXY=http://proxy-host:port` for the MCP-controlled external HTTPS proxy path.
- Use the actual proxy endpoint, not a PAC script URL.
- Use `LAW_EXTERNAL_TLS_REJECT_UNAUTHORIZED=0` only as a scoped, temporary diagnostic setting for the external proxy path.
- Do not add global `NODE_TLS_REJECT_UNAUTHORIZED=0` behavior in code.

Suggested investigation order:

1. Confirm the failing provider URL and whether the failing code path uses Node `fetch()`, `https.request`, or a custom helper.
2. Probe Node connectivity directly from the same runtime account that runs the MCP server.
3. If proxy routing is suspected, verify `CONNECT host:443` against the actual proxy endpoint before changing application code.
4. Keep fixes scoped to the failing provider path unless multiple providers are proven affected.
