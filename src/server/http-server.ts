/**
 * Streamable HTTP 서버 - stateless 모드 (MCP 공식 패턴)
 *
 * 매 POST 요청마다 fresh Server + Transport 생성, 요청 종료 시 즉시 정리.
 * 세션 Map/EventStore/idle cleanup 없음 → 재시작/스케일아웃/OOM 내성.
 * 참고: @modelcontextprotocol/sdk/examples/server/simpleStatelessStreamableHttp.js
 */

import express from "express"
import type { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { requestContext } from "../lib/session-state.js"
import { maskSensitiveUrl } from "../lib/fetch-with-retry.js"
import { TOOL_COUNTS } from "../tool-registry.js"
import { VERSION } from "../version.js"

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

export async function startHTTPServer(createServer: () => Server, port: number) {
  const app = express()
  // trust proxy: TRUST_PROXY 환경변수로 조정 (기본 '1' = 첫 프록시만 신뢰).
  // 'true' 또는 'all'은 X-Forwarded-For 스푸핑으로 rate limit 우회 위험.
  // Fly.io는 edge proxy 1단 → '1' 권장. 다단 프록시면 숫자 증가.
  const trustProxyRaw = process.env.TRUST_PROXY ?? "1"
  const trustProxy: number | boolean | string =
    trustProxyRaw === "true" || trustProxyRaw === "all"
      ? true
      : trustProxyRaw === "false"
      ? false
      : /^\d+$/.test(trustProxyRaw)
      ? parseInt(trustProxyRaw, 10)
      : trustProxyRaw // CIDR/IP 리스트 패스스루
  app.set("trust proxy", trustProxy)
  app.use(express.json({ limit: process.env.MCP_BODY_LIMIT || "100kb" }))

  // Rate Limiting (RATE_LIMIT_RPM 환경변수, 기본: 60 req/min per IP)
  const rateLimitRpm = parseInt(process.env.RATE_LIMIT_RPM || "60", 10)
  const rateBuckets = new Map<string, { count: number; resetAt: number }>()

  if (rateLimitRpm > 0) {
    app.use((req, res, next) => {
      if (req.path === "/health" || req.path === "/") return next()

      const ip = req.ip || req.socket.remoteAddress || "unknown"
      const now = Date.now()
      let bucket = rateBuckets.get(ip)

      if (!bucket || now >= bucket.resetAt) {
        bucket = { count: 0, resetAt: now + 60_000 }
        rateBuckets.set(ip, bucket)
      }

      bucket.count++

      if (bucket.count > rateLimitRpm) {
        res.status(429).json({ error: "Too many requests. Try again later." })
        return
      }
      next()
    })

    // 5분마다 만료된 버킷 정리
    setInterval(() => {
      const now = Date.now()
      for (const [ip, bucket] of rateBuckets) {
        if (now >= bucket.resetAt) rateBuckets.delete(ip)
      }
    }, 5 * 60 * 1000).unref()
  }

  // CORS 및 보안 헤더 설정 (CORS_ORIGIN 미설정 시 경고)
  const corsOrigin = process.env.CORS_ORIGIN || "*"
  if (corsOrigin === "*") {
    console.error("⚠️  CORS_ORIGIN 미설정 — 모든 도메인 허용 중. 프로덕션에서는 CORS_ORIGIN 환경변수를 설정하세요.")
  }
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", corsOrigin)
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
    res.header("Access-Control-Allow-Headers", "Content-Type, mcp-session-id, last-event-id")
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
  const fallbackRpm = parseInt(process.env.FALLBACK_RATE_LIMIT_RPM || "120", 10)
  const fallbackBucket = { count: 0, resetAt: 0 }
  function fallbackAllowed(): boolean {
    if (fallbackRpm <= 0) return false
    const now = Date.now()
    if (now >= fallbackBucket.resetAt) {
      fallbackBucket.count = 0
      fallbackBucket.resetAt = now + 60_000
    }
    return ++fallbackBucket.count <= fallbackRpm
  }

  // POST /mcp - stateless 요청 처리
  app.post("/mcp", async (req, res) => {
    // Extract API key: header > URL query
    // 쿼리스트링 키는 프록시/엣지 액세스 로그에 평문으로 남으므로 헤더 사용 권장 (하위호환용 유지)
    const apiKey =
      (req.headers["apikey"] as string | undefined) ||
      (req.headers["law_oc"] as string | undefined) ||
      (req.headers["law-oc"] as string | undefined) ||
      (req.headers["x-api-key"] as string | undefined) ||
      (req.headers["authorization"] as string | undefined)?.replace(/^Bearer\s+/i, "") ||
      (req.headers["x-law-oc"] as string | undefined) ||
      (req.query.oc as string | undefined)

    // 자체 키 없는 요청은 서버 LAW_OC로 폴백 — 전역 상한 적용
    if (!apiKey && !fallbackAllowed()) {
      res.status(429).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Shared API quota exceeded. Provide your own key via 'apiKey' header (free: https://open.law.go.kr)." },
        id: null,
      })
      return
    }

    let server: Server | undefined
    let transport: StreamableHTTPServerTransport | undefined

    try {
      server = createServer()
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,  // ← stateless 모드
        enableJsonResponse: true,
      })

      // 요청 종료 시 리소스 정리
      res.on("close", () => {
        try { transport?.close() } catch { /* ignore */ }
        server?.close().catch(() => {})
      })

      await server.connect(transport)

      // ALS로 요청 단위 API 키 격리 (동시 요청 안전)
      await requestContext.run({ apiKey }, async () => {
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

  // 서버 시작 (0.0.0.0으로 바인딩하여 외부 접속 허용)
  const expressServer = app.listen(port, "0.0.0.0", () => {
    console.error(`✓ Korean Law MCP server (HTTP stateless) listening on port ${port}`)
    console.error(`✓ MCP endpoint: http://0.0.0.0:${port}/mcp`)
    console.error(`✓ Health check: http://0.0.0.0:${port}/health`)
  })

  // 종료 처리 — in-flight 요청 완료 대기 (최대 10초), 이후 강제 종료
  function gracefulShutdown(signal: string) {
    console.error(`${signal} received, shutting down server...`)
    const forceExit = setTimeout(() => {
      console.error("Shutdown timeout (10s) — forcing exit")
      process.exit(1)
    }, 10_000)
    forceExit.unref()
    expressServer.close(() => {
      clearTimeout(forceExit)
      console.error("Server shutdown complete")
      process.exit(0)
    })
  }

  process.on("SIGINT", () => gracefulShutdown("SIGINT"))
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))
}
