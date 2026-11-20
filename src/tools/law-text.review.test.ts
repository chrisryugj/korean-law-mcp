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

  // #185 조문 없는 법령 — 본문 전체가 조문여부="전문" 단위 하나(객체)로 온다 (법제처 MST 230727 실측 모양)
  const fullTextLaw = (unitBody: unknown) => JSON.stringify({ 법령: {
    기본정보: { 법령명_한글: "이자제한법 제2조제1항의 최고이자율에 관한 규정" }, 조문: { 조문단위: unitBody },
  } })

  it("prints the 전문 unit of a law without articles (#185)", async () => {
    const client = { getLawText: async () => fullTextLaw({
      조문번호: "0", 조문키: "0000000", 조문여부: "전문",
      조문내용: "        「이자제한법」 제2조제1항에 따른 금전대차에 관한 계약상의 최고이자율은 연 20퍼센트로 한다. <개정 2014.6.11, 2017.11.7, 2021.4.6>",
    }) } as unknown as LawApiClient
    const response = await getLawText(client, { mst: "230727" })
    expect(response.isError).toBeFalsy()
    expect(response.content[0].text).toContain("최고이자율은 연 20퍼센트로 한다. <개정 2014.6.11, 2017.11.7, 2021.4.6>")
  })

  it("still skips chapter headings (전문) when the law has articles", async () => {
    const client = { getLawText: async () => body({ 조문여부: "전문", 조문번호: "1", 조문내용: "제1장 총칙" } as never, unit("1")) } as unknown as LawApiClient
    const response = await getLawText(client, { mst: "review" })
    expect(response.content[0].text).toContain("제1조\n본문")
    expect(response.content[0].text).not.toContain("제1장 총칙")
  })

  it("reports EMPTY_BODY instead of a silent success when no unit renders", async () => {
    const client = { getLawText: async () => fullTextLaw({ 조문번호: "0", 조문여부: "전문", 조문내용: "   " }) } as unknown as LawApiClient
    const response = await getLawText(client, { mst: "empty" })
    expect(response.isError).toBe(true)
    expect(response.content[0].text).toContain("[EMPTY_BODY]")
  })
})
