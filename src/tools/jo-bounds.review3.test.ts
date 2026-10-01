import { describe, expect, it, vi } from "vitest"
import type { LawApiClient } from "../lib/api-client.js"
import { getLawText } from "./law-text.js"
import { getArticleDetail } from "./article-detail.js"
import { getHistoricalLaw } from "./historical-law.js"

const law = JSON.stringify({ 법령: {
  기본정보: { 법령명_한글: "표본법" },
  조문: { 조문단위: [
    { 조문여부: "조문", 조문번호: "10", 조문가지번호: "12", 조문내용: "다른 가지 조문" },
    { 조문여부: "조문", 조문번호: "1030", 조문내용: "다른 번호 조문" },
  ] },
} })

describe("JO bounds prevent article aliasing", () => {
  for (const [name, handler] of [
    ["law text", (api: LawApiClient, jo: string) => getLawText(api, { mst: "review3", jo })],
    ["article detail", (api: LawApiClient, jo: string) => getArticleDetail(api, { mst: "review3", jo })],
    ["historical text", (api: LawApiClient, jo: string) => getHistoricalLaw(api, { mst: "review3", jo })],
  ] as const) {
    it.each(["제10조의123", "제10300조"])(`${name} rejects %s before fetching`, async jo => {
      const fetch = vi.fn(async () => law)
      const api = { getLawText: fetch, fetchApi: fetch } as unknown as LawApiClient
      const result = await handler(api, jo)
      expect(result.isError).toBe(true)
      expect(result.content[0].text).not.toContain("다른 가지 조문")
      expect(result.content[0].text).not.toContain("다른 번호 조문")
      expect(fetch).not.toHaveBeenCalled()
    })
  }
})
