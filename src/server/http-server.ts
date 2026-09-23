/**
 * Streamable HTTP 서버 - stateless 모드 (MCP 공식 패턴)
 *
 * 매 POST 요청마다 fresh Server + Transport 생성, 요청 종료 시 즉시 정리.
 * 세션 Map/EventStore/idle cleanup 없음 → 재시작/스케일아웃/OOM 내성.
 * 참고: @modelcontextprotocol/sdk/examples/server/simpleStatelessStreamableHttp.js
 */

import express from "express"
import { timingSafeEqual } from "node:crypto"
import type { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { requestContext } from "../lib/session-state.js"
import { createTokenBucket, createDailyCap } from "../lib/rate-limit.js"
import { RequestExecutionBudget, type ExecutionLimits } from "../lib/execution-limits.js"
import { maskSensitiveUrl } from "../lib/fetch-with-retry.js"
import { TOOL_COUNTS } from "../tool-registry.js"
import { VERSION } from "../version.js"
import { readHttpServerConfig } from "./http-config.js"

/** 타이밍 공격 내성 문자열 비교 (길이가 달라도 throw하지 않음) */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/** `Authorization: Bearer x` → `x` (Bearer 접두사가 없으면 원문) */
function bearerValue(raw: string | undefined): string {
  return raw ? raw.replace(/^Bearer\s+/i, "") : ""
}

/**
 * 에러 메시지에서 민감 정보(API 키 포함 URL) scrub.
 * MCP 응답/서버 로그 양쪽에 적용되어야 함.
 */
function scrubError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: maskSensitiveUrl(error.message),
      stack: error.stack ? maskSensitiveUrl(error.stack) : undefined,
    }
  }
  return { message: maskSensitiveUrl(String(error)) }
}

/** Count executable calls in an already-parsed JSON-RPC envelope. */
export function countToolCalls(body: unknown): number {
  const messages = Array.isArray(body) ? body : [body]
  return messages.filter(message =>
    typeof message === "object" && message !== null && (message as { method?: unknown }).method === "tools/call",
  ).length
}

export function exceedsBatchLimit(body: unknown, maxBatchCalls: number): boolean {
  return countToolCalls(body) > maxBatchCalls
}

/** 로그용 봉투 요약: method 와 id·params 의 '타입'만 싣는다(값은 안 싣는다) */
export function describeEnvelope(body: unknown): string {
  const messages = Array.isArray(body) ? body : [body]
  const typeOf = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v)
  const one = (m: unknown): string => {
    if (typeof m !== "object" || m === null) return typeOf(m)
    const r = m as Record<string, unknown>
    // method 는 클라이언트가 보낸 문자열이라 개행을 넣어 로그 줄을 위조할 수 있다: 안전한 문자만 남긴다
    const kind = typeof r.method === "string" ? r.method.slice(0, 40).replace(/[^\w/.:-]/g, "?") : ("result" in r || "error" in r) ? "response" : "?"
    return `${kind}(id:${typeOf(r.id)},params:${typeOf(r.params)})`
  }
  const head = messages.slice(0, 3).map(one).join(" ")
  return messages.length > 3 ? `${head} +${messages.length - 3}` : head
}

export async function startHTTPServer(
  createServer: (executionLimits: ExecutionLimits) => Server,
  port: number,
) {
  // Parse every security boundary before the listener is opened.  A bad value
  // must fail startup, not degrade into NaN and disable a comparison later.
  const config = readHttpServerConfig()
  const app = express()
  // Direct deployments must not trust a spoofable X-Forwarded-For header.
  // A reverse-proxy deployment opts in with a bounded numeric hop count.
  app.set("trust proxy", config.trustProxy)

  // ACCESS_LOG=1 일 때만 요청 로그 — req.path만 기록 (쿼리스트링의 oc= API 키 유출 방지)
  if (process.env.ACCESS_LOG === "1") {
    app.use((req, _res, next) => {
      console.error(`[access] ${req.method} ${req.path} ip=${req.ip} ua="${req.headers["user-agent"] ?? "-"}"`)
      next()
    })
  }

  // ── Origin 검증 (DNS rebinding 방어) ──────────────────────────────────────
  // MCP 명세는 로컬/원격 HTTP 트랜스포트에 Origin 검증을 요구한다. 브라우저가 심은
  // Origin을 그대로 통과시키면, 사용자가 악성 페이지를 여는 것만으로 그 페이지가
  // 이 서버를 대신 호출하고 응답까지 읽어갈 수 있다(CORS가 '*'면 특히).
  // 정책: Origin 헤더가 없는 요청(일반 MCP 클라이언트·서버간 호출)은 그대로 통과.
  //       Origin이 있으면 ALLOWED_ORIGINS 화이트리스트에 있어야 한다.
  //       CORS_ORIGIN을 명시적으로 설정한 경우 그 값도 허용 목록으로 취급한다.
  const corsOriginConfigured = process.env.CORS_ORIGIN !== undefined
  const corsOrigin = process.env.CORS_ORIGIN || "*"
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(o => o.trim())
    .filter(Boolean)
  if (!corsOriginConfigured && allowedOrigins.length === 0) {
    console.error("ℹ️  ALLOWED_ORIGINS 미설정 — Origin 헤더가 붙은 브라우저 요청은 차단됩니다 (DNS rebinding 방어). 웹 클라이언트를 쓰려면 ALLOWED_ORIGINS를 설정하세요.")
  }

  /** 이 Origin을 허용할지 판정. 반환값은 응답에 실을 ACAO 값(null이면 거부) */
  function resolveOrigin(origin: string | undefined): string | null {
    if (!origin) return corsOrigin // 브라우저가 아닌 클라이언트
    if (allowedOrigins.includes(origin)) return origin
    if (allowedOrigins.length === 0 && corsOriginConfigured) {
      if (corsOrigin === "*") return "*"
      if (corsOrigin === origin) return origin
    }
    return null
  }

  app.use((req, res, next) => {
    if (req.path === "/health" || req.path === "/") return next()
    const origin = req.headers.origin as string | undefined
    const allowed = resolveOrigin(origin)
    if (allowed === null) {
      res.status(403).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Origin not allowed." },
        id: null,
      })
      return
    }
    res.header("Access-Control-Allow-Origin", allowed)
    if (allowed !== "*") res.header("Vary", "Origin")
    next()
  })

  // ── 접근 인증 (MCP_AUTH_TOKEN 설정 시에만 활성) ────────────────────────────
  // 폐쇄망·사내망 배포처럼 서버 자체에 접근 통제가 필요한 환경에서 설정한다.
  // 미설정이면 기존처럼 공개 동작 (법제처 API 키는 인가 수단이 아니다).
  const authToken = config.authToken
  if (!authToken) {
    if (config.allowUnauthenticatedRemote) {
      console.error("⚠️  MCP_ALLOW_UNAUTHENTICATED_REMOTE=1 — non-loopback /mcp is intentionally unauthenticated.")
    } else {
      console.error("ℹ️  MCP_AUTH_TOKEN 미설정 — loopback HTTP only. Remote exposure requires MCP_AUTH_TOKEN or an explicit override.")
    }
  }
  app.use((req, res, next) => {
    if (!authToken) return next()
    if (req.method === "OPTIONS") return next() // 프리플라이트는 인증 헤더를 못 싣는다
    if (req.path === "/health" || req.path === "/") return next()

    const presented =
      (req.headers["x-mcp-token"] as string | undefined) ||
      bearerValue(req.headers["authorization"] as string | undefined)

    if (!presented || !safeEqual(presented, authToken)) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized." },
        id: null,
      })
      return
    }
    next()
  })

  app.use(express.json({ limit: config.bodyLimitBytes }))

  // Rate Limiting (RATE_LIMIT_RPM 환경변수, 기본: 60 req/min per IP)
  const rateLimitRpm = config.rateLimitRpm
  const rateBuckets = new Map<string, { count: number; resetAt: number }>()

  // 단일 POST에 담을 수 있는 tools/call 상한. JSON-RPC 배치는 배열의 요청을
  // 전부 디스패치하므로(SDK 확인), 카운트 없이 두면 한 요청으로 rate limit·폴백
  // 쿼터를 배수만큼 우회할 수 있다. 배치 크기를 제한해 증폭을 원천 차단한다.
  const maxBatchCalls = config.maxBatchCalls

  // Batch work is bounded whether or not the optional per-IP rate limiter is
  // enabled.  Otherwise RATE_LIMIT_RPM=0 accidentally turns off this guard.
  app.use((req, res, next) => {
    if (req.path === "/health" || req.path === "/") return next()

    // 핸드셰이크(initialize)·도구목록(tools/list)·알림은 rate limit 제외.
    // 이들이 429를 맞으면 클라이언트가 도구 목록을 못 받아 "도구 못 찾음"이 된다.
    // claude.ai 커넥터는 소수 egress IP로 트래픽이 몰려 IP 버킷을 공유하므로,
    // 비용 소모 요청(tools/call)에만 게이트한다. (v4.6.2 폴백 게이트와 동일 원칙)
    // 배치는 tools/call '개수'만큼 카운트한다 (요청당 1회가 아님 — 배치 증폭 방지).
    const callCount = countToolCalls(req.body)
    if (callCount === 0) return next()

    if (exceedsBatchLimit(req.body, maxBatchCalls)) {
      res.status(429).json({ error: `Too many tool calls in one request (max ${maxBatchCalls}).` })
      return
    }

    if (rateLimitRpm === 0) return next()

    const ip = req.ip || req.socket.remoteAddress || "unknown"
    const now = Date.now()
    let bucket = rateBuckets.get(ip)

    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + 60_000 }
      rateBuckets.set(ip, bucket)
    }

    bucket.count += callCount

    if (bucket.count > rateLimitRpm) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
      res.setHeader("Retry-After", String(retryAfterSec))
      res.status(429).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: `Too many requests — retry in ${retryAfterSec}s.` },
        id: null,
      })
      return
    }
    next()
  })

  if (rateLimitRpm > 0) {
    // 5분마다 만료된 버킷 정리
    setInterval(() => {
      const now = Date.now()
      for (const [ip, bucket] of rateBuckets) {
        if (now >= bucket.resetAt) rateBuckets.delete(ip)
      }
    }, 5 * 60 * 1000).unref()
  }

  // 보안 헤더 (Access-Control-Allow-Origin은 위 Origin 검증 미들웨어가 설정)
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
    res.header("Access-Control-Allow-Headers", "Content-Type, mcp-session-id, last-event-id, apikey, x-api-key, x-mcp-token, authorization")
    res.header("X-Content-Type-Options", "nosniff")
    res.header("X-Frame-Options", "DENY")
    res.header("Referrer-Policy", "strict-origin-when-cross-origin")
    if (req.method === "OPTIONS") {
      return res.sendStatus(200)
    }
    next()
  })

  // 헬스체크 엔드포인트
  app.get("/", (req, res) => {
    res.json({
      name: "Korean Law MCP Server",
      version: VERSION,
      status: "running",
      transport: "streamable-http (stateless)",
      endpoints: {
        mcp: "/mcp",
        health: "/health",
      },
      tools: {
        exposed: TOOL_COUNTS.exposed,
        total: TOOL_COUNTS.total,
        description: `V3_EXPOSED ${TOOL_COUNTS.exposed}개 직노출, 나머지 ${TOOL_COUNTS.total - TOOL_COUNTS.exposed}개는 execute_tool 경유`,
      },
    })
  })

  app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() })
  })

  // 서버 LAW_OC 폴백 사용량 전역 상한 — 키 없는 분산 요청이 서버 키의 법제처 quota를
  // 소진시키는 것 방지 (IP당 limit만으로는 막을 수 없음). 0이면 폴백 비활성.
  //
  // 이 게이트는 자체 키 없는 사용자 '전원'이 공유한다. 고정창이던 시절엔 창 초반
  // 몇 명이 다 쓰면 나머지가 남은 창 내내 429를 맞았다 — 실측으로 무키 요청의
  // 2/3가 즉시 429였다(2026-08-12). 토큰버킷으로 바꿔 같은 평균 처리율에서
  // 버스트를 흡수하고, 총량 보호는 일일 캡으로 따로 건다.
  const fallbackMinute = createTokenBucket(config.fallbackRpm, config.fallbackBurst)
  const fallbackDay = createDailyCap(config.fallbackDailyCap)
  // n = 이 요청이 소모하는 tools/call 개수 (배치는 배열 길이만큼 서버 키를 쓴다)
  function fallbackAllowed(n: number): { ok: boolean; retryAfterSec: number; daily: boolean } {
    const minute = fallbackMinute.take(n)
    if (!minute.ok) return { ...minute, daily: false }
    // 분당 게이트를 통과한 요청만 일일 총량을 소모한다 (거부분 낭비 방지)
    const day = fallbackDay.take(n)
    return { ok: day.ok, retryAfterSec: day.retryAfterSec, daily: !day.ok }
  }

  // POST /mcp - stateless 요청 처리
  app.post("/mcp", async (req, res) => {
    // Extract API key: header > URL query
    // 쿼리스트링 키는 프록시/엣지 액세스 로그에 평문으로 남으므로 헤더 사용 권장.
    // ALLOW_QUERY_API_KEY=0 으로 쿼리 경로를 차단할 수 있다 (폐쇄망 권장).
    // 인증이 켜진 경우 Authorization 헤더는 접근 토큰이므로 법제처 키로 오인하면 안 된다.
    const authHeader = bearerValue(req.headers["authorization"] as string | undefined)
    const authHeaderIsAccessToken = Boolean(authToken) && authHeader && safeEqual(authHeader, authToken)
    const queryKey = process.env.ALLOW_QUERY_API_KEY === "0" ? undefined : (req.query.oc as string | undefined)
    const apiKey =
      (req.headers["apikey"] as string | undefined) ||
      (req.headers["law_oc"] as string | undefined) ||
      (req.headers["law-oc"] as string | undefined) ||
      (req.headers["x-api-key"] as string | undefined) ||
      (authHeaderIsAccessToken ? undefined : authHeader || undefined) ||
      (req.headers["x-law-oc"] as string | undefined) ||
      queryKey

    // 자체 키 없는 요청은 서버 LAW_OC로 폴백 — 전역 상한 적용
    // initialize/tools/list 등 핸드셰이크는 법제처 쿼터를 안 쓰므로 tools/call만 게이트
    // (핸드셰이크까지 429로 막으면 claude.ai 커넥터가 도구 목록 자체를 못 싣는다)
    const fallbackCallCount = countToolCalls(req.body)
    if (!apiKey && fallbackCallCount > 0) {
      const verdict = fallbackAllowed(fallbackCallCount)
      if (!verdict.ok) {
        res.setHeader("Retry-After", String(verdict.retryAfterSec))
        res.status(429).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: verdict.daily
              ? "Shared API daily cap reached. Provide your own key via 'apiKey' header (free: https://open.law.go.kr)."
              : `Shared API quota exceeded — retry in ${verdict.retryAfterSec}s, or provide your own key via 'apiKey' header (free: https://open.law.go.kr).`,
          },
          id: null,
        })
        return
      }
    }

    let server: Server | undefined
    let transport: StreamableHTTPServerTransport | undefined

    try {
      server = createServer(config.executionLimits)
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,  // ← stateless 모드
        enableJsonResponse: true,
      })
      // SDK 가 요청을 거절한 사유(400 등)는 onerror 로만 나온다. 안 받으면 로그엔 launcher 의
      // `[edge] … -> 400` 만 남아 원인을 가를 수 없다. 2026-09-23 실측: claude.ai 커넥터 POST 의
      // 약 15% 가 400 이었고 직후 재초기화로 성공하는 패턴이었다(사유 미상).
      server.onerror = (error) => {
        const pv = String(req.headers["mcp-protocol-version"] ?? "-").slice(0, 40)
        console.error(`[mcp] ${scrubError(error).message.replace(/\s+/g, " ").slice(0, 200)} body=${describeEnvelope(req.body)} pv=${pv} ua="${req.headers["user-agent"] ?? "-"}"`)
      }

      // Disconnecting the HTTP client must stop its upstream work.  This is
      // deliberately separate from MCP's item cancellation signal: sibling
      // batch items share a budget but retain separate cancellation signals.
      const connectionAbort = new AbortController()
      const abortConnection = () => {
        if (!connectionAbort.signal.aborted) connectionAbort.abort("HTTP client disconnected")
      }
      req.once("aborted", abortConnection)

      // 요청 종료 시 리소스 정리
      res.on("close", () => {
        if (!res.writableEnded) abortConnection()
        try { transport?.close() } catch { /* ignore */ }
        server?.close().catch(() => {})
      })

      await server.connect(transport)

      // ALS로 요청 단위 API 키 격리 (동시 요청 안전)
      await requestContext.run({
        apiKey,
        signal: connectionAbort.signal,
        budget: new RequestExecutionBudget(config.executionLimits),
      }, async () => {
        await transport!.handleRequest(req, res, req.body)
      })
    } catch (error) {
      const scrubbed = scrubError(error)
      console.error("[POST /mcp] Error:", scrubbed.message)
      if (scrubbed.stack && process.env.NODE_ENV !== "production") {
        console.error(scrubbed.stack)
      }
      try { transport?.close() } catch { /* ignore */ }
      server?.close().catch(() => {})
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null
        })
      }
    }
  })

  // GET/DELETE /mcp - stateless 모드에서는 불허 (MCP 공식 예제와 동일)
  app.get("/mcp", (req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. Server runs in stateless mode." },
      id: null
    })
  })

  app.delete("/mcp", (req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. Server runs in stateless mode." },
      id: null
    })
  })

  // 최종 에러 핸들러 — Express 기본 핸들러는 스택 트레이스와 설치 경로를 그대로
  // 본문에 실어 보낸다(NODE_ENV 미설정 시). body-parser의 413/400도 여기로 온다.
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = typeof err?.status === "number" ? err.status : 500
    const scrubbed = scrubError(err)
    console.error(`[express] ${status} ${scrubbed.message}`)
    if (res.headersSent) return
    res.status(status).json({
      jsonrpc: "2.0",
      error: {
        code: status === 413 ? -32600 : -32603,
        message: status === 413 ? "Request entity too large." : "Internal server error",
      },
      id: null,
    })
  })

  // 서버 시작.  Loopback is the safe default; remote exposure is an explicit
  // MCP_HTTP_HOST configuration validated above.
  const expressServer = app.listen(port, config.host, () => {
    console.error(`✓ Korean Law MCP server (HTTP stateless) listening on port ${port}`)
    console.error(`✓ MCP endpoint: http://${config.host}:${port}/mcp`)
    console.error(`✓ Health check: http://${config.host}:${port}/health`)
  })

  // 종료 처리 — in-flight 요청 완료 대기 (최대 10초), 이후 강제 종료
  function gracefulShutdown(signal: string) {
    console.error(`${signal} received, shutting down server...`)
    const forceExit = setTimeout(() => {
      console.error("Shutdown timeout (10s) — forcing exit")
      process.exit(0)
    }, 10_000)
    forceExit.unref()
    // idle keep-alive 연결은 close()가 안 끊는다 → 없으면 항상 10초 타임아웃 후
    // 비정상 종료로 기록됨. fly 롤링 배포의 clean exit을 위해 명시적으로 끊는다.
    expressServer.closeIdleConnections()
    expressServer.close(() => {
      clearTimeout(forceExit)
      console.error("Server shutdown complete")
      process.exit(0)
    })
  }

  process.on("SIGINT", () => gracefulShutdown("SIGINT"))
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))
}
