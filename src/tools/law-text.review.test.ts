import { beforeEach, describe, expect, it, vi } from "vitest"
import { getLawText } from "./law-text.js"
import { lawCache } from "../lib/cache.js"
import type { LawApiClient } from "../lib/api-client.js"

const unit = (number: string, branch = "0") => ({ 조문여부: "조문", 조문번호: number, 조문가지번호: branch, 조문내용: `제${number}조${branch === "0" ? "" : `의${branch}`} 본문` })
const body = (...articles: ReturnType<typeof unit>[]) => JSON.stringify({ 법령: {
  기본정보: { 법령명_한글: "검토법" }, 조문: { 조문단위: articles },
} })

describe("law text article selection", () => {
  beforeEach(() => lawCache.clear())

  it("does not return a different article when upstream ignores JO", async () => {
    const client = { getLawText: async () => body(unit("1")) } as unknown as LawApiClient
    const response = await getLawText(client, { mst: "review", jo: "제44조" })
    expect(response.isError).toBe(true)
    expect(response.content[0].text).toContain("[NOT_FOUND]")
    expect(response.content[0].text).not.toContain("제1조 본문")
  })

  it("filters a full-law response to the requested branch article", async () => {
    const client = { getLawText: async () => body(unit("10"), unit("10", "2")) } as unknown as LawApiClient
    const response = await getLawText(client, { mst: "review", jo: "제10조의2" })
    expect(response.isError).toBeFalsy()
    expect(response.content[0].text).toContain("제10조의2\n본문")
    expect(response.content[0].text).not.toMatch(/^제10조$/m)
  })

  it.each(["38", "38조", "제 38 조"])("normalizes supported article notation before fetch: %s", async jo => {
    const getLawTextStub = vi.fn(async (_input: { jo?: string }) => body(unit("38")))
    await getLawText({ getLawText: getLawTextStub } as unknown as LawApiClient, { mst: "review", jo })
    expect(getLawTextStub.mock.calls[0]?.[0]).toMatchObject({ jo: "003800" })
  })
})
