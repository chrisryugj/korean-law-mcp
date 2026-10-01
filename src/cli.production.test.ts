import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createProgram } from "./cli.js"
import { allTools } from "./tool-registry.js"

beforeEach(() => {
  vi.stubEnv("LAW_OC", "test-cli-key")
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("CLI exited") })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

async function run(...args: string[]) {
  return createProgram().exitOverride().configureOutput({ writeErr: () => {} }).parseAsync(["node", "cli", ...args])
}

describe("CLI advertised arguments", () => {
  it("accepts a complete JSON input without duplicated required flags", async () => {
    await run("parse_jo_code", "--json-input", JSON.stringify({ joText: "제38조" }))
    expect(vi.mocked(console.log).mock.calls.flat().join("\n")).toContain("003800")
  })

  it("uses an API key supplied inside JSON input", async () => {
    vi.stubEnv("LAW_OC", "")
    await run("parse_jo_code", "--json-input", JSON.stringify({ joText: "제38조", apiKey: "json-test-key" }))
    expect(vi.mocked(console.log).mock.calls.flat().join("\n")).toContain("003800")
  })

  it("preserves Commander boolean flags as true", async () => {
    const handler = vi.spyOn(allTools.find(t => t.name === "get_precedent_text")!, "handler")
      .mockResolvedValue({ content: [{ type: "text", text: "전문" }] })
    await run("get_precedent_text", "--id", "1", "--full")
    expect(handler.mock.calls[0][1]).toMatchObject({ id: "1", full: true })
  })

  it("text and JSON tool lists apply the same category filter", async () => {
    await run("list", "--category", "판례", "--json")
    const selected = JSON.parse(String(vi.mocked(console.log).mock.calls[0][0]))
    vi.mocked(console.log).mockClear()
    await run("list", "--category", "판례")
    const text = vi.mocked(console.log).mock.calls.flat().join("\n")
    expect(selected.length).toBeGreaterThan(0)
    expect(text).toContain(`${selected.length}개 도구`)
    expect(text).not.toContain("get_law_text")
  })

  it("still rejects missing required tool inputs", async () => {
    await expect(run("parse_jo_code")).rejects.toThrow()
  })
})
