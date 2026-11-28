import { describe, expect, it, vi } from "vitest"
import type { LawApiClient } from "../lib/api-client.js"
import { searchArticlesInLaw, searchLawText } from "./law-body-search.js"

describe("search_law_text", () => {
  it("본문 검색(search=2)으로 부르고 법령 목록을 낸다", async () => {
    const fetchApi = vi.fn(async () => `<LawSearch><totalCnt>2</totalCnt><law><법령명한글>도로교통법</법령명한글><법령ID>001638</법령ID><법령일련번호>290000</법령일련번호></law></LawSearch>`)
    const t = (await searchLawText({ fetchApi } as unknown as LawApiClient, { query: "전동킥보드", display: 20, page: 1 })).content[0].text
    expect((fetchApi.mock.calls[0] as any)[0].extraParams.search).toBe("2")
    expect(t).toContain("본문 검색 '전동킥보드': 2건")
    expect(t).toContain("도로교통법")
  })
})

describe("search_articles_in_law", () => {
  const law = { 법령: { 기본정보: { 법령명_한글: "근로기준법" }, 조문: { 조문단위: [
    { 조문여부: "전문", 조문번호: "1", 조문내용: "제1장 총칙" },
    { 조문여부: "조문", 조문번호: "23", 조문제목: "해고 등의 제한", 조문내용: "제23조(해고 등의 제한)", 항: [{ 항내용: "① 사용자는 근로자에게 정당한 이유 없이 해고, 휴직, 정직을 하지 못한다." }] },
    { 조문여부: "조문", 조문번호: "26", 조문제목: "해고의 예고", 조문내용: "제26조(해고의 예고) 사용자는 근로자를 해고하려면 적어도 30일 전에 예고를 하여야 한다." },
    { 조문여부: "조문", 조문번호: "56", 조문제목: "연장근로", 조문내용: "제56조(연장근로) 가산하여 지급" },
  ] } } }
  const client = { getLawText: vi.fn(async () => JSON.stringify(law)) } as unknown as LawApiClient
  it("낱말이 모두 든 조문만 번호·제목·발췌로, 장 머리는 세지 않는다", async () => {
    const t = (await searchArticlesInLaw(client, { lawId: "001872", query: "해고 사용자", limit: 30, titleOnly: false })).content[0].text
    expect(t).toContain("근로기준법 안에서 '해고 사용자': 조문 2개")
    expect(t).toContain("- 제23조(해고 등의 제한)")
    expect(t).toContain("- 제26조(해고의 예고)")
    expect(t).not.toContain("제56조")
  })
  it("titleOnly 면 제목에서만", async () => {
    const t = (await searchArticlesInLaw(client, { lawId: "001872", query: "예고", limit: 30, titleOnly: true })).content[0].text
    expect(t).toContain("조문 1개")
    const none = (await searchArticlesInLaw(client, { lawId: "001872", query: "퇴직금", limit: 30, titleOnly: false })).content[0].text
    expect(none).toContain("[NOT_FOUND]")
  })
})
