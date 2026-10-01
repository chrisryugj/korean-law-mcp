import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { allTools } from "../tool-registry.js"
import { executeNaturalQueryJson } from "./cli-executor.js"
import { routeQuery } from "./query-router.js"

vi.mock("./query-router.js", () => ({ routeQuery: vi.fn() }))

const apiClient = {} as never
const reply = (text: string, isError = false) => ({ content: [{ type: "text", text }], isError })
let previousExitCode: typeof process.exitCode

beforeEach(() => {
  previousExitCode = process.exitCode
  process.exitCode = undefined
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.mocked(routeQuery).mockReturnValue({
    tool: "search_law", params: { query: "민법" }, reason: "test", confidence: 1,
    pipeline: [
      { tool: "get_law_text", params: { jo: "제1조" } },
      { tool: "get_law_text", params: { jo: "제2조" } },
    ],
  })
  vi.spyOn(allTools.find(t => t.name === "search_law")!, "handler")
    .mockResolvedValue(reply("MST: 123"))
})

afterEach(() => {
  process.exitCode = previousExitCode
  vi.restoreAllMocks()
})

describe("CLI JSON error reporting", () => {
  it("keeps a failed detail step visible when a later step succeeds", async () => {
    vi.spyOn(allTools.find(t => t.name === "get_law_text")!, "handler")
      .mockResolvedValueOnce(reply("[UPSTREAM_NO_DATA] 조회 실패", true))
      .mockResolvedValueOnce(reply("제2조 본문"))
    await executeNaturalQueryJson(apiClient, "민법 제1조·제2조")
    const output = JSON.parse(vi.mocked(console.log).mock.calls[0][0])
    expect(output.pipelineResult).toContain("조회 실패")
    expect(output.pipelineResult).toContain("제2조 본문")
    expect(output.isError).toBe(true)
    expect(process.exitCode).toBe(1)
  })

  it("returns a failing exit code when the search itself fails", async () => {
    vi.mocked(allTools.find(t => t.name === "search_law")!.handler)
      .mockResolvedValue(reply("[EXTERNAL_API_ERROR] 실패", true))
    await executeNaturalQueryJson(apiClient, "민법 제1조·제2조")
    const output = JSON.parse(vi.mocked(console.log).mock.calls[0][0])
    expect(output.isError).toBe(true)
    expect(process.exitCode).toBe(1)
  })

  it("keeps successful pipelines successful", async () => {
    vi.spyOn(allTools.find(t => t.name === "get_law_text")!, "handler")
      .mockResolvedValue(reply("조문 본문"))
    await executeNaturalQueryJson(apiClient, "민법 제1조·제2조")
    const output = JSON.parse(vi.mocked(console.log).mock.calls[0][0])
    expect(output.isError).toBe(false)
    expect(process.exitCode).toBeUndefined()
  })
})
