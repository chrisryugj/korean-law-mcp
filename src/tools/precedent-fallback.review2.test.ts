import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { LawApiClient } from "../lib/api-client.js"
import { fetchWithRetry } from "../lib/fetch-with-retry.js"
import { getPrecedentText, precedentCache } from "./precedents.js"

vi.mock("../lib/fetch-with-retry.js", async importOriginal => ({
  ...await importOriginal<typeof import("../lib/fetch-with-retry.js")>(), fetchWithRetry: vi.fn(),
}))
vi.mock("../lib/external-https-proxy.js", async importOriginal => ({
  ...await importOriginal<typeof import("../lib/external-https-proxy.js")>(), getExternalHttpsProxyConfig: () => null,
}))

beforeEach(() => precedentCache.clear())
afterEach(() => vi.restoreAllMocks())

describe("국세 판례 HTML 복구의 응답 정리", () => {
  it("Location만 사용하는 redirect 응답은 본문을 기다리지 않고 취소한다", async () => {
    const redirect = new Response(new ReadableStream({ start() {} }), {
      status: 302, headers: { location: "https://taxlaw.nts.go.kr/qt/USEQTA002P.do?ntstDcmId=doc" },
    })
    const cancel = vi.spyOn(redirect.body!, "cancel")
    vi.mocked(fetchWithRetry).mockImplementation(async url => {
      if (String(url).includes("action.do")) return new Response(JSON.stringify({ data: { ASIQTB002PR01: {
        dcmDVO: { ntstDcmTtl: "손해배상", ntstDcmCntn: "대법원 판결의 이유를 살펴보고 원심 판단의 적법 여부를 검토한다." },
      } } }))
      return redirect
    })
    const api = { fetchApi: async (request: { type: string }) => request.type === "HTML"
      ? '<input id="precSeq" value="fallback"/><iframe src="https://www.law.go.kr/precInfoP.do?precSeq=fallback"></iframe>'
      : '{"Law":"일치하는 판례가 없습니다."}' } as unknown as LawApiClient
    const result = await getPrecedentText(api, { id: "fallback", full: true })
    expect(result.isError).toBeFalsy()
    expect(result.content[0].text).toContain("국세법령정보시스템 판례")
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})
