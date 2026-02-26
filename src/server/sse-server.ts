/**
 * Streamable HTTP 서버 - 리모트 배포용 (MCP 2025-03-26 스펙 준수)
 */

import express from "express"
import { randomUUID } from "node:crypto"
import type { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { InMemoryEventStore } from "@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js"
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"

interface SessionTransport {
  transport: StreamableHTTPServerTransport
}

export async function startSSEServer(server: Server, port: number) {
  const app = express()
  const transports: Record<string, SessionTransport> = {}

  // JSON 파싱 미들웨어
  app.use(express.json())

  // CORS 설정 (MCP Streamable HTTP 스펙 준수)
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*")
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS, HEAD")
    res.header("Access-Control-Allow-Headers",
      "Content-Type, Accept, Authorization, Mcp-Protocol-Version, mcp-protocol-version, Mcp-Session-Id, mcp-session-id, Last-Event-ID, last-event-id, Traceparent, Tracestate"
    )
    res.header("Access-Control-Expose-Headers",
      "Mcp-Session-Id, Content-Type, Mcp-Protocol-Version, Traceparent, Tracestate"
    )
    res.header("Access-Control-Max-Age", "86400")
    res.header("Mcp-Protocol-Version", "2025-03-26")

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
      protocol: "streamable-http",
      endpoints: {
        mcp: "/mcp",
        health: "/health"
      }
    })
  })

  app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() })
  })

  // MCP POST 엔드포인트 (초기화 및 요청 처리)
  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined

    if (sessionId) {
      console.error(`Received MCP request for session: ${sessionId}`)
    } else {
      console.error("New MCP request (no session ID)")
    }

    try {
      let transport: StreamableHTTPServerTransport

      if (sessionId && transports[sessionId]) {
        // 기존 세션 재사용
        transport = transports[sessionId].transport
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // 새 세션 초기화
        const eventStore = new InMemoryEventStore()
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          eventStore,
          onsessioninitialized: (newSessionId) => {
            console.error(`Session initialized: ${newSessionId}`)
            transports[newSessionId] = { transport }
          }
        })

        // 세션 종료 시 정리
        transport.onclose = () => {
          const sid = transport.sessionId
          if (sid && transports[sid]) {
            console.error(`Transport closed for session ${sid}`)
            delete transports[sid]
          }
        }

        // 서버 연결
        await server.connect(transport)
        await transport.handleRequest(req, res, req.body)
        return
      } else {
        // 잘못된 요청
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Invalid request: missing session ID or not an initialization request"
          },
          id: null
        })
        return
      }

      // 기존 세션 요청 처리
      await transport.handleRequest(req, res, req.body)
    } catch (error) {
      console.error("Error handling MCP POST request:", error)
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

  // MCP GET 엔드포인트 (SSE 스트림)
  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined

    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID")
      return
    }

    const lastEventId = req.headers["last-event-id"]
    if (lastEventId) {
      console.error(`Client reconnecting with Last-Event-ID: ${lastEventId}`)
    } else {
      console.error(`Establishing SSE stream for session ${sessionId}`)
    }

    try {
      const transport = transports[sessionId].transport
      await transport.handleRequest(req, res)
    } catch (error) {
      console.error("[GET /mcp] Error:", error)
      if (!res.headersSent) {
        res.status(500).send("Internal server error")
      }
    }
  })

  // MCP DELETE 엔드포인트 (세션 종료)
  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined

    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID")
      return
    }

    console.error(`Session termination request for ${sessionId}`)

    try {
      const transport = transports[sessionId].transport
      await transport.handleRequest(req, res)
    } catch (error) {
      console.error("Error handling session termination:", error)
      if (!res.headersSent) {
        res.status(500).send("Error processing session termination")
      }
    }
  })

  // 서버 시작
  app.listen(port, "0.0.0.0", () => {
    console.error(`✓ Korean Law MCP server (Streamable HTTP) listening on port ${port}`)
    console.error(`✓ MCP endpoint: http://0.0.0.0:${port}/mcp`)
    console.error(`✓ Health check: http://0.0.0.0:${port}/health`)
  })

  // 종료 처리
  process.on("SIGINT", async () => {
    console.error("Shutting down server...")
    for (const sessionId in transports) {
      try {
        await transports[sessionId].transport.close()
        delete transports[sessionId]
      } catch (error) {
        console.error(`Error closing transport ${sessionId}:`, error)
      }
    }
    process.exit(0)
  })
}
