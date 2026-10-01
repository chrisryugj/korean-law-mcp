import http from "node:http"
import type { AddressInfo } from "node:net"
import express from "express"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { requestContext } from "../lib/session-state.js"
import { startHTTPServer } from "./http-server.js"

let listener: http.Server
let url: string
const previousSignals = new Map<string, Set<Function>>()
let waitStarted: (() => void) | undefined
let waitCancelled: (() => void) | undefined

beforeAll(async () => {
  for (const name of ["SIGINT", "SIGTERM"]) previousSignals.set(name, new Set(process.listeners(name)))
  vi.stubEnv("MCP_HTTP_HOST", "127.0.0.1")
  vi.stubEnv("MCP_AUTH_TOKEN", "")
  vi.stubEnv("CORS_ORIGIN", "https://client.example")
  vi.stubEnv("ALLOWED_ORIGINS", "")
  vi.stubEnv("RATE_LIMIT_RPM", "0")
  vi.stubEnv("FALLBACK_RATE_LIMIT_RPM", "0")
  vi.spyOn(console, "error").mockImplementation(() => {})
  const listen = express.application.listen
  vi.spyOn(express.application, "listen").mockImplementation(function (this: express.Application, ...args: any[]) {
    listener = listen.apply(this, args as any)
    return listener
  })
  await startHTTPServer(() => {
    const server = new Server({ name: "contract-test", version: "1" }, { capabilities: { tools: {} } })
    server.setRequestHandler(CallToolRequestSchema, async request => {
      if (request.params.name === "wait") {
        const signal = requestContext.getStore()!.signal!
        waitStarted?.()
        await new Promise<void>(resolve => signal.addEventListener("abort", () => {
          waitCancelled?.()
          resolve()
        }, { once: true }))
      } else {
        // Resolve after another request can enter its own context.
        await new Promise<void>(resolve => setTimeout(resolve, 5))
      }
      return { content: [{ type: "text", text: JSON.stringify({ apiKey: requestContext.getStore()?.apiKey }) }] }
    })
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

const call = (suffix = "", headers: Record<string, string> = {}) => fetch(url + suffix, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "inspect", arguments: {} } }),
})

describe("HTTP client contract", () => {
  it("permits the SDK protocol-version header and every supported API-key header in browser preflight", async () => {
    const requested = ["mcp-protocol-version", "law_oc", "law-oc", "x-law-oc"]
    const response = await fetch(url, {
      method: "OPTIONS",
      headers: { origin: "https://client.example", "access-control-request-method": "POST", "access-control-request-headers": requested.join(",") },
    })
    expect(response.status).toBe(200)
    const allowed = response.headers.get("access-control-allow-headers")!.split(",").map(x => x.trim().toLowerCase())
    for (const header of requested) expect(allowed).toContain(header)
  })

  it("rejects repeated query keys instead of putting an array in the request key context", async () => {
    const response = await call("?oc=first&oc=second")
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error.message).toMatch(/API key/i)
    expect(JSON.stringify(body)).not.toContain("first")
  })

  it("keeps simultaneous API-key contexts isolated and preserves header priority", async () => {
    const responses = await Promise.all([
      call("?oc=query", { apikey: "header-key" }),
      call("?oc=other-query"),
    ])
    const bodies = await Promise.all(responses.map(async response => {
      expect(response.status).toBe(200)
      return response.json()
    }))
    expect(bodies[0].result.content[0].text).toBe('{"apiKey":"header-key"}')
    expect(bodies[1].result.content[0].text).toBe('{"apiKey":"other-query"}')
  })

  it("propagates HTTP disconnect to running tool work", async () => {
    const controller = new AbortController()
    const started = new Promise<void>(resolve => { waitStarted = resolve })
    const cancelled = new Promise<void>(resolve => { waitCancelled = resolve })
    const pending = fetch(url + "?oc=client-key", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "wait", arguments: {} } }),
      signal: controller.signal,
    }).catch(error => error)
    await started
    controller.abort()
    await cancelled
    expect(await pending).toMatchObject({ name: "AbortError" })
    waitStarted = waitCancelled = undefined
  })
})
