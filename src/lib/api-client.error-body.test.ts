import { afterEach, describe, expect, it, vi } from "vitest"
import { LawApiClient } from "./api-client.js"

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("HTTP error responses", () => {
  it("discards a stalled error body without delaying the known HTTP failure", async () => {
    vi.useFakeTimers()
    const cancel = vi.fn(() => new Promise<void>(() => {}))
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      new ReadableStream<Uint8Array>({ cancel }),
      { status: 401 },
    )))
    let error: unknown
    const pending = new LawApiClient({ apiKey: "test" }).fetchApi({
      endpoint: "lawService.do", target: "prec", type: "JSON",
    }).catch(value => { error = value })

    await vi.advanceTimersByTimeAsync(1)
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).toContain("401")
    expect(cancel).toHaveBeenCalledOnce()
    await pending
    expect(vi.getTimerCount()).toBe(0)
  })
})
