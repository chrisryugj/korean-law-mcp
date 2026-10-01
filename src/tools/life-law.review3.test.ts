import { describe, expect, it } from "vitest"
import type { LawApiClient } from "../lib/api-client.js"
import { searchAiLaw } from "./life-law.js"

describe("AI law article rendering", () => {
  it("retains legal amendment notes and normalizes the article number", async () => {
    const api = { fetchApi: async () => `<aiSearch><검색결과개수>1</검색결과개수>
      <법령조문><법령명>근로기준법</법령명><조문번호>0043</조문번호><조문가지번호>02</조문가지번호>
      <조문제목>임금</조문제목><조문내용><![CDATA[<p>제43조의2(임금) 임금을 지급한다. <개정 2026.1.1.></p>]]></조문내용>
      <시행일자>20260101</시행일자></법령조문></aiSearch>` } as unknown as LawApiClient
    const result = await searchAiLaw(api, { query: "급여", search: "0", display: 1, page: 1 })
    expect(result.content[0].text).toContain("제43조의2 (임금)")
    expect(result.content[0].text).toContain("<개정 2026.1.1.>")
    expect(result.content[0].text).not.toContain("<p>")
  })
})
