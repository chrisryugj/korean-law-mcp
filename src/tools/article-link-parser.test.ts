import { describe, it, expect } from "vitest"
import { parseArticleLinks } from "./article-link-parser.js"
import { UpstreamRecordMissingError } from "../lib/upstream-miss.js"
import type { LawApiClient } from "../lib/api-client.js"

// 2026-09-23 리뷰 D8: 조문 조회 오류를 "조문을 찾을 수 없습니다."로 덮어 장애가 부존재로 읽히던 결함.
// law-text 캐시에 걸리지 않게 테스트마다 다른 MST를 쓴다.
describe("parseArticleLinks: 조문 조회 오류를 그대로 돌려준다 (D8)", () => {
  it("[UPSTREAM_NO_DATA]를 보존한다", async () => {
    const client = {
      getLawText: async () => {
        throw new UpstreamRecordMissingError("https://www.law.go.kr/DRF/lawService.do?OC=***&target=eflaw&MST=990001", "empty")
      },
    } as unknown as LawApiClient
    const r = await parseArticleLinks(client, { mst: "990001", jo: "제38조" })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain("[UPSTREAM_NO_DATA]")
    expect(r.content[0].text).not.toContain("조문을 찾을 수 없습니다.")
  })

  it("업스트림 장애(503)는 장애로 보고한다", async () => {
    const client = {
      getLawText: async () => { throw new Error("법제처 서버 오류 (503) - getLawText") },
    } as unknown as LawApiClient
    const r = await parseArticleLinks(client, { mst: "990002", jo: "제38조" })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain("법제처 서버 오류 (503)")
  })
})
