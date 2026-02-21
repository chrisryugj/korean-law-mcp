/**
 * Streamable HTTP 서버 - 리모트 배포용 (MCP 표준)
 */

import express from "express"
import { randomUUID } from "node:crypto"
import type { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { InMemoryEventStore } from "@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js"
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"
import { sessionStore, setSessionApiKey, deleteSession } from "../lib/session-state.js"

// 세션 정보 (Transport + 마지막 접근 시간)
interface SessionInfo {
  transport: StreamableHTTPServerTransport
  lastAccess: number
}

// 세션 맵
const sessions = new Map<string, SessionInfo>()

export async function startHTTPServer(server: Server, port: number) {
  const app = express()
  app.use(express.json())

  // 30분 idle 세션 자동 정리 (5분마다 체크)
  const SESSION_MAX_IDLE = 30 * 60 * 1000 // 30분
  setInterval(() => {
    const now = Date.now()
    for (const [sessionId, session] of sessions) {
      if (now - session.lastAccess > SESSION_MAX_IDLE) {
        console.error(`[Session Cleanup] Removing idle session: ${sessionId}`)
        try {
          session.transport.close()
        } catch { /* ignore */ }
        sessions.delete(sessionId)
        deleteSession(sessionId)
      }
    }
  }, 5 * 60 * 1000)

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
    }, 5 * 60 * 1000)
  }

  // CORS 및 보안 헤더 설정
  const corsOrigin = process.env.CORS_ORIGIN || "*"
  app.use((req, res, next) => {
    // CORS
    res.header("Access-Control-Allow-Origin", corsOrigin)
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
    res.header("Access-Control-Allow-Headers", "Content-Type, mcp-session-id, last-event-id")
    // Security headers
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
      version: "1.7.0",
      status: "running",
      transport: "streamable-http",
      endpoints: {
        mcp: "/mcp",
        health: "/health"
      }
    })
  })

  app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() })
  })

  // POST /mcp - 클라이언트 요청 처리
  app.post("/mcp", async (req, res) => {
    console.error(`[POST /mcp] Received request`)

    // Extract API key from various possible header locations
    const apiKeyFromHeader =
      req.headers["apikey"] ||
      req.headers["law_oc"] ||
      req.headers["law-oc"] ||
      (req.headers["LAW_OC"] as string | undefined) ||
      req.headers["x-api-key"] ||
      req.headers["authorization"]?.replace(/^Bearer\s+/i, "") ||
      req.headers["x-law-oc"]

    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined
      let transport: StreamableHTTPServerTransport

      const existingSession = sessionId ? sessions.get(sessionId) : undefined

      if (existingSession) {
        // 기존 세션 재사용
        console.error(`[POST /mcp] Reusing session: ${sessionId}`)
        transport = existingSession.transport
        existingSession.lastAccess = Date.now()

        // API 키 업데이트 (헤더에서 제공된 경우)
        if (apiKeyFromHeader) {
          setSessionApiKey(sessionId!, apiKeyFromHeader as string)
        }

        // AsyncLocalStorage로 세션 ID 격리 (동시 요청 안전)
        await sessionStore.run(sessionId, async () => {
          await transport.handleRequest(req, res, req.body)
        })
        return
      } else if (sessionId && !existingSession) {
        // 세션 ID가 있지만 서버에 없음 (suspend 후 재시작 등)
        // MCP 스펙: 404 반환 → 클라이언트가 새 세션으로 재초기화
        console.error(`[POST /mcp] Unknown session ID: ${sessionId} (returning 404 for re-init)`)
        res.status(404).json({
          jsonrpc: "2.0",
          error: {
            code: -32001,
            message: "Session not found. Please reinitialize."
          },
          id: null
        })
        return
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // 새 세션 초기화
        console.error(`[POST /mcp] New initialization request`)

        const eventStore = new InMemoryEventStore()
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          eventStore,
          onsessioninitialized: (sid) => {
            console.error(`[POST /mcp] Session initialized: ${sid}`)
            sessions.set(sid, {
              transport,
              lastAccess: Date.now()
            })
            if (apiKeyFromHeader) {
              setSessionApiKey(sid, apiKeyFromHeader as string)
            }
          }
        })

        // Transport 종료 시 정리
        transport.onclose = () => {
          const sid = transport.sessionId
          if (sid && sessions.has(sid)) {
            console.error(`[POST /mcp] Transport closed for session ${sid}`)
            sessions.delete(sid)
            deleteSession(sid)
          }
        }

        // MCP 서버에 연결
        await server.connect(transport)
        await transport.handleRequest(req, res, req.body)
        return
      } else {
        // 잘못된 요청
        console.error(`[POST /mcp] Invalid request: No valid session ID or init request`)
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: No valid session ID provided"
          },
          id: null
        })
        return
      }
    } catch (error) {
      console.error("[POST /mcp] Error:", error)
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error"
          },
          id: null
        })
      }
    }
  })

  // GET /mcp - SSE 스트림 (서버 알림용)
  app.get("/mcp", async (req, res) => {
    console.error(`[GET /mcp] SSE stream request`)

    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined
      const session = sessionId ? sessions.get(sessionId) : undefined

      if (!session) {
        // MCP 스펙: 모르는 세션 → 404 (클라이언트 재초기화 유도)
        console.error(`[GET /mcp] Unknown session ID: ${sessionId} (returning 404)`)
        res.status(404).send("Session not found. Please reinitialize.")
        return
      }

      session.lastAccess = Date.now()

      res.on("close", () => {
        console.error(`[GET /mcp] SSE connection closed for session ${sessionId}`)
      })

      await session.transport.handleRequest(req, res)
    } catch (error) {
      console.error("[GET /mcp] Error:", error)
      if (!res.headersSent) {
        res.status(500).send("Internal server error")
      }
    }
  })

  // DELETE /mcp - 세션 종료
  app.delete("/mcp", async (req, res) => {
    console.error(`[DELETE /mcp] Session termination request`)

    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined
      const session = sessionId ? sessions.get(sessionId) : undefined

      if (!session) {
        // 이미 없는 세션 → 404 (idempotent하게 처리)
        console.error(`[DELETE /mcp] Unknown session ID: ${sessionId} (returning 404)`)
        res.status(404).send("Session not found")
        return
      }

      await session.transport.handleRequest(req, res)
      sessions.delete(sessionId!)
      deleteSession(sessionId!)
      console.error(`[DELETE /mcp] Session removed: ${sessionId}`)
    } catch (error) {
      console.error("[DELETE /mcp] Error:", error)
      if (!res.headersSent) {
        res.status(500).send("Error processing session termination")
      }
    }
  })

  // 서버 시작 (0.0.0.0으로 바인딩하여 외부 접속 허용)
  const expressServer = app.listen(port, "0.0.0.0", () => {
    console.error(`✓ Korean Law MCP server (HTTP mode) listening on port ${port}`)
    console.error(`✓ MCP endpoint: http://0.0.0.0:${port}/mcp`)
    console.error(`✓ Health check: http://0.0.0.0:${port}/health`)
    console.error(`✓ Transport: Streamable HTTP`)
  })

  // 종료 처리
  async function gracefulShutdown(signal: string) {
    console.error(`${signal} received, shutting down server...`)

    for (const [sessionId, session] of sessions) {
      try {
        await session.transport.close()
        sessions.delete(sessionId)
        deleteSession(sessionId)
      } catch (error) {
        console.error(`Error closing transport for session ${sessionId}:`, error)
      }
    }

    expressServer.close()
    await server.close()
    console.error("Server shutdown complete")
    process.exit(0)
  }

  process.on("SIGINT", () => gracefulShutdown("SIGINT"))
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))
}
