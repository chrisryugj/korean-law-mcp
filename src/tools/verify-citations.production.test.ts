import { beforeEach, describe, expect, it, vi } from "vitest"
import { verifyCitations } from "./verify-citations.js"
import { lawCache } from "../lib/cache.js"
import { requestContext } from "../lib/session-state.js"
import type { LawApiClient } from "../lib/api-client.js"

const lawSearch = `<LawSearch><totalCnt>1</totalCnt><law><법령일련번호>100</법령일련번호><법령명한글>민법</법령명한글><법령ID>001706</법령ID></law></LawSearch>`

function client() {
  return {
    searchLaw: vi.fn(async () => lawSearch),
    getLawText: vi.fn(async () => JSON.stringify({ 법령: { 조문: { 조문단위: [1, 2].map(n => ({ 조문여부: "조문", 조문번호: String(n) })) } } })),
    fetchApi: vi.fn(async (args: { extraParams?: { nb?: string } }) =>
      `<PrecSearch><totalCnt>1</totalCnt><prec><사건번호>${args.extraParams?.nb}</사건번호><판례명>검증 판례</판례명></prec></PrecSearch>`),
  }
}

describe("citation verification completion status", () => {
  beforeEach(() => lawCache.clear())

  it("marks unverified statute citations beyond maxCitations as partial", async () => {
    const api = client()
    const result = await verifyCitations(api as unknown as LawApiClient, { text: "민법 제1조, 민법 제2조", maxCitations: 1 })
    expect(result.content[0].text).toContain("[PARTIAL_VERIFIED]")
    expect(result.content[0].text).toContain("1건은 확인 상한(1건)을 넘어 검증하지 않았습니다")
    expect(api.getLawText).toHaveBeenCalledTimes(1)
  })

  it("marks cases beyond the five-case scan cap as partial", async () => {
    const api = client()
    const result = await verifyCitations(api as unknown as LawApiClient, {
      text: Array.from({ length: 6 }, (_, i) => `2020다${100 + i}`).join(", "), maxCitations: 15,
    })
    expect(result.content[0].text).toContain("[PARTIAL_VERIFIED]")
    expect(result.content[0].text).toContain("⊘ 1 미검증")
    expect(api.fetchApi).toHaveBeenCalledTimes(5)
  })

  it("stops case verification when the request is cancelled during lookup", async () => {
    const abort = new AbortController()
    const api = client()
    api.fetchApi.mockImplementation(async () => { abort.abort(); throw new Error("cancelled upstream") })
    const result = await requestContext.run({ signal: abort.signal }, () =>
      verifyCitations(api as unknown as LawApiClient, { text: "2020다100", maxCitations: 15 }))
    expect(result.isError).toBe(true)
    expect(result.content[0].text).not.toContain("[PARTIAL_VERIFIED]")
  })

  it("does not start statute lookups after cancellation while resolving names", async () => {
    const abort = new AbortController()
    const api = client()
    api.searchLaw.mockImplementation(async () => { abort.abort(); throw new Error("cancelled upstream") })
    const result = await requestContext.run({ signal: abort.signal }, () =>
      verifyCitations(api as unknown as LawApiClient, { text: "민법 제1조", maxCitations: 15 }))
    expect(result.isError).toBe(true)
    expect(api.searchLaw).toHaveBeenCalledTimes(1)
    expect(api.getLawText).not.toHaveBeenCalled()
  })
})
