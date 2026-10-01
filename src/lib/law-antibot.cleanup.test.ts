import { afterEach, describe, expect, it, vi } from "vitest"
import { followLawAntibot } from "./law-antibot.js"
import { requestContext } from "./session-state.js"

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const redirect = `<script>var x={t:'/DRF',h:'/next',o:'?token=1'};location.assign(x.t+x.h+x.o);</script>`

function nonSettlingBody(text = "", status = 200) {
  const cancel = vi.fn(() => new Promise<void>(() => {}))
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      if (text) controller.enqueue(new TextEncoder().encode(text.padEnd(4_096, " ")))
    },
    cancel,
  }), { status })
  return { response, cancel }
}

describe("anti-bot response disposal does not block progress", () => {
  it("returns the replacement even if root stream cancellation never settles", async () => {
    vi.useFakeTimers()
    const original = nonSettlingBody(redirect)
    const replacement = new Response("<ok/>")
    vi.stubGlobal("fetch", vi.fn(async () => replacement))
    let result: Response | null | undefined
    const pending = followLawAntibot(original.response, "https://www.law.go.kr/DRF/original", new Headers(), 1_000)
      .then(value => { result = value })
    await vi.advanceTimersByTimeAsync(1)
    expect(result).toBe(replacement)
    expect(original.cancel).toHaveBeenCalledOnce()
    await pending
    expect(vi.getTimerCount()).toBe(0)
  })

  it("propagates cancellation even if discarded streams never settle", async () => {
    vi.useFakeTimers()
    const original = nonSettlingBody()
    const controller = new AbortController()
    controller.abort("client cancelled")
    let error: unknown
    const pending = requestContext.run({ signal: controller.signal }, () => followLawAntibot(
      original.response, "https://www.law.go.kr/DRF/original", new Headers(), 1_000,
    )).catch(value => { error = value })
    await vi.advanceTimersByTimeAsync(1)
    expect(error).toMatchObject({ name: "AbortError" })
    expect(original.cancel).toHaveBeenCalledOnce()
    await pending
    expect(vi.getTimerCount()).toBe(0)
  })

  it("returns the 404 fallback without awaiting disposal of the failed token body", async () => {
    vi.useFakeTimers()
    const missing = nonSettlingBody("", 404)
    const replacement = new Response("<ok/>")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(missing.response).mockResolvedValueOnce(replacement))
    let result: Response | null | undefined
    const pending = followLawAntibot(new Response(redirect), "https://www.law.go.kr/DRF/original", new Headers(), 1_000)
      .then(value => { result = value })
    await vi.advanceTimersByTimeAsync(1)
    expect(result).toBe(replacement)
    expect(missing.cancel).toHaveBeenCalledOnce()
    await pending
    expect(vi.getTimerCount()).toBe(0)
  })
})
