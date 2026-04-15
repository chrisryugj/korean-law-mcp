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
import { VERSION } from "../version.js"
import { type ToolProfile, parseProfile } from "../lib/tool-profiles.js"

export async function startHTTPServer(createServer: (profile?: ToolProfile) => Server, port: number) {
  const app = express()
  // Fly.io proxy 뒤에서 실제 클라이언트 IP 인식 (rate limit per-IP 정상 동작)
  app.set("trust proxy", true)
  app.use(express.json({ limit: "100kb" }))

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
        "mcp-lite": "/mcp?profile=lite",
        health: "/health"
      },
      profiles: {
        lite: "14 tools (chains + meta, for web clients)",
        full: "all tools (default)"
      }
    })
  })

  app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() })
  })

  // POST /mcp - stateless 요청 처리
  app.post("/mcp", async (req, res) => {
    // Extract API key: URL query > header
    const apiKeyFromQuery = req.query.oc as string | undefined
    const apiKey =
      apiKeyFromQuery ||
      (req.headers["apikey"] as string | undefined) ||
      (req.headers["law_oc"] as string | undefined) ||
      (req.headers["law-oc"] as string | undefined) ||
      (req.headers["x-api-key"] as string | undefined) ||
      (req.headers["authorization"] as string | undefined)?.replace(/^Bearer\s+/i, "") ||
      (req.headers["x-law-oc"] as string | undefined)

    const profile = parseProfile(req.query.profile as string | undefined)

    let server: Server | undefined
    let transport: StreamableHTTPServerTransport | undefined

    try {
      server = createServer(profile)
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
      console.error("[POST /mcp] Error:", error)
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

  // 종료 처리
  async function gracefulShutdown(signal: string) {
    console.error(`${signal} received, shutting down server...`)
    expressServer.close()
    console.error("Server shutdown complete")
    process.exit(0)
  }

  process.on("SIGINT", () => gracefulShutdown("SIGINT"))
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))
}
