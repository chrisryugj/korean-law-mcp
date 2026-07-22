import { describe, it, expect, vi, afterEach } from "vitest"
import { LawApiClient } from "./api-client.js"

// 법제처 DRF의 간헐 404 (버스트 스로틀): 2026-07-19 행위시법 골드셋 R1에서
// applicable_law 19콜 중 10콜이 lsHistory 404 즉사 — 수초 뒤 같은 요청은 성공.
// 404가 retryOn에 없으면 재시도 없이 [EXTERNAL_API_ERROR]로 전파된다.
describe("LawApiClient — DRF 간헐 404 재시도", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("fetchApi: 404 후 성공 응답이 오면 재시도로 회복한다", async () => {
    const calls: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(String(url))
      if (calls.length === 1) return new Response("Not Found", { status: 404 })
      return new Response("<html><body><strong>1</strong> 건</body></html>", { status: 200 })
    }))

    const client = new LawApiClient({ apiKey: "test" })
    const html = await client.fetchApi({
      endpoint: "lawSearch.do",
      target: "lsHistory",
      type: "HTML",
      extraParams: { query: "소득세법", display: "500", sort: "efdes", page: "1" },
    })

    expect(calls.length).toBe(2)          // 1차 404 → 재시도 성공 (HTML 정상 응답에 추가 재시도 없음)
    expect(html).toContain("<strong>1</strong>")
  }, 15000)

  it("fetchApi(type=HTML): 정상 HTML 응답은 재시도 없이 1회로 끝난다", async () => {
    // 회귀: 빈본문/HTML 휴리스틱이 type=HTML 정상 응답까지 '점검 페이지'로 오인해
    // 매 호출 재시도 소진(요청 4배 증폭 + 지연 ~7s)을 태웠다 — lsHistory 페이징이
    // 특히 느려지고 DRF 버스트 404를 유발하는 공범.
    let n = 0
    vi.stubGlobal("fetch", vi.fn(async () => {
      n++
      return new Response("<html><body><strong>606</strong> 건</body></html>", { status: 200 })
    }))

    const client = new LawApiClient({ apiKey: "test" })
    const html = await client.fetchApi({
      endpoint: "lawSearch.do",
      target: "lsHistory",
      type: "HTML",
      extraParams: { query: "소득세법" },
    })
    expect(n).toBe(1)
    expect(html).toContain("606")
  }, 15000)

  it("fetchApi: 404가 지속되면 재시도 소진 후 기존과 동일하게 오류 전파", async () => {
    let n = 0
    vi.stubGlobal("fetch", vi.fn(async () => {
      n++
      return new Response("Not Found", { status: 404 })
    }))

    const client = new LawApiClient({ apiKey: "test" })
    await expect(client.fetchApi({
      endpoint: "lawSearch.do",
      target: "lsHistory",
      type: "HTML",
      extraParams: { query: "소득세법" },
    })).rejects.toThrow(/404/)
    expect(n).toBeGreaterThan(1)          // 최소 1회 이상 재시도했는지
  }, 30000)
})
