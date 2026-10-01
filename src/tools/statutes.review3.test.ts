import { describe, expect, it, vi } from "vitest"
import type { LawApiClient } from "../lib/api-client.js"
import { findMatchingAnnex } from "./annex-select.js"
import { getLawSystemTree } from "./law-system-tree.js"
import { getLawTree } from "./law-tree.js"
import { getLinkedOrdinances, getLinkedLawsFromOrdinance } from "./law-linkage.js"

vi.mock("./three-tier.js", () => ({
  getThreeTier: async () => ({ content: [{ type: "text", text: `법령명: 건축법
---
제2조 정의
---
[시행령] 건축법 시행령 제3조
전체 100개 조문 중 처음 5개만 표시합니다.
` }] }),
}))

describe("review3 statutory response boundaries", () => {
  it("labels linkage law rows as law identifiers", async () => {
    const api = { fetchApi: async () => `<LawSearch><totalCnt>1</totalCnt><law><법령명한글>지방공무원법</법령명한글><법령ID>001653</법령ID></law></LawSearch>` } as unknown as LawApiClient
    const text = (await getLinkedOrdinances(api, { query: "지방공무원법", display: 2, page: 1 })).content[0].text
    expect(text).toContain("자치법규와 연계된 법령 목록")
    expect(text).toContain("법령의 식별정보")
    expect(text).toContain("get_linked_ordinance_articles")
  })

  it("labels linkage ordinance rows as ordinance identifiers", async () => {
    const api = { fetchApi: async () => `<OrdinSearch><totalCnt>1</totalCnt><law><자치법규명>서울특별시 경관 조례</자치법규명><자치법규ID>2001727</자치법규ID></law></OrdinSearch>` } as unknown as LawApiClient
    const text = (await getLinkedLawsFromOrdinance(api, { query: "서울특별시 경관 조례", display: 2, page: 1 })).content[0].text
    expect(text).toContain("법령과 연계된 자치법규 목록")
    expect(text).toContain("자치법규의 식별정보")
    expect(text).not.toContain("자치법규 → 상위법령")
  })

  it("does not resolve a branch code to a sole unnumbered annex", () => {
    const only = [{ 별표명: "수수료 기준", 별표종류: "별표" }]
    expect(findMatchingAnnex(only, "000102")).toBeUndefined()
    expect(findMatchingAnnex(only, "1의2")).toBeUndefined()
    expect(findMatchingAnnex(only, "000100")).toBe(only[0])
  })

  it("preserves the source sample limitation in a law tree", async () => {
    const result = await getLawTree({} as LawApiClient, { lawId: "001823" })
    expect(result.content[0].text).toContain("전체 100개 조문 중 처음 5개만 표시")
    expect(result.content[0].text).toContain("표본")
  })

  it("shows the parent law and nested decree rules when the queried law is a rule", async () => {
    const basic = (법령명: string, content: string) => ({ 법령명, 법종구분: { content } })
    const tree = {
      기본정보: basic("건축법 시행규칙", "국토교통부령"),
      상하위법: { 법률: {
        기본정보: basic("건축법", "법률"),
        시행령: { 기본정보: basic("건축법 시행령", "대통령령"),
          시행규칙: { 기본정보: basic("건축법 시행규칙", "국토교통부령") } },
        시행규칙: { 기본정보: basic("지능형건축물의 인증에 관한 규칙", "국토교통부령") },
      } },
    }
    const api = { fetchApi: vi.fn(async (p: { type: string }) =>
      p.type === "JSON" ? JSON.stringify({ 법령체계도: tree }) : "<법령체계도/>") } as unknown as LawApiClient
    const result = await getLawSystemTree(api, { lawName: "건축법 시행규칙" })
    const text = result.content[0].text
    const hierarchy = text.split("법령 체계:")[1]
    expect(hierarchy).toContain("법률 (1건)")
    expect(hierarchy).toContain("시행규칙 (2건)")
    expect(hierarchy).toContain("건축법 시행규칙")
    const visualization = text.split("체계도 시각화:")[1]
    expect(visualization.indexOf("건축법 (법률)")).toBeLessThan(visualization.indexOf("건축법 시행령"))
    expect(visualization).toContain("건축법 시행규칙")
  })
})
