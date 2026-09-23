import { describe, it, expect } from "vitest"
import { getArticleWithPrecedents, GetArticleWithPrecedentsSchema } from "./article-with-precedents.js"
import { ExecutionLimitError } from "../lib/execution-limits.js"
import type { LawApiClient } from "../lib/api-client.js"

// 2026-09-23 리뷰 D10: 판례 검색이 실패하든 0건이든 출력이 똑같이 "판례 절 없음"이라 가를 수 없었다.
// 조문 응답은 law-text가 읽는 eflaw JSON 형상 축약. law-text 캐시에 걸리지 않게 테스트마다 MST를 바꾼다.
const lawJson = (name: string) => JSON.stringify({
  법령: {
    기본정보: { 법령명_한글: name, 공포일자: "20260811", 시행일자: "20260811" },
    조문: { 조문단위: [{ 조문여부: "조문", 조문번호: "38", 조문제목: "신고납부", 조문내용: "제38조(신고납부) ① 물품을 수입하려는 자는 세액을 신고하여야 한다." }] },
  },
})

const EMPTY_PREC_XML = `<?xml version="1.0" encoding="UTF-8"?><PrecSearch><target>prec</target><totalCnt>0</totalCnt><page>1</page></PrecSearch>`

function client(precedent: () => Promise<string>) {
  return {
    getLawText: async () => lawJson("관세법"),
    fetchApi: async () => precedent(),
  } as unknown as LawApiClient
}

const run = (c: LawApiClient, mst: string) =>
  getArticleWithPrecedents(c, GetArticleWithPrecedentsSchema.parse({ mst, jo: "제38조" }))

describe("getArticleWithPrecedents: 판례 절 상태를 밝힌다 (D10)", () => {
  it("판례 검색 실패는 조문을 살리되 '조회 실패'로 밝힌다", async () => {
    const r = await run(client(async () => { throw new Error("법제처 서버 오류 (503) - fetchApi(prec)") }), "990101")
    const t = r.content[0].text
    expect(r.isError).toBeFalsy()
    expect(t).toContain("제38조")
    expect(t).toContain("관련 판례: 조회 실패 (법제처 서버 오류 (503)")
    expect(t).toContain("관련 판례가 없다는 뜻이 아닙니다")
  })

  // 독립 리뷰: 판례 부가 검색의 예산 소진이 이미 받은 조문까지 버리게 하지 않는다
  it("판례 검색이 예산 소진으로 실패해도 조문은 돌려준다", async () => {
    const r = await run(client(async () => { throw new ExecutionLimitError("Request upstream work budget exceeded") }), "990103")
    const t = r.content[0].text
    expect(r.isError).toBeFalsy()
    expect(t).toContain("제38조")
    expect(t).toContain("관련 판례: 조회 실패")
  })

  it("0건은 조회 실패와 구별되는 '검색 결과 0건'으로 밝힌다", async () => {
    const r = await run(client(async () => EMPTY_PREC_XML), "990102")
    const t = r.content[0].text
    expect(t).toContain("관련 판례: '관세법 제38조' 검색 결과 0건")
    expect(t).not.toContain("조회 실패")
  })
})
