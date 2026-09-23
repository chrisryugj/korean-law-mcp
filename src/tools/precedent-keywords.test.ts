import { describe, it, expect } from "vitest"
import { extractPrecedentKeywords } from "./precedent-keywords.js"
import { UpstreamRecordMissingError } from "../lib/upstream-miss.js"
import type { LawApiClient } from "../lib/api-client.js"

// 2026-09-23 리뷰 D8: 판례 조회의 오류 결과를 "[NOT_FOUND] 판례를 찾을 수 없습니다"로 덮던 결함.
describe("extractPrecedentKeywords: 판례 조회 오류 라벨을 보존한다 (D8)", () => {
  it("[UPSTREAM_NO_DATA]를 [NOT_FOUND]로 바꾸지 않는다", async () => {
    const client = {
      fetchApi: async () => {
        throw new UpstreamRecordMissingError("https://www.law.go.kr/DRF/lawService.do?OC=***&target=prec&ID=1", "html")
      },
    } as unknown as LawApiClient
    const r = await extractPrecedentKeywords(client, { id: "1", maxKeywords: 10 })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain("[UPSTREAM_NO_DATA]")
    expect(r.content[0].text).not.toContain("[NOT_FOUND]")
  })
})
