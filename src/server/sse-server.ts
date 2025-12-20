/**
 * SSE (Server-Sent Events) 서버 - 리모트 배포용
 */

import express from "express"
import type { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js"

export async function startSSEServer(server: Server, port: number) {
  const app = express()

  // JSON 파싱 미들웨어
  app.use(express.json())

  // CORS 설정 (모든 도메인 허용)
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
      version: "1.0.0",
      status: "running",
      endpoints: {
        mcp: "/mcp",
        health: "/health"
      }
    })
  })

  // MCP 프로토콜 디스커버리 (HEAD 메서드)
  app.head("/", (req, res) => {
    res.sendStatus(200)
  })

  app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() })
  })

  // MCP SSE 엔드포인트
  app.get("/mcp", async (req, res) => {
    console.error("SSE connection established")

    // SSE 헤더 설정
    res.setHeader("Content-Type", "text/event-stream")
    res.setHeader("Cache-Control", "no-cache")
    res.setHeader("Connection", "keep-alive")

    const transport = new SSEServerTransport("/message", res)
    await server.connect(transport)

    // 연결 종료 시
    req.on("close", () => {
      console.error("SSE connection closed")
    })
  })

  // POST /message 엔드포인트 (MCP 메시지 수신)
  app.post("/message", async (req, res) => {
    console.error("Received message:", JSON.stringify(req.body).substring(0, 100))
    // SSE 트랜스포트가 자동으로 처리
    res.sendStatus(200)
  })

  // 서버 시작 (0.0.0.0으로 바인딩하여 외부 접속 허용)
  app.listen(port, "0.0.0.0", () => {
    console.error(`✓ Korean Law MCP server (SSE mode) listening on port ${port}`)
    console.error(`✓ MCP endpoint: http://0.0.0.0:${port}/mcp`)
    console.error(`✓ Health check: http://0.0.0.0:${port}/health`)
  })
}
