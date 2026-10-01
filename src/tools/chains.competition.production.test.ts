import { describe, expect, it, vi } from "vitest"
import { legalResearch } from "./legal-research.js"
import type { LawApiClient } from "../lib/api-client.js"

describe("dispute preparation competition domain", () => {
  it.each(["competition", undefined] as const)("searches FTC decisions and fetches the selected detail (domain=%s)", async domain => {
    const fetchApi = vi.fn(async ({ target, endpoint }: { target: string; endpoint: string }) => {
      if (target !== "ftc") return "<Empty><totalCnt>0</totalCnt></Empty>"
      if (endpoint === "lawSearch.do") return `<Ftc><totalCnt>1</totalCnt><ftc><결정문일련번호>123</결정문일련번호><사건명>담합 사건</사건명></ftc></Ftc>`
      return JSON.stringify({ FtcService: { 사건명: "담합 사건", 결정내용: "검증된 공정위 판단" } })
    })
    const result = await legalResearch({ fetchApi } as unknown as LawApiClient, { task: "dispute_prep", query: "담합", domain })
    expect(result.isError).not.toBe(true)
    expect(result.content[0].text).toContain("공정위 결정")
    expect(result.content[0].text).toContain("검증된 공정위 판단")
    expect(fetchApi.mock.calls.filter(([args]) => args.target === "ftc")).toHaveLength(2)
  })
})
