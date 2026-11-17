// 서버 키 폴백의 클라이언트별 몫을 실제 HTTP 경로로 확인한다 (2026-11-17 IP 하나가 공유 몫을 다 쓴 사례)
import http from "node:http"
import type { AddressInfo } from "node:net"
import express from "express"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { startHTTPServer } from "./http-server.js"

let listener: http.Server
let url: string
const previousSignals = new Map<string, Set<Function>>()

beforeAll(async () => {
  for (const name of ["SIGINT", "SIGTERM"]) previousSignals.set(name, new Set(process.listeners(name)))
  vi.stubEnv("MCP_HTTP_HOST", "127.0.0.1")
  vi.stubEnv("MCP_AUTH_TOKEN", "")
  vi.stubEnv("ALLOWED_ORIGINS", "")
  vi.stubEnv("TRUST_PROXY", "1") // X-Forwarded-For 로 접속 IP 를 바꿔 가며 보낸다
  vi.stubEnv("RATE_LIMIT_RPM", "0")
  vi.stubEnv("FALLBACK_RATE_LIMIT_RPM", "5")
  vi.stubEnv("FALLBACK_PER_IP_RPM", "2")
  vi.stubEnv("FALLBACK_DAILY_CAP", "0")
  vi.spyOn(console, "error").mockImplementation(() => {})
  const listen = express.application.listen
  vi.spyOn(express.application, "listen").mockImplementation(function (this: express.Application, ...args: any[]) {
    listener = listen.apply(this, args as any)
    return listener
  })
  await startHTTPServer(() => {
    const server = new Server({ name: "fallback-share-test", version: "1" }, { capabilities: { tools: {} } })
    server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: "text", text: "ok" }] }))
    return server
  }, 0)
  if (!listener.listening) await new Promise<void>(resolve => listener.once("listening", resolve))
  url = `http://127.0.0.1:${(listener.address() as AddressInfo).port}/mcp`
})

afterAll(async () => {
  listener?.closeAllConnections()
  if (listener) await new Promise<void>(resolve => listener.close(() => resolve()))
  for (const [name, previous] of previousSignals) {
    for (const handler of process.listeners(name)) {
      if (!previous.has(handler)) process.removeListener(name, handler)
    }
  }
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

const call = (ip: string, headers: Record<string, string> = {}) => fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-forwarded-for": ip, ...headers },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "any", arguments: {} } }),
})

describe("keyless fallback share per client", () => {
  it("limits one client to its share and leaves the rest of the shared quota to others", async () => {
    const heavy = []
    for (let i = 0; i < 6; i++) heavy.push((await call("203.0.113.9")).status)
    expect(heavy).toEqual([200, 200, 429, 429, 429, 429])

    const denied = await call("203.0.113.9")
    expect(denied.headers.get("retry-after")).toMatch(/^\d+$/)
    expect((await denied.json()).error.message).toMatch(/2 tool calls\/min per client/)

    // 공유 5 중 heavy 가 2만 썼다
    expect((await call("198.51.100.1")).status).toBe(200)
    expect((await call("198.51.100.1")).status).toBe(200)
    expect((await call("198.51.100.2")).status).toBe(200)
    const shared = await call("198.51.100.3")
    expect(shared.status).toBe(429)
    expect((await shared.json()).error.message).toMatch(/^Shared API quota exceeded/)
  })

  it("does not apply the share to callers with their own key", async () => {
    for (let i = 0; i < 5; i++) expect((await call("203.0.113.9", { apikey: "own-key" })).status).toBe(200)
  })
})
