#!/usr/bin/env node

/**
 * Korean Law MCP Server
 * 국가법령정보센터 API 기반 MCP 서버
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { LawApiClient } from "./lib/api-client.js"
import { registerTools } from "./tool-registry.js"
import { startHTTPServer } from "./server/http-server.js"

// API 클라이언트 초기화
const LAW_OC = process.env.LAW_OC || ""
const apiClient = new LawApiClient({ apiKey: LAW_OC })

// MCP 서버 생성
const server = new Server(
  {
    name: "korean-law",
    version: "1.6.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
)

// 도구 등록
registerTools(server, apiClient)

// 서버 시작
async function main() {
  const args = process.argv.slice(2)
  const modeIndex = args.indexOf("--mode")
  const mode = modeIndex !== -1 ? args[modeIndex + 1] : "stdio"
  const portIndex = args.indexOf("--port")
  const port = portIndex !== -1 ? parseInt(args[portIndex + 1], 10) : 8000

  if (mode === "http" || mode === "sse") {
    await startHTTPServer(server, port)
  } else {
    // STDIO 모드 (기본)
    const transport = new StdioServerTransport()
    await server.connect(transport)
    console.error("Korean Law MCP server running on stdio")
  }
}

main().catch((error) => {
  console.error("Server error:", error)
  process.exit(1)
})
