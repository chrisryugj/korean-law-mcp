/** get_law_text. lawName 으로 바로 조회, 목차에 편·장·절 머리 (법제처 law-mcp 대조: get_article_list·get_structure) */
import { beforeEach, describe, expect, it } from "vitest"
import { getLawText } from "./law-text.js"
import { lawCache } from "../lib/cache.js"
import type { LawApiClient } from "../lib/api-client.js"

const units = [
  { 조문여부: "전문", 조문번호: "0", 조문내용: "제1장 총칙" },
  ...Array.from({ length: 12 }, (_, i) => ({ 조문여부: "조문", 조문번호: String(i + 1), 조문제목: `조${i + 1}`, 조문내용: `제${i + 1}조(조${i + 1}) 내용` })),
  { 조문여부: "전문", 조문번호: "0", 조문내용: "제2장 근로계약 <개정 2020.1.1>" },
  ...Array.from({ length: 12 }, (_, i) => ({ 조문여부: "조문", 조문번호: String(i + 13), 조문제목: `조${i + 13}`, 조문내용: `제${i + 13}조(조${i + 13}) 내용` })),
]
const lawJson = JSON.stringify({ 법령: { 기본정보: { 법령명_한글: "근로기준법", 법령ID: "001872", 시행일자: "20260101", 공포일자: "20250101" }, 조문: { 조문단위: units } } })
const searchXml = `<LawSearch><totalCnt>1</totalCnt><law><법령명한글>근로기준법</법령명한글><법령ID>001872</법령ID><법령일련번호>270000</법령일련번호></law></LawSearch>`

describe("get_law_text lawName·목차", () => {
  beforeEach(() => lawCache.clear())
  it("lawName 이면 찾아서 법령ID 로 받고, 목차에 장 머리를 낸다", async () => {
    const asked: Array<Record<string, unknown>> = []
    const client = {
      searchLaw: async () => searchXml,
      getLawText: async (p: Record<string, unknown>) => { asked.push(p); return lawJson },
      fetchApi: async () => "<LawSearch><totalCnt>0</totalCnt></LawSearch>",
    } as unknown as LawApiClient
    const r = await getLawText(client, { lawName: "근로기준법" })
    const t = r.content[0].text
    expect(asked[0].lawId).toBe("001872")
    expect(t).toContain("목차 (총 24개 조문)")
    expect(t).toMatch(/제1장 총칙\n  제1조 조1/)
    expect(t).toMatch(/제2장 근로계약\n  제13조 조13/)
    const part = (await getLawText(client, { lawName: "근로기준법", offset: 12, limit: 2 })).content[0].text
    expect(part).toContain("12번째부터 2개")
    expect(part).toMatch(/제2장 근로계약\n  제13조 조13\n  제14조 조14/)
    expect(part).not.toContain("제1조 조1\n")
  })
})
