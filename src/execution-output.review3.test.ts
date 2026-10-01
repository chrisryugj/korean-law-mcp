import { afterEach, describe, expect, it, vi } from "vitest"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { allTools, registerTools } from "./tool-registry.js"
import { executeTool } from "./lib/cli-executor.js"
import type { LawApiClient } from "./lib/api-client.js"

const key = "argument-secret-12345"
const api = {} as LawApiClient
const law = allTools.find(t => t.name === "get_law_text")!
afterEach(() => vi.restoreAllMocks())

describe("execution entrypoint output protection", () => {
  it.each([false, true])("masks argument OC in MCP direct/proxy output: %s", async proxy => {
    vi.spyOn(law, "handler").mockResolvedValue({ content: [{ type: "text", text: `credential: ${key}` }] })
    const server = new Server({ name: "test", version: "1" }, { capabilities: { tools: {} } })
    registerTools(server, api)
    const [a, b] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: "test", version: "1" })
    await Promise.all([server.connect(a), client.connect(b)])
    try {
      const params = { mst: "1", apiKey: key }
      const result = await client.callTool(proxy
        ? { name: "execute_tool", arguments: { tool_name: "get_law_text", params } }
        : { name: "get_law_text", arguments: params })
      expect(JSON.stringify(result)).not.toContain(key)
      expect(JSON.stringify(result)).toContain("***")
    } finally {
      await client.close()
      await server.close()
    }
  })

  it.each([false, true])("masks CLI output and errors: %s", async fail => {
    vi.spyOn(law, "handler").mockImplementation(async () => {
      if (fail) throw new Error(`OC=${key} credential: ${key}`)
      return { content: [{ type: "text", text: `OC=${key} credential: ${key}` }] }
    })
    const result = await executeTool(api, law.name, { mst: "1", apiKey: key })
    expect(JSON.stringify(result)).not.toContain(key)
    expect(JSON.stringify(result)).toContain("***")
    expect(Boolean(result.isError)).toBe(fail)
  })

  it("rejects oversized CLI article arguments before running the parser", async () => {
    const handler = vi.spyOn(law, "handler")
    const result = await executeTool(api, law.name, { mst: "1", jo: "1".repeat(200) })
    expect(result.isError).toBe(true)
    expect(handler).not.toHaveBeenCalled()
  })
})
