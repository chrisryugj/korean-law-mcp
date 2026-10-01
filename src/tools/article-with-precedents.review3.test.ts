import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LawApiClient } from "../lib/api-client.js"
import { lawCache } from "../lib/cache.js"
import { getArticleWithPrecedents, GetArticleWithPrecedentsSchema } from "./article-with-precedents.js"

beforeEach(() => lawCache.clear())

describe("조문→판례 검색 핸드오프", () => {
  it("JO 코드는 자연어 조번호로 검색하고 유사 조번호·타법을 제거한다", async () => {
    const getLawText = vi.fn(async () => JSON.stringify({ 법령: {
      기본정보: { 법령명_한글: "관세법" },
      조문: { 조문단위: { 조문여부: "조문", 조문번호: "38", 조문내용: "제38조 신고납부" } },
    } }))
    const rows = ["관세법 제38조 위반", "관세법 제383조 위반", "상법 제38조 위반", "관세법 제36조~제40조 위반"]
    const fetchApi = vi.fn(async (_request: unknown) => `<PrecSearch><totalCnt>4</totalCnt><page>1</page>${rows.map((title, i) =>
      `<prec><판례일련번호>${i + 1}</판례일련번호><사건명>${title}</사건명></prec>`).join("")}</PrecSearch>`)
    const api = { getLawText, fetchApi } as unknown as LawApiClient
    const result = await getArticleWithPrecedents(api, GetArticleWithPrecedentsSchema.parse({ mst: "review3", jo: "003800" }))
    expect(fetchApi.mock.calls[0]?.[0]).toMatchObject({ extraParams: { query: "관세법 제38조" } })
    expect(result.content[0].text).toContain("[1] 관세법 제38조")
    expect(result.content[0].text).toContain("[4] 관세법 제36조~제40조")
    expect(result.content[0].text).not.toContain("[2]")
    expect(result.content[0].text).not.toContain("[3]")
  })
})
