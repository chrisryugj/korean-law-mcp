import { describe, expect, it, vi } from "vitest"
import { getBatchArticles } from "./batch-articles.js"
import { requestContext } from "../lib/session-state.js"
import type { LawApiClient } from "../lib/api-client.js"

const law = (number: string | number, branch: string | number = "0") => JSON.stringify({ 법령: {
  기본정보: { 법령명_한글: "검토법" },
  조문: { 조문단위: { 조문여부: "조문", 조문번호: number, 조문가지번호: branch, 조문내용: "조문 본문" } },
} })

describe("get_batch_articles production regressions", () => {
  it("normalizes numeric article and branch numbers from JSON", async () => {
    const client = { getLawText: async () => law(10, 2) } as unknown as LawApiClient
    const response = await getBatchArticles(client, { mst: "numeric-batch-review", articles: ["제10조의2"] })
    expect(response.isError).toBeFalsy()
    expect(response.content[0].text).toContain("조문 본문")
    expect(response.content[0].text).not.toContain("padStart")
  })

  it("shares the whole-law fetch when repeated entries run together", async () => {
    const getLawText = vi.fn(async () => {
      await new Promise(resolve => setImmediate(resolve))
      return law("1")
    })
    const response = await getBatchArticles({ getLawText } as unknown as LawApiClient, {
      laws: [{ mst: "duplicate-batch-review", articles: ["제1조"] }, { mst: "duplicate-batch-review", articles: ["제1조"] }],
    })
    expect(response.isError).toBeFalsy()
    expect(getLawText).toHaveBeenCalledTimes(1)
    expect(response.content[0].text.match(/조문 본문/g)).toHaveLength(2)
  })

  it("does not return successful partial output after cancellation during its final chunk", async () => {
    const controller = new AbortController()
    const client = { getLawText: async (input: { mst: string }) => {
      if (input.mst === "cancelled-batch-review") {
        await new Promise(resolve => setImmediate(resolve))
        controller.abort(new Error("Review request cancelled"))
        throw controller.signal.reason
      }
      return law("1")
    } } as unknown as LawApiClient
    const response = await requestContext.run({ signal: controller.signal }, () => getBatchArticles(client, {
      laws: [{ mst: "success-batch-review", articles: ["제1조"] }, { mst: "cancelled-batch-review", articles: ["제1조"] }],
    }))
    expect(response.isError).toBe(true)
    expect(response.content[0].text).not.toContain("조문 본문")
  })
})
