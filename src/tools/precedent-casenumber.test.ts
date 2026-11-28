/** get_precedent_text. 사건번호로 바로 (법제처 law-mcp get_precedent case_no 대조) */
import { describe, expect, it, vi } from "vitest"
import type { LawApiClient } from "../lib/api-client.js"
import { getPrecedentText } from "./precedents.js"

describe("get_precedent_text caseNumber", () => {
  it("같은 사건번호의 판례일련번호를 찾아 본문을 받는다", async () => {
    const fetchApi = vi.fn(async ({ endpoint, extraParams }: { endpoint: string; extraParams: Record<string, string> }) => {
      if (endpoint === "lawSearch.do") return `<PrecSearch><totalCnt>2</totalCnt><prec id="1"><판례일련번호>111</판례일련번호><사건번호>2013다613810</사건번호></prec><prec id="2"><판례일련번호>222</판례일련번호><사건번호>2013다61381</사건번호></prec></PrecSearch>`
      return JSON.stringify({ PrecService: { 판례정보일련번호: extraParams.ID, 사건명: "손해배상", 사건번호: "2013다61381", 법원명: "대법원", 선고일자: "20140101", 판시사항: "판시", 판결요지: "요지", 판례내용: "내용" } })
    })
    const r = await getPrecedentText({ fetchApi } as unknown as LawApiClient, { caseNumber: "2013다 61381" })
    expect(fetchApi.mock.calls[0][0].extraParams.nb).toBe("2013다61381")
    expect(fetchApi.mock.calls.some(c => c[0].extraParams?.ID === "222")).toBe(true)
    expect(r.isError).toBeFalsy()
  })
  it("없으면 NOT_FOUND", async () => {
    const fetchApi = vi.fn(async () => `<PrecSearch><totalCnt>0</totalCnt></PrecSearch>`)
    const r = await getPrecedentText({ fetchApi } as unknown as LawApiClient, { caseNumber: "2099다1" })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain("[NOT_FOUND]")
  })
})
