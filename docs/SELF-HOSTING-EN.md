# Self-hosting and corporate networks

[한국어](SELF-HOSTING.md) · [README](../README-EN.md)

Settings for running korean-law-mcp on your own machine or server instead of the hosted endpoint (`https://mcp.gomdori.app/law`): certificate and proxy issues on corporate or air-gapped networks, Docker, and the defaults and environment variables for HTTP deployments.

## 법제처 API protocol

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

## National Tax Service server: TLS and proxy

When a National Tax Service precedent body is missing from the 법제처 JSON response, and always for National Tax Service interpretation (`nts`) bodies, the server queries `taxlaw.nts.go.kr`. That server redirects HTTP to HTTPS, so regardless of `LAW_API_PROTOCOL=http` the Node.js runtime must trust the `https://taxlaw.nts.go.kr` certificate. Behind corporate networks, firewalls or SSL-inspection proxies the page may open in a browser while Node.js `fetch()` fails with `[EXTERNAL_API_ERROR] fetch failed` (different certificate store and proxy settings). Check the connection from Node.js first:

```bash
node -e "fetch('https://taxlaw.nts.go.kr/qt/USEQTA002P.do?ntstDcmId=200000000000019303').then(r=>console.log(r.status,r.url)).catch(e=>console.error(e.name,e.message,e.cause))"
```

If you must go through a web proxy, set its address (applies to the external HTTPS connection of the NTS precedent fallback and NTS interpretation bodies). On Windows, register the system variable from an administrator terminal with `setx`, then restart Windows or the Node.js process:

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

## Docker

```bash
docker build -t korean-law-mcp .
docker run -e LAW_OC=your-api-key -e MCP_HTTP_HOST=0.0.0.0 \
  -e MCP_AUTH_TOKEN=replace-with-a-secret -p 3000:3000 korean-law-mcp
```

## HTTP deployment defaults

HTTP mode is local by default: it binds only to `127.0.0.1`, does not trust `X-Forwarded-For`, and leaves token authentication optional for that loopback-only use. For a reverse-proxy deployment, set both the explicit public bind and the exact trusted hop count, for example:

```bash
MCP_HTTP_HOST=0.0.0.0 TRUST_PROXY=1 MCP_AUTH_TOKEN=replace-with-a-secret \
  korean-law-mcp --mode http --port 8000
```

- A non-loopback bind requires `MCP_AUTH_TOKEN`. `MCP_ALLOW_UNAUTHENTICATED_REMOTE=1` preserves intentionally public deployments but emits a startup warning; use it only where another access boundary is in place.
- **Set `ALLOWED_ORIGINS` for browser (web) clients.** For the Origin validation the MCP specification requires (DNS rebinding defense), requests carrying an `Origin` header pass only if listed in `ALLOWED_ORIGINS` (comma-separated). If it is empty, `CORS_ORIGIN` is used instead (`*` allows all origins, otherwise that one origin). With neither set, all browser requests are blocked and a notice is printed at startup. Once `ALLOWED_ORIGINS` is set, `CORS_ORIGIN` is not used for origin decisions.
- `ALLOW_QUERY_API_KEY=0` rejects the `?oc=` query-string API key. Query keys end up in proxy and edge access logs in plain text, so this is recommended on closed networks and wherever logs are collected. Header delivery (`apikey`, `law_oc`, and others) keeps working.
- `ACCESS_LOG=1` logs each request. Only the path is recorded, so the `oc=` key never reaches the log.
- `RATE_LIMIT_RPM=0` disables only the per-IP limiter. `MCP_MAX_BATCH_CALLS` (default 20), request body, upstream attempt and body, and tool response limits remain active.
- All numeric limits are validated as whole numbers during startup. Invalid values fail startup rather than weakening a limit. The older `MCP_BODY_LIMIT=100kb` is accepted for compatibility.
- `legal_research` and other chain tools share the 48-attempt request budget. JSON-RPC batch siblings share accounting but keep independent MCP cancellation signals. `get_batch_articles` is capped at 20 statutes and 100 articles in total. HTTP disconnects and MCP cancellations propagate through fetches, retry waits and body reads.

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LAW_OC` | Yes | none | 법제처 API key ([get one free](https://open.law.go.kr/LSO/openApi/guideResult.do)) |
| `LAW_API_PROTOCOL` | No | `https` | `http` for networks where HTTPS certificate validation fails |
| `LAW_EXTERNAL_HTTPS_PROXY` | No | none | Web proxy for the NTS precedent fallback and interpretation bodies (see above) |
| `LAW_USER_AGENT` / `LAW_REFERER` | No | none | Override the default User-Agent / Referer sent to 법제처 |
| `PORT` | No | 8000 | HTTP server port |
| `CORS_ORIGIN` | No | `*` | CORS allowed origin. Setting it explicitly also lets that origin pass Origin validation |
| `ALLOWED_ORIGINS` | No | none | Comma-separated origin allowlist. Requests carrying an `Origin` header are rejected unless listed (DNS rebinding defense). If neither this nor `CORS_ORIGIN` is set, all browser requests are blocked |
| `MCP_AUTH_TOKEN` | No | none | When set, `/mcp` requires `x-mcp-token` or `Authorization: Bearer`. Required for non-loopback deployments unless explicitly overridden |
| `MCP_HTTP_HOST` | No | `127.0.0.1` | Bind address. A non-loopback host requires `MCP_AUTH_TOKEN`, unless the deliberate override below is set |
| `MCP_ALLOW_UNAUTHENTICATED_REMOTE` | No | `0` | Set to `1` only for a deliberately public, non-loopback deployment without MCP access authentication |
| `TRUST_PROXY` | No | `false` | A positive proxy-hop count (for example `1` behind one proxy). Never use `true`/`all` |
| `ALLOW_QUERY_API_KEY` | No | `1` | Set to `0` to reject the `?oc=` query-string API key (it leaks into proxy access logs) |
| `ACCESS_LOG` | No | `0` | Set to `1` to log each request. Only `req.path` is recorded, never the query string |
| `RATE_LIMIT_RPM` | No | 60 | Requests per minute per IP. `0` disables only the per-IP limiter; batch and execution limits remain active |
| `FALLBACK_RATE_LIMIT_RPM` | No | 120 | Global limit for keyless requests that fall back to the server key (token bucket, 429 with `Retry-After`). `0` disables the fallback |
| `FALLBACK_RATE_LIMIT_BURST` | No | same as `FALLBACK_RATE_LIMIT_RPM` | Capacity of that token bucket |
| `FALLBACK_DAILY_CAP` | No | `0` | Rolling 24-hour cap on server-key fallback usage. `0` disables it |
| `MCP_MAX_BATCH_CALLS` | No | 20 | Maximum `tools/call` items in one JSON-RPC HTTP envelope |
| `MCP_MAX_BODY_BYTES` | No | 102400 | Maximum incoming JSON request size. The older `MCP_BODY_LIMIT` (`100kb`, etc.) is accepted for compatibility |
| `MCP_MAX_UPSTREAM_REQUESTS` | No | 48 | Request-wide upstream attempt budget, including retries and anti-bot hops |
| `MCP_MAX_UPSTREAM_BODY_BYTES` | No | 2097152 | Maximum bytes read from one upstream response body |
| `MCP_MAX_TOTAL_UPSTREAM_BODY_BYTES` | No | 8388608 | Maximum upstream body bytes read by one outer request |
| `MCP_MAX_TOOL_RESPONSE_CHARS` | No | 50000 | Maximum returned MCP tool-response characters |
| `MCP_CHAIN_DEADLINE_MS` | No | 45000 | Deadline for one chain. On expiry, the parts received so far are returned as a partial result with markers for the rest |

## Dependency and install boundary

`kordoc` remains because annex parsing is a reachable server feature. Its known-good pure-JS `pdfjs-dist@4.10.38` runtime is pinned as a normal dependency; optional OCR/ML/native helpers are not needed by this server, so documented, plugin and Docker installs use `--omit=optional --ignore-scripts`. CI and publishing retain optional development-tool bindings with scripts disabled during validation, then prune to the production graph and run the PDF annex smoke test. Before publishing, `build/` is removed and the actual pack files and exports are verified. Scanner reports for transitive HTTP-framework packages should be evaluated against the reachable server path rather than treated as proof that the server exposes the affected middleware.
