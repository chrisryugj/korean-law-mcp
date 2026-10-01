/**
 * 업스트림 시간 한도 회귀 (2026-09-23 리뷰 A5·A6)
 *
 * - A6: 시도마다 30초를 새로 주면 매달린 업스트림에 4회×30초+백오프로 약 122초가 걸렸다.
 *   MCP 클라이언트는 60초에 포기하므로 오류 문구 없이 끊긴다. 전체 45초를 시도들이 나눠 쓴다.
 * - A5: 헤더가 온 뒤 본문이 멈추면 시도 타이머가 이미 풀려 undici 기본 300초까지 기다렸다.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchWithRetry } from "./fetch-with-retry.js"
import { BODY_IDLE_TIMEOUT_MS, readResponseText, UpstreamBodyStallError } from "./response-body.js"

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** abort 될 때까지 응답하지 않는 fetch */
function hangingFetch(calls: number[]) {
  return vi.fn((_url: string, init?: RequestInit) => {
    calls.push(Date.now())
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true })
    })
  })
}

/** 헤더만 주고 본문은 영영 안 오는 응답 */
const stalledResponse = () => new Response(new ReadableStream<Uint8Array>({ start() { /* 아무것도 안 보낸다 */ } }), { status: 200 })

describe("fetchWithRetry 전체 데드라인 (A6)", () => {
  it("매달린 업스트림도 전체 45초 안에 끝난다 (종전 약 122초)", async () => {
    vi.useFakeTimers()
    vi.spyOn(console, "error").mockImplementation(() => {})
    const calls: number[] = []
    vi.stubGlobal("fetch", hangingFetch(calls))

    const started = Date.now()
    let settledAt = 0
    const pending = fetchWithRetry("https://example.com/x").finally(() => { settledAt = Date.now() })
    const expectation = expect(pending).rejects.toThrow(/Request timeout after/)
    await vi.advanceTimersByTimeAsync(130_000)
    await expectation

    expect(settledAt - started).toBeLessThanOrEqual(45_000)
    expect(calls.length).toBe(2) // 30초 시도 1회 + 남은 시간으로 1회
  })

  it("Retry-After 대기 뒤 시도할 시간이 없으면 기다리지 않고 받은 응답으로 끝낸다", async () => {
    vi.useFakeTimers()
    let n = 0
    vi.stubGlobal("fetch", vi.fn(async () => {
      n++
      return new Response("busy", { status: 503, headers: { "Retry-After": "30" } })
    }))

    let settledAt = 0
    const started = Date.now()
    const pending = fetchWithRetry("https://example.com/x").finally(() => { settledAt = Date.now() })
    await vi.advanceTimersByTimeAsync(130_000)
    await expect(pending).resolves.toMatchObject({ status: 503 })
    expect(n).toBe(2)
    expect(settledAt - started).toBeLessThan(45_000)
  })
})

describe("law.go.kr 본문 정지 (독립 리뷰)", () => {
  it("안티봇 프로브가 정지를 삼키지 않아 전체 45초 안에 끝난다 (종전 재현 80초)", async () => {
    vi.useFakeTimers()
    vi.spyOn(console, "error").mockImplementation(() => {})
    let n = 0
    vi.stubGlobal("fetch", vi.fn(async () => { n++; return stalledResponse() }))

    const started = Date.now()
    let settledAt = 0
    const pending = fetchWithRetry("https://www.law.go.kr/DRF/lawService.do?target=law&MST=1").finally(() => { settledAt = Date.now() })
    const expectation = expect(pending).rejects.toBeInstanceOf(UpstreamBodyStallError)
    await vi.advanceTimersByTimeAsync(130_000)
    await expectation
    expect(settledAt - started).toBeLessThanOrEqual(45_000)
    expect(n).toBeLessThanOrEqual(2)
  })
})

describe("본문 무응답 한도 (A5)", () => {
  it("본문이 멈추면 20초 뒤 UpstreamBodyStallError 로 끝낸다", async () => {
    vi.useFakeTimers()
    const pending = readResponseText(stalledResponse())
    const expectation = expect(pending).rejects.toBeInstanceOf(UpstreamBodyStallError)
    await vi.advanceTimersByTimeAsync(BODY_IDLE_TIMEOUT_MS + 10)
    await expectation
  })

  it("판정 프로브가 멈춘 본문을 만나면 다음 시도로 넘어가 정상 응답을 받는다", async () => {
    vi.useFakeTimers()
    let n = 0
    vi.stubGlobal("fetch", vi.fn(async () => {
      n++
      return n === 1 ? stalledResponse() : new Response("<ok/>", { status: 200 })
    }))

    const pending = fetchWithRetry("https://example.com/x", { retryDelay: 1 })
    await vi.advanceTimersByTimeAsync(BODY_IDLE_TIMEOUT_MS + 1_000)
    const response = await pending
    expect(n).toBe(2)
    expect(await response.text()).toBe("<ok/>")
  })
})

describe("headers, probes and final body share the deadline", () => {
  it("late headers do not grant a stalled probe another idle window", async () => {
    vi.useFakeTimers()
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.stubGlobal("fetch", vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 4_000))
      return stalledResponse()
    }))
    const started = Date.now()
    let settledAt = 0
    const pending = fetchWithRetry("https://example.com/x", { timeout: 5_000, deadline: 5_000 })
      .finally(() => { settledAt = Date.now() })
    const assertion = expect(pending).rejects.toThrow(/timeout/i)
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
    expect(settledAt - started).toBeLessThanOrEqual(5_000)
  })

  it("a caller signal interrupts inspection without a request context", async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    vi.stubGlobal("fetch", vi.fn(async () => stalledResponse()))
    let settled = false
    const pending = fetchWithRetry("https://example.com/x", { signal: controller.signal })
      .finally(() => { settled = true })
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" })
    await vi.advanceTimersByTimeAsync(1)
    controller.abort()
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(true)
    await assertion
  })

  it("a final response cannot stream chunks beyond the total deadline", async () => {
    vi.useFakeTimers()
    let interval: ReturnType<typeof setInterval>
    const cancel = vi.fn(() => clearInterval(interval))
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("<ok>"))
        interval = setInterval(() => controller.enqueue(new TextEncoder().encode("data")), 500)
      },
      cancel,
    }))))
    const started = Date.now()
    let settledAt = 0
    const pending = fetchWithRetry("https://example.com/x", { retries: 0, deadline: 2_000 })
      .then(readResponseText).finally(() => { settledAt = Date.now() })
    const assertion = expect(pending).rejects.toThrow(/timeout/i)
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
    expect(settledAt - started).toBeLessThanOrEqual(2_000)
    expect(cancel).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("a caller signal also interrupts the returned response body", async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    vi.stubGlobal("fetch", vi.fn(async () => stalledResponse()))
    let settled = false
    const response = await fetchWithRetry("https://example.com/x", { retries: 0, signal: controller.signal })
    const pending = readResponseText(response).finally(() => { settled = true })
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" })
    controller.abort()
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(true)
    await assertion
  })

  it("successful reads clear deadline timers and preserve the native response", async () => {
    vi.useFakeTimers()
    const upstream = new Response("<ok/>")
    vi.stubGlobal("fetch", vi.fn(async () => upstream))
    const response = await fetchWithRetry("https://example.com/x", { retries: 0 })
    expect(response).toBe(upstream)
    await expect(readResponseText(response)).resolves.toBe("<ok/>")
    expect(vi.getTimerCount()).toBe(0)
  })

  it("an expired deadline abandons the body even before the first read", async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ cancel }))))
    const response = await fetchWithRetry("https://example.com/x", { retries: 0, deadline: 100 })
    await vi.advanceTimersByTimeAsync(101)
    await expect(readResponseText(response)).rejects.toThrow(/timeout/i)
    expect(cancel).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
