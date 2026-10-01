import { describe, expect, it, vi } from "vitest"
import type { LawApiClient } from "../lib/api-client.js"
import { getDailyToLegal, getLegalToDaily } from "./knowledge-base.js"

describe("knowledge-base fallback API-key scope", () => {
  it.each([
    ["daily-to-legal", getDailyToLegal, { dailyTerm: "월세", apiKey: "caller-key" }],
    ["legal-to-daily", getLegalToDaily, { legalTerm: "임대차", apiKey: "caller-key" }],
  ])("retains the caller's explicit API key in %s fallback search", async (_name, handler, input) => {
    const fetchApi = vi.fn()
      .mockResolvedValueOnce("<root><검색결과개수>0</검색결과개수></root>")
      .mockResolvedValueOnce("<LsTrmSearch><totalCnt>1</totalCnt><lstrm><법령용어명>임대차</법령용어명></lstrm></LsTrmSearch>")
    const result = await handler({ fetchApi } as unknown as LawApiClient, input as never)
    expect(result.isError).toBeFalsy()
    expect(fetchApi).toHaveBeenCalledTimes(2)
    expect(fetchApi.mock.calls[0][0].apiKey).toBe("caller-key")
    expect(fetchApi.mock.calls[1][0]).toMatchObject({ target: "lstrm", apiKey: "caller-key" })
  })
})
