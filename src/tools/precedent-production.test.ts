import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { LawApiClient } from "../lib/api-client.js"
import { ExecutionLimitError } from "../lib/execution-limits.js"
import { runWithRequestContext } from "../lib/session-state.js"
import { getPrecedentText, precedentCache } from "./precedents.js"
import { searchPrecedentsStructured } from "./precedent-search-core.js"
import { validatePrecedentSearchResult } from "./precedent-evidence.js"

const args = { query: "양도소득세 사기 취소 가능한가", display: 5, page: 1 }
const xml = (date = "20240101") => `<PrecSearch><totalCnt>1</totalCnt><page>1</page><prec>` +
  `<판례일련번호>1</판례일련번호><사건명>양도소득세 사기</사건명>` +
  `<사건번호>2020다1</사건번호><선고일자>${date}</선고일자></prec></PrecSearch>`
const empty = "<PrecSearch><totalCnt>0</totalCnt><page>1</page></PrecSearch>"

beforeEach(() => precedentCache.clear())
afterEach(() => vi.restoreAllMocks())

describe("판례 상세 JSON 필드", () => {
  it("배열과 text 래퍼를 판시사항·본문·메타데이터 모두에서 정규화한다", async () => {
    const api = { fetchApi: async () => JSON.stringify({ PrecService: {
      사건명: { "#text": "손해배상" }, 사건번호: ["2020다1", "2020다2"],
      판시사항: [{ "#text": "첫째<br/>둘째" }, "셋째"],
      판례내용: { _: "법리를 판단한다.<br/>원심판결을 파기한다." },
    } }) } as unknown as LawApiClient
    const result = await getPrecedentText(api, { id: "1" })
    expect(result.isError).toBeFalsy()
    expect(result.content[0].text).not.toContain("[object Object]")
    expect(result.content[0].text).toContain("=== 손해배상 ===")
    expect(result.content[0].text).toContain("첫째\n둘째 셋째")
    expect(result.content[0].text).toContain("법리를 판단한다.\n원심판결을 파기한다.")
  })

  it.each([new ExecutionLimitError("budget exceeded"), new Error("cancelled")])(
    "예산 소진·취소에 HTML 복구 요청을 시작하지 않는다: %s", async (error) => {
      const fetchApi = vi.fn(async () => { throw error })
      const signal = error instanceof ExecutionLimitError ? undefined : AbortSignal.abort(error)
      await expect(runWithRequestContext({ signal }, () => getPrecedentText(
        { fetchApi } as unknown as LawApiClient, { id: "1" }
      ))).rejects.toBe(error)
      expect(fetchApi).toHaveBeenCalledTimes(signal ? 0 : 1)
    }
  )
})

describe("판례 전용 문서 캐시", () => {
  it("full·축약 조회가 upstream과 JSON 파싱을 각각 한 번만 수행한다", async () => {
    const body = JSON.stringify({ PrecService: { 사건명: "손해배상", 판례내용: "판결 이유다. ".repeat(500) } })
    const fetchApi = vi.fn(async () => body)
    const parse = vi.spyOn(JSON, "parse")
    const api = { fetchApi } as unknown as LawApiClient
    const full = await getPrecedentText(api, { id: "cache", full: true })
    const compact = await getPrecedentText(api, { id: "cache" })
    expect(full.content[0].text).not.toContain("⋯ 중략")
    expect(compact.content[0].text).toContain("⋯ 중략")
    expect(fetchApi).toHaveBeenCalledTimes(1)
    expect(parse).toHaveBeenCalledTimes(1)
  })

  it("21건 조회 후 20건만 보관하고 가장 오래된 판례를 재조회한다", async () => {
    const fetchApi = vi.fn(async () => JSON.stringify({ PrecService: { 사건명: "손해배상", 판례내용: "본문" } }))
    const api = { fetchApi } as unknown as LawApiClient
    for (let id = 0; id < 21; id++) await getPrecedentText(api, { id: String(id) })
    expect(precedentCache.size()).toBe(20)
    await getPrecedentText(api, { id: "20" })
    expect(fetchApi).toHaveBeenCalledTimes(21)
    await getPrecedentText(api, { id: "0" })
    expect(fetchApi).toHaveBeenCalledTimes(22)
    expect(precedentCache.size()).toBe(20)
  })
})

describe("판례 fallback 검증", () => {
  it("사건번호만 입력하면 인용 판례 제목검색보다 사건번호 exact 검색을 우선한다", async () => {
    const fetchApi = vi.fn(async () => xml().replace("<totalCnt>1", "<totalCnt>9"))
    const result = await searchPrecedentsStructured({ fetchApi } as unknown as LawApiClient,
      { query: "2020다1", display: 5, page: 1 })
    expect(result.hits[0].caseNumber).toBe("2020다1")
    expect(result.totalCount).toBe(1)
    expect(fetchApi.mock.calls[0]).toEqual([{ endpoint: "lawSearch.do", target: "prec",
      extraParams: { nb: "2020다1", display: "5", page: "1" }, apiKey: undefined }])
  })

  it("사건번호 exact 검색 miss를 이웃 판례나 역인용으로 대체하지 않는다", async () => {
    const fetchApi = vi.fn(async () => xml())
    const result = await searchPrecedentsStructured({ fetchApi } as unknown as LawApiClient,
      { query: "2020다12", display: 5, page: 1 })
    expect(result.hits).toEqual([])
    expect(fetchApi).toHaveBeenCalledTimes(1)
  })

  it("search=2의 사건번호 query는 명시된 역인용 본문검색을 유지한다", async () => {
    const fetchApi = vi.fn(async () => xml())
    await searchPrecedentsStructured({ fetchApi } as unknown as LawApiClient,
      { query: "2020다12", search: 2, display: 5, page: 1 })
    expect(fetchApi.mock.calls[0]).toEqual([{ endpoint: "lawSearch.do", target: "prec",
      extraParams: { query: "2020다12", search: "2", display: "5", page: "1" }, apiKey: undefined }])
  })

  it("검증 중 예산 소진은 검색 실패로 삼키고 다른 검색어로 재시도하지 않는다", async () => {
    const error = new ExecutionLimitError("validation budget exceeded")
    const validateResult = vi.fn(async () => { throw error })
    const api = { fetchApi: async (request: { extraParams: { query: string } }) =>
      request.extraParams.query === args.query ? empty : xml() } as unknown as LawApiClient
    await expect(searchPrecedentsStructured(api, args, { validateResult })).rejects.toBe(error)
    expect(validateResult).toHaveBeenCalledTimes(1)
  })

  it("검증이 필요한 후보는 기간 밖 결과를 보여줄 때도 검증한다", async () => {
    const validateResult = vi.fn(async () => false)
    const api = { fetchApi: async (request: { extraParams: { query: string } }) =>
      request.extraParams.query === args.query ? empty : xml("20190101") } as unknown as LawApiClient
    const result = await searchPrecedentsStructured(api, {
      ...args, fromDate: "20240101", toDate: "20241231",
    }, { validateResult })
    expect(validateResult).toHaveBeenCalled()
    expect(result.hits).toEqual([])
  })

  it("서로 다른 판례의 키워드를 합쳐 관련성이 확인된 것처럼 취급하지 않는다", async () => {
    const fetchApi = vi.fn(async () => JSON.stringify({ PrecService: {
      사건명: "양도소득세", 판례내용: "양도소득세 법리만 판단한다.",
    } }))
    const accepted = await validatePrecedentSearchResult({ fetchApi } as unknown as LawApiClient, {
      originalArgs: args,
      attempt: { query: "양도소득세 사기", search: 1, reason: "original_keyword", totalCount: 2,
        hitCount: 2, success: true, validationTermGroups: [["양도소득세"], ["사기"]] },
      hits: [{ id: "1", title: "양도소득세", searchMode: 1 }, { id: "2", title: "사기", searchMode: 1 }],
    })
    expect(accepted).toBe(false)
    expect(fetchApi).toHaveBeenCalledTimes(1)
  })
})
