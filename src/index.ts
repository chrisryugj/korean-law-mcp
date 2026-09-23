#!/usr/bin/env node

/**
 * Korean Law MCP Server
 * 국가법령정보센터 API 기반 MCP 서버
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv-provider.js"
import { LawApiClient } from "./lib/api-client.js"
import { registerTools } from "./tool-registry.js"
import { startHTTPServer } from "./server/http-server.js"
import { parseHttpPort } from "./server/http-config.js"
import { readExecutionLimits, type ExecutionLimits } from "./lib/execution-limits.js"
import { VERSION } from "./version.js"

// API 클라이언트 초기화 (LAW_OC 또는 KOREAN_LAW_API_KEY 지원)
const LAW_OC = process.env.LAW_OC || process.env.KOREAN_LAW_API_KEY || ""
const apiClient = new LawApiClient({ apiKey: LAW_OC })

// Server 는 옵션이 없으면 인스턴스마다 Ajv 검증기를 새로 만든다(elicitation 전용, 이 서버는
// 안 쓴다). HTTP 모드는 POST 마다 Server 를 만드므로 하나를 공유한다: createServer 37.7µs →
// 1.3µs, 요청당 garbage 약 18KB 감소(2026-09-23 리뷰 A9 실측).
const jsonSchemaValidator = new AjvJsonSchemaValidator()

// MCP 서버 팩토리 (HTTP 모드: 세션마다 새 인스턴스 필요)
function createServer(executionLimits: ExecutionLimits = readExecutionLimits()): Server {
  const s = new Server(
    { name: "korean-law", version: VERSION },
    { capabilities: { tools: {} }, jsonSchemaValidator }
  )
  registerTools(s, apiClient, executionLimits)
  return s
}

// 서버 시작
async function main() {
  const args = process.argv.slice(2)

  // setup 서브커맨드: npx korean-law-mcp setup
  if (args[0] === "setup") {
    const { runSetup } = await import("./setup.js")
    await runSetup()
    return
  }

  const modeIndex = args.indexOf("--mode")
  const mode = modeIndex !== -1 ? args[modeIndex + 1] : "stdio"
  const portIndex = args.indexOf("--port")
  const port = parseHttpPort(portIndex !== -1 ? args[portIndex + 1] : undefined)

  if (mode === "http" || mode === "sse") {
    await startHTTPServer(createServer, port)
  } else {
    // STDIO 모드
    // stdout 오염 방지: MCP JSON-RPC 프로토콜 보호
    const stderrWrite = (...args: unknown[]) =>
      process.stderr.write(args.map(String).join(" ") + "\n")
    console.log = console.warn = console.info = console.debug = stderrWrite
    const server = createServer()
    const transport = new StdioServerTransport()
    await server.connect(transport)
  }
}

main().catch((error) => {
  console.error("Server error:", error)
  process.exit(1)
})
