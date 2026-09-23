import { describe, it, expect } from "vitest"
import { summarizePrecedent } from "./precedent-summary.js"
import { UpstreamRecordMissingError } from "../lib/upstream-miss.js"
import type { LawApiClient } from "../lib/api-client.js"

// 2026-09-23 리뷰 D8: 판례 조회의 오류 결과를 "[NOT_FOUND] 판례를 찾을 수 없습니다"로 덮던 결함.
// prec 단건 조회 미스는 부존재를 증명하지 않는 [UPSTREAM_NO_DATA]다. 라벨이 바뀌면 거짓 부정이 된다.
describe("summarizePrecedent: 판례 조회 오류 라벨을 보존한다 (D8)", () => {
  it("[UPSTREAM_NO_DATA]를 [NOT_FOUND]로 바꾸지 않는다", async () => {
    const client = {
      fetchApi: async () => {
        throw new UpstreamRecordMissingError("https://www.law.go.kr/DRF/lawService.do?OC=***&target=prec&ID=1", "empty")
      },
    } as unknown as LawApiClient
    const r = await summarizePrecedent(client, { id: "1", maxLength: 500 })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain("[UPSTREAM_NO_DATA]")
    expect(r.content[0].text).not.toContain("[NOT_FOUND]")
  })
})
