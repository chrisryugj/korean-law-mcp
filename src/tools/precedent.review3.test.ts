import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LawApiClient } from "../lib/api-client.js"
import { requestContext } from "../lib/session-state.js"
import { getPrecedentRecord, getPrecedentText, precedentCache } from "./precedents.js"
import { summarizePrecedent } from "./precedent-summary.js"
import { extractPrecedentKeywords } from "./precedent-keywords.js"

beforeEach(() => precedentCache.clear())

describe("판례 본문과 캐시 적중 경계", () => {
  it.each([getPrecedentText, summarizePrecedent, extractPrecedentKeywords].map(handler => [handler.name, handler] as const))(
    "%s: 메타데이터·참조만 있는 응답을 상세·분석 성공으로 보고하지 않는다", async (_name, handler) => {
      const fetchApi = vi.fn(async () => JSON.stringify({ PrecService: {
        사건명: "보험금", 사건번호: "2022다1234", 참조조문: "민법 제105조", 참조판례: "2019다4321",
        판례내용: { "#text": "<br/> &nbsp; " },
      } }))
      const result = await handler({ fetchApi } as unknown as LawApiClient, {
        id: "empty", maxLength: 500, maxKeywords: 10,
      })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("[UPSTREAM_NO_DATA]")
      expect(result.content[0].text).not.toContain("[NOT_FOUND]")
      expect(precedentCache.size()).toBe(0)
    }
  )

  it("취소된 요청은 이미 캐시된 판례 상세도 반환하지 않는다", async () => {
    const fetchApi = vi.fn(async () => JSON.stringify({ PrecService: { 판례내용: "판결 이유" } }))
    const api = { fetchApi } as unknown as LawApiClient
    await getPrecedentRecord(api, { id: "cached" })
    const reason = new Error("user cancelled cached lookup")
    await expect(requestContext.run({ signal: AbortSignal.abort(reason) }, () =>
      getPrecedentRecord(api, { id: "cached" }))).rejects.toBe(reason)
    expect(fetchApi).toHaveBeenCalledTimes(1)
  })

  it("요약할 판시·요지·주문이 없으면 메타데이터만 요약 성공으로 내보내지 않는다", async () => {
    const api = { fetchApi: async () => JSON.stringify({ PrecService: {
      사건명: "보험금", 사건번호: "2022다1234", 판례내용: "본문의 이유만 제공되어 있다.",
    } }) } as unknown as LawApiClient
    const result = await summarizePrecedent(api, { id: "no-summary", maxLength: 500 })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("[UPSTREAM_NO_DATA]")
  })

  it("독립된 한글 법률용어를 영문 단어 경계로 놓치거나 4글자로 자르지 않는다", async () => {
    const api = { fetchApi: async () => JSON.stringify({ PrecService: {
      판례내용: "손해배상책임 손해배상책임 이행의무 이행의무",
    } }) } as unknown as LawApiClient
    const result = await extractPrecedentKeywords(api, { id: "legal-keywords", maxKeywords: 10 })
    expect(result.content[0].text).toContain("손해배상책임 (2회)")
    expect(result.content[0].text).toContain("이행의무 (2회)")
  })
})
