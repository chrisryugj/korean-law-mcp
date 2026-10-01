import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LawApiClient } from "../lib/api-client.js"
import { citeCheck } from "./cite-check.js"
import { precedentCache } from "./precedents.js"

beforeEach(() => precedentCache.clear())

const row = (id: string, caseNo: string) => `<prec><판례일련번호>${id}</판례일련번호>` +
  `<사건명>손해배상</사건명><사건번호>${caseNo}</사건번호><법원명>대법원</법원명></prec>`
const xml = (...rows: string[]) => `<PrecSearch><totalCnt>${rows.length}</totalCnt><page>1</page>${rows.join("")}</PrecSearch>`

describe("cite_check 대상 검색 경계", () => {
  it.each(["2013다61381", "96누4671"])("띄어 쓴 사건번호도 본문 스캔과 동일하게 정규화한다: %s", async caseNo => {
    const fetchApi = vi.fn(async (request: { endpoint: string; extraParams: Record<string, string> }) => {
      if (request.endpoint === "lawService.do") return JSON.stringify({ PrecService: { 판례내용: "본문" } })
      return request.extraParams.nb ? xml(row("target", caseNo)) : xml()
    })
    const result = await citeCheck({ fetchApi } as unknown as LawApiClient, {
      caseNumber: `대법원 2018. 10. 30. 선고 ${caseNo.replace(/(\d)([가-힣]+)(\d)/, "$1 $2 $3")} 판결`, display: 20, deepScan: true,
    })
    expect(result.isError).toBeFalsy()
    expect(fetchApi.mock.calls.some(([r]) => r.extraParams.nb === caseNo)).toBe(true)
  })

  it("nb 검색이 무관한 사건을 반환하면 다른 판례를 대상 판례로 대체하지 않는다", async () => {
    const fetchApi = vi.fn(async (request: { endpoint: string; extraParams: Record<string, string> }) => {
      if (request.endpoint === "lawService.do") return JSON.stringify({ PrecService: { 판례내용: "본문" } })
      return request.extraParams.nb ? xml(row("wrong", "2020다11111")) : xml()
    })
    const result = await citeCheck({ fetchApi } as unknown as LawApiClient, {
      caseNumber: "2013다61381", display: 20, deepScan: true,
    })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("찾을 수 없습니다")
    expect(fetchApi.mock.calls.some(([r]) => r.endpoint === "lawService.do")).toBe(false)
    expect(fetchApi.mock.calls.some(([r]) => r.extraParams.query === "2020다11111")).toBe(false)
  })
})
