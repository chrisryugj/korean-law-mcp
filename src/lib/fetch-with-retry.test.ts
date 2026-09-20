import { afterEach, describe, it, expect, vi } from "vitest"
import { describeFetchError, fetchWithRetry, maskSensitiveUrl } from "./fetch-with-retry.js"

// Critical Rule 11: URL/에러 메시지 외부 노출 전 API 키 마스킹 (회귀 시 키 유출)
describe("maskSensitiveUrl — API 키 마스킹", () => {
  it("법제처 OC 키를 *** 처리 (다른 파라미터는 보존)", () => {
    expect(
      maskSensitiveUrl("http://www.law.go.kr/DRF/lawService.do?OC=mysecret&target=law&MST=160001"),
    ).toBe("http://www.law.go.kr/DRF/lawService.do?OC=***&target=law&MST=160001")
  })
  it("소문자 oc 및 흔한 키 파라미터 이름들도 마스킹", () => {
    expect(maskSensitiveUrl("https://x/?oc=k")).toBe("https://x/?oc=***")
    expect(maskSensitiveUrl("https://x/?apiKey=abc&q=1")).toBe("https://x/?apiKey=***&q=1")
    expect(maskSensitiveUrl("https://x/?auth_key=abc")).toBe("https://x/?auth_key=***")
  })
  it("키가 없으면 원본 그대로", () => {
    expect(maskSensitiveUrl("https://www.law.go.kr/DRF/lawSearch.do?query=민법")).toBe(
      "https://www.law.go.kr/DRF/lawSearch.do?query=민법",
    )
  })
  it("빈 문자열은 안전하게 통과", () => {
    expect(maskSensitiveUrl("")).toBe("")
  })
})

// #150-7: Retry-After 값을 그대로 믿으면 업스트림 헤더 하나가 대기를 임의로 늘린다
// (3600 → 1시간 sleep). 상한 30초로 클램프 — 도구 타임아웃(30초)과 같은 자리다.
describe("getRetryDelay — Retry-After 상한", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("비상식적으로 큰 Retry-After도 30초로 클램프한다", async () => {
    vi.useFakeTimers()
    let n = 0
    vi.stubGlobal("fetch", vi.fn(async () => {
      n++
      return n === 1
        ? new Response("busy", { status: 429, headers: { "Retry-After": "3600" } })
        : new Response("<ok/>", { status: 200 })
    }))

    const pending = fetchWithRetry("https://example.com/x", { retryDelay: 1 })
    // 클램프 상한(30초)까지 시계를 돌리면 재시도가 이미 발사됐어야 한다
    await vi.advanceTimersByTimeAsync(30_100)
    expect(n).toBe(2)
    await expect(pending).resolves.toMatchObject({ status: 200 })
  })
})

// #161: undici 의 `fetch failed` 는 cause(ECONNRESET·ENOTFOUND·UND_ERR_CONNECT_TIMEOUT…)를 감춘 채
// 표면화돼, 리전 egress 드롭인지 법제처 점검인지 사후에 가를 수 없었다. code·메시지·호스트를 붙인다.
describe("describeFetchError — fetch failed 원인 표면화", () => {
  const url = "https://www.law.go.kr/DRF/lawSearch.do?OC=secret&target=law&query=법인세법"

  it("cause 의 code·메시지와 호스트를 붙인다", () => {
    const err = new TypeError("fetch failed", { cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }) })
    expect(describeFetchError(err, url)).toBe("fetch failed (ECONNRESET: read ECONNRESET) - www.law.go.kr")
  })

  it("cause 메시지가 code 와 같으면 한 번만 쓴다", () => {
    const err = new TypeError("fetch failed", { cause: Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" }) })
    expect(describeFetchError(err, url)).toBe("fetch failed (ETIMEDOUT) - www.law.go.kr")
  })

  it("cause 에 API 키가 실려 와도 마스킹된다", () => {
    const err = new TypeError("fetch failed", {
      cause: Object.assign(new Error(`Connect Timeout Error (attempted address: ${url})`), { code: "UND_ERR_CONNECT_TIMEOUT" }),
    })
    const msg = describeFetchError(err, url)
    expect(msg).toContain("UND_ERR_CONNECT_TIMEOUT")
    expect(msg).not.toContain("secret")
  })

  it("fetch failed 가 아니거나 cause 가 없으면 기존 마스킹만", () => {
    expect(describeFetchError(new Error(`boom ${url}`), url)).toBe(`boom ${url.replace("secret", "***")}`)
    expect(describeFetchError(new TypeError("fetch failed"), url)).toBe("fetch failed")
  })

  it("fetchWithRetry 가 재시도를 다 태우면 원인이 붙은 에러로 던진다", async () => {
    vi.useFakeTimers()
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("getaddrinfo ENOTFOUND www.law.go.kr"), { code: "ENOTFOUND" }) })
    }))
    const pending = fetchWithRetry(url, { retries: 1, retryDelay: 1 })
    const assertion = expect(pending).rejects.toThrow("fetch failed (ENOTFOUND: getaddrinfo ENOTFOUND www.law.go.kr) - www.law.go.kr")
    await vi.advanceTimersByTimeAsync(100)
    await assertion
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("[upstream] 2회 시도 실패: fetch failed (ENOTFOUND"))
    spy.mockRestore()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
})
