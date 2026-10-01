import { describe, expect, it, vi } from "vitest"
import type { LawApiClient } from "../lib/api-client.js"
import { findSimilarPrecedents } from "./similar-precedents.js"

describe("유사 판례 점수와 검색 안내 경계", () => {
  it("fallback 검색어·다음호출 안내를 마지막 판례의 내용이나 점수에 넣지 않는다", async () => {
    const fetchApi = vi.fn(async (args: { extraParams: { search?: string } }) =>
      args.extraParams.search === "2"
        ? `<PrecSearch><totalCnt>2</totalCnt><page>1</page>${[1, 2].map(id =>
          `<prec><판례일련번호>${id}</판례일련번호><사건명>손해배상</사건명><사건번호>2024다${id}</사건번호></prec>`).join("")}</PrecSearch>`
        : `<PrecSearch><totalCnt>0</totalCnt><page>1</page></PrecSearch>`)
    const result = await findSimilarPrecedents({ fetchApi } as unknown as LawApiClient, {
      query: "임대차 보증금", display: 2,
    })
    expect(result.isError).toBeFalsy()
    const text = result.content[0].text
    expect(text.indexOf("[1]")).toBeLessThan(text.indexOf("[2]"))
    expect([...text.matchAll(/유사도 점수: ([\d.]+)/g)].map(m => m[1])).toEqual(["0.0", "0.0"])
    expect(text).not.toContain("검색 보정:")
    expect(text).not.toContain("💡 다음:")
  })
})
