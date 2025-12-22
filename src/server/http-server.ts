/**
 * Streamable HTTP 서버 - 리모트 배포용 (MCP 표준)
 */

import express from "express"
import { randomUUID } from "node:crypto"
import type { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { InMemoryEventStore } from "@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js"
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"

export async function startHTTPServer(server: Server, port: number) {
  const app = express()
  app.use(express.json())

  // 세션 ID별 Transport 맵
  const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {}

  // CORS 설정
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*")
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
    res.header("Access-Control-Allow-Headers", "Content-Type, mcp-session-id, last-event-id")
    if (req.method === "OPTIONS") {
      return res.sendStatus(200)
    }
    next()
  })

  // 헬스체크 엔드포인트
  app.get("/", (req, res) => {
    res.json({
      name: "Korean Law MCP Server",
      version: "1.4.0",
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

    // Extract API key from various possible header locations (PlayMCP uses lowercase "apikey")
    const apiKeyFromHeader =
      req.headers["apikey"] ||
      req.headers["x-api-key"] ||
      req.headers["authorization"]?.replace(/^Bearer\s+/i, "") ||
      req.headers["x-law-oc"]

    if (apiKeyFromHeader) {
      process.env.LAW_OC = apiKeyFromHeader as string
      console.error(`[POST /mcp] ✓ API Key configured from HTTP header`)
    }

    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined
      let transport: StreamableHTTPServerTransport

      if (sessionId && transports[sessionId]) {
        // 기존 세션 재사용
        console.error(`[POST /mcp] Reusing session: ${sessionId}`)
        transport = transports[sessionId]
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
            transports[sid] = transport
          }
        })

        // Transport 종료 시 정리
        transport.onclose = () => {
          const sid = transport.sessionId
          if (sid && transports[sid]) {
            console.error(`[POST /mcp] Transport closed for session ${sid}`)
            delete transports[sid]
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

      // 기존 Transport로 요청 처리
      await transport.handleRequest(req, res, req.body)
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
      if (!sessionId || !transports[sessionId]) {
        console.error(`[GET /mcp] Invalid session ID: ${sessionId}`)
        res.status(400).send("Invalid or missing session ID")
        return
      }

      const transport = transports[sessionId]

      res.on("close", () => {
        console.error(`[GET /mcp] SSE connection closed for session ${sessionId}`)
      })

      await transport.handleRequest(req, res)
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
      if (!sessionId || !transports[sessionId]) {
        console.error(`[DELETE /mcp] Invalid session ID: ${sessionId}`)
        res.status(400).send("Invalid or missing session ID")
        return
      }

      const transport = transports[sessionId]
      await transport.handleRequest(req, res)

      setTimeout(() => {
        if (!transports[sessionId]) {
          console.error(`[DELETE /mcp] Transport removed for session ${sessionId}`)
        }
      }, 100)
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
  process.on("SIGINT", async () => {
    console.error("Shutting down server...")

    for (const sessionId in transports) {
      try {
        await transports[sessionId].close()
        delete transports[sessionId]
      } catch (error) {
        console.error(`Error closing transport for session ${sessionId}:`, error)
      }
    }

    expressServer.close()
    await server.close()
    console.error("Server shutdown complete")
    process.exit(0)
  })
}
