import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchWithRetry } from "./fetch-with-retry.js"
import { DEFAULT_EXECUTION_LIMITS, RequestExecutionBudget } from "./execution-limits.js"
import { requestContext } from "./session-state.js"

afterEach(() => vi.unstubAllGlobals())

describe("cancelled fetch caller", () => {
  it("does not start or charge upstream work when the caller signal is already aborted", async () => {
    const controller = new AbortController()
    controller.abort("caller cancelled")
    const fetch = vi.fn(async () => { throw new DOMException("aborted", "AbortError") })
    vi.stubGlobal("fetch", fetch)
    const budget = new RequestExecutionBudget(DEFAULT_EXECUTION_LIMITS)

    await expect(requestContext.run({ budget }, () => fetchWithRetry("https://example.com", {
      signal: controller.signal,
    }))).rejects.toMatchObject({ name: "AbortError" })
    expect(fetch).not.toHaveBeenCalled()
    expect(budget.snapshot().upstreamRequests).toBe(0)
  })
})
