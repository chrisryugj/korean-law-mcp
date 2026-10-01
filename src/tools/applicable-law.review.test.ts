import { beforeEach, describe, expect, it, vi } from "vitest"
import { applicableLaw, normalizeDate } from "./applicable-law.js"
import { lawCache } from "../lib/cache.js"
import type { LawApiClient } from "../lib/api-client.js"

const row = (date: string) => `<law><법령일련번호>900001</법령일련번호><법령명한글>검토법</법령명한글><법령ID>000001</법령ID><제개정구분명>일부개정</제개정구분명><시행일자>${date}</시행일자><공포번호>1</공포번호></law>`
const lineage = `<LawSearch><totalCnt>2</totalCnt>${row("20210101")}${row("20200101")}</LawSearch>`
const article = (mok: string) => JSON.stringify({ 법령: { 조문: { 조문단위: {
  조문여부: "조문", 조문번호: "1", 조문내용: "제1조(대상)",
  항: { 항내용: "① 적용 대상", 호: { 호내용: "1. 대상자", 목: { 목번호: "가", 목내용: mok } } },
} } } })

describe("applicable_law production regressions", () => {
  beforeEach(() => lawCache.clear())

  it("compares separate effective slices of the same promulgation and retains 목 text", async () => {
    const getLawText = vi.fn(async (input: { efYd: string }) => article(input.efYd === "20200101" ? "가. 종전 대상" : "가. 변경 대상"))
    const client = {
      searchLaw: async () => `<LawSearch>${row("20210101")}</LawSearch>`,
      fetchApi: async (input: { target: string }) => input.target === "eflaw"
        ? lineage : JSON.stringify({ 법령: { 부칙: { 부칙단위: [] } } }),
      getLawText,
    } as unknown as LawApiClient
    const response = await applicableLaw(client, { lawName: "검토법", date: "2020-06-01", jo: "제1조" })
    expect(response.isError).toBeFalsy()
    expect(response.content[0].text).toContain("가. 종전 대상")
    expect(response.content[0].text).toContain("현행과 비교: △ 변경됨")
    expect(getLawText.mock.calls.map(([input]) => input.efYd)).toEqual(["20200101", "20210101"])
  })

  it.each(["2023-02-29", "2024-04-31", "20230229", "2024.13.1", "2024-01-010"])("rejects an invalid calendar date: %s", input => {
    expect(normalizeDate(input)).toBeNull()
  })

  it.each(["2024-02-29", "2024.2.29", "20240229", "2024년 2월 29일"])("accepts a real leap day: %s", input => {
    expect(normalizeDate(input)).toBe("20240229")
  })
})
