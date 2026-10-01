import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LawApiClient } from "../lib/api-client.js"
import { lawCache } from "../lib/cache.js"
import { extractCaseNumbers, fieldHasExactCase } from "../lib/case-citation.js"
import { verifyCitations } from "./verify-citations.js"

beforeEach(() => lawCache.clear())

describe("띄어 쓴 판례 인용의 검증 상태", () => {
  it("법령 실존이 공백형 미래 판례 인용을 VERIFIED로 덮지 않는다", async () => {
    const api = {
      searchLaw: async () => `<LawSearch><law><법령일련번호>100</법령일련번호><법령명한글>민법</법령명한글></law></LawSearch>`,
      getLawText: async () => JSON.stringify({ 법령: { 조문: { 조문단위: { 조문여부: "조문", 조문번호: "1" } } } }),
      fetchApi: vi.fn(),
    } as unknown as LawApiClient
    const result = await verifyCitations(api, { text: "민법 제1조, 대법원 2099 다 123 판결", maxCitations: 15 })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("[HALLUCINATION_DETECTED]")
    expect(result.content[0].text).toContain("✗ 2099다123")
  })

  it("공백형 판례도 5건 상한 이후 미검증으로 집계한다", async () => {
    const fetchApi = vi.fn(async (args: { extraParams: { nb: string } }) =>
      `<PrecSearch><totalCnt>1</totalCnt><prec><사건번호>${args.extraParams.nb}</사건번호></prec></PrecSearch>`)
    const result = await verifyCitations({ fetchApi } as unknown as LawApiClient, {
      text: Array.from({ length: 6 }, (_, i) => `2021 다 ${100 + i}`).join(", "), maxCitations: 15,
    })
    expect(result.content[0].text).toContain("[PARTIAL_VERIFIED]")
    expect(result.content[0].text).toContain("판례 인용 6건")
    expect(result.content[0].text).toContain("⊘ 1 미검증")
    expect(fetchApi).toHaveBeenCalledTimes(5)
  })

  it("공백·결합 사건번호를 추출하고 비사건 산문·수량은 차단한다", () => {
    expect(extractCaseNumbers("대법원 2021 다 123, 96 누 4671 판결")).toEqual(["2021다123", "96누4671"])
    expect(fieldHasExactCase("2021 다 123, 2021 다 456", "2021다456")).toBe(true)
    expect(extractCaseNumbers("2030 도 3000명 증가, 2027 예산 500억원, 2027 회계 3분기")).toEqual([])
  })

  it.each(["2030 도 3000 명 증가", "2027 가 123 개 사업", "2030 도 3000   명이 증가"])(
    "수량 앞 공백 산문을 미래 판례 환각으로 단정하지 않는다: %s", async text => {
      const fetchApi = vi.fn()
      const result = await verifyCitations({ fetchApi } as unknown as LawApiClient, { text, maxCitations: 15 })
      expect(result.content[0].text).toContain("[NO_CITATIONS_FOUND]")
      expect(result.content[0].text).not.toContain("[HALLUCINATION_DETECTED]")
      expect(fetchApi).not.toHaveBeenCalled()
    }
  )

  it("공백 수량 가드가 번호 일부로 백트래킹하거나 실인용 뒤 보통 단어를 지우지 않는다", () => {
    expect(extractCaseNumbers("2030 도 3000123 명, 2027 가 1234567 개")).toEqual([])
    expect(extractCaseNumbers("대법원 2021 다 123 원심, 96 누 4671 조문 해석 판결"))
      .toEqual(["2021다123", "96누4671"])
    expect(extractCaseNumbers("대법원 2021 다 123의 판시취지, 96 누 4671을 인용한다"))
      .toEqual(["2021다123", "96누4671"])
  })
})
