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

describe("AI law search: 식별자·쟁점 용어", () => {
  const row = (name: string, id: string, jo: string, title: string) => `<법령조문><법령ID>${id}</법령ID><법령명>${name}</법령명><조문번호>${jo}</조문번호><조문가지번호>00</조문가지번호><조문제목>${title}</조문제목><조문내용>내용</조문내용><시행일자>20260101</시행일자></법령조문>`
  const wrap = (...rows: string[]) => `<aiSearch><검색결과개수>${rows.length}</검색결과개수>${rows.join("")}</aiSearch>`
  it("행마다 본문 조회 식별자를 싣고, terms 결과를 앞에 둔다", async () => {
    const queries: string[] = []
    const api = { fetchApi: async ({ extraParams }: { extraParams: { query: string } }) => {
      queries.push(extraParams.query)
      return extraParams.query === "부당해고"
        ? wrap(row("근로기준법", "001872", "0023", "해고 등의 제한"))
        : wrap(row("근로기준법", "001872", "0026", "해고의 예고"), row("근로기준법", "001872", "0023", "해고 등의 제한"))
    } } as unknown as LawApiClient
    const t = (await searchAiLaw(api, { query: "회사가 그만두라고 함", search: "0", display: 20, page: 1, terms: ["부당해고"] })).content[0].text
    expect(queries).toEqual(["회사가 그만두라고 함", "부당해고"])
    expect(t).toContain(`get_law_text(lawId="001872", jo="제23조")`)
    expect(t.indexOf("제23조")).toBeLessThan(t.indexOf("제26조"))
    expect(t.match(/해고 등의 제한/g)).toHaveLength(1)
  })
})
