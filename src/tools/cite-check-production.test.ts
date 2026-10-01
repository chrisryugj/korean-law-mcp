import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LawApiClient } from "../lib/api-client.js"
import { scanTreatment } from "../lib/precedent-body.js"
import { citeCheck } from "./cite-check.js"
import { getPrecedentText, precedentCache } from "./precedents.js"

beforeEach(() => precedentCache.clear())

const row = (id: string, caseNo: string, date = "20200101") => `<prec>` +
  `<판례일련번호>${id}</판례일련번호><사건명>손해배상</사건명><사건번호>${caseNo}</사건번호>` +
  `<법원명>대법원</법원명><선고일자>${date}</선고일자></prec>`
const xml = (...rows: string[]) => `<PrecSearch><totalCnt>${rows.length}</totalCnt><page>1</page>${rows.join("")}</PrecSearch>`

describe("cite_check 대상과 인용 범위", () => {
  it("판례 본문 조회 후 인용 추적과 재조회가 상세 record를 공유한다", async () => {
    const fetchApi = vi.fn(async (request: { endpoint: string; extraParams: Record<string, string> }) => {
      if (request.endpoint === "lawService.do") return JSON.stringify({ PrecService: { 판례내용: "본문" } })
      return request.extraParams.nb ? xml(row("target", "2013다61381")) : xml()
    })
    const api = { fetchApi } as unknown as LawApiClient
    await getPrecedentText(api, { id: "target", full: true })
    await citeCheck(api, { caseNumber: "2013다61381", display: 20, deepScan: true })
    await citeCheck(api, { caseNumber: "2013다61381", display: 20, deepScan: true })
    expect(fetchApi.mock.calls.filter(([r]) => r.endpoint === "lawService.do")).toHaveLength(1)
  })

  it("앞부분이 같은 이웃 판례보다 정확히 일치하는 사건번호를 선택한다", async () => {
    const fetchApi = vi.fn(async (request: { endpoint: string; extraParams: Record<string, string> }) => {
      if (request.endpoint === "lawService.do") return JSON.stringify({ PrecService: { 판례내용: "본문" } })
      if (request.extraParams.nb) return xml(row("wrong", "2013다613810"), row("right", "2013다61381"))
      return xml()
    })
    const result = await citeCheck({ fetchApi } as unknown as LawApiClient, {
      caseNumber: "2013다61381", display: 20, deepScan: true,
    })
    expect(result.content[0].text).not.toContain("입력 사건번호와 다른 판례")
    expect(fetchApi.mock.calls.some(([r]) => r.extraParams.ID === "right")).toBe(true)
  })

  it("부분 사건번호로 다른 판례가 특정되면 실제 판례 번호로 인용을 조회한다", async () => {
    const fetchApi = vi.fn(async (request: { endpoint: string; extraParams: Record<string, string> }) => {
      if (request.endpoint === "lawService.do") return JSON.stringify({ PrecService: { 판례내용: "본문" } })
      if (request.extraParams.nb) return xml(row("target", "2013다61381"))
      return xml()
    })
    await citeCheck({ fetchApi } as unknown as LawApiClient, { caseNumber: "2013다6138", display: 20, deepScan: true })
    expect(fetchApi.mock.calls.some(([r]) => r.extraParams.query === "2013다61381")).toBe(true)
  })

  it("deepScan=false는 변경 신호를 검사한 것처럼 인증하지 않는다", async () => {
    const api = { fetchApi: async (request: { endpoint: string; extraParams: Record<string, string> }) => {
      if (request.endpoint === "lawService.do") return JSON.stringify({ PrecService: { 판례내용: "본문" } })
      return request.extraParams.nb ? xml(row("target", "2013다61381")) : xml(row("later", "2021다1", "20220101"))
    } } as unknown as LawApiClient
    const result = await citeCheck(api, { caseNumber: "2013다61381", display: 20, deepScan: false })
    expect(result.content[0].text).not.toContain("✅")
    expect(result.content[0].text).toContain("정밀 스캔 미실행")
  })

  it("검색에 걸렸어도 본문에서 대상 인용을 찾지 못하면 변경 미감지로 인증하지 않는다", async () => {
    const api = { fetchApi: async (request: { endpoint: string; extraParams: Record<string, string> }) => {
      if (request.endpoint === "lawService.do") return JSON.stringify({ PrecService: {
        판례내용: "대법원 2013다613810 판결을 변경하기로 한다.",
      } })
      return request.extraParams.nb ? xml(row("target", "2013다61381")) : xml(row("later", "2021다1", "20220101"))
    } } as unknown as LawApiClient
    const result = await citeCheck(api, { caseNumber: "2013다61381", display: 20, deepScan: true })
    expect(result.content[0].text).not.toContain("✅")
    expect(result.content[0].text).not.toContain("인용 확인 (변경 문구 없음)")
    expect(result.content[0].text).toContain("대상 사건번호 인용 확인 불가")
  })

  it("대상보다 앞선 판결을 후속 인용으로 표시하지 않는다", async () => {
    const api = { fetchApi: async (request: { endpoint: string; extraParams: Record<string, string> }) => {
      if (request.endpoint === "lawService.do") return JSON.stringify({ PrecService: { 판례내용: "본문" } })
      return request.extraParams.nb ? xml(row("target", "2013다61381", "20181030")) :
        xml(row("earlier", "2015다1", "20170101"))
    } } as unknown as LawApiClient
    const result = await citeCheck(api, { caseNumber: "2013다61381", display: 20, deepScan: true })
    expect(result.content[0].text).toContain("후속 인용 없음")
    expect(result.content[0].text).not.toContain("2015다1")
  })
})

describe("변경 신호의 사건번호 경계", () => {
  it("긴 사건번호 안의 prefix를 대상 사건번호의 변경 신호로 삼지 않는다", () => {
    expect(scanTreatment("대법원 2013다613810 판결을 변경하기로 한다.", "2013다61381").changeSignals).toEqual([])
    expect(scanTreatment("대법원 2013 다 61381 판결을 변경하기로 한다.", "2013다61381").changeSignals)
      .toEqual(["판례 변경 선언"])
  })
})
