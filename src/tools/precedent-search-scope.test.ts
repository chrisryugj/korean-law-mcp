/**
 * 판례 검색범위 옵트인 (#167) — 제목검색이 1건만 맞아도 끝나서 법리 탐색 recall 이 낮던 문제.
 * 기본 동작은 그대로 두고 search="both"(판례명+본문)와 소량 적중 안내를 더한다.
 */
import { describe, expect, it, vi } from "vitest"
import type { LawApiClient } from "../lib/api-client.js"
import { searchPrecedentsStructured } from "./precedent-search-core.js"
import { renderPrecedentSearchResult } from "./precedents.js"

type Request = { extraParams: Record<string, string> }

const item = (id: string, title: string) =>
  `<prec><판례일련번호>${id}</판례일련번호><사건명>${title}</사건명>` +
  `<사건번호>2020다${id}</사건번호><선고일자>20240101</선고일자></prec>`
const page = (total: number, ...items: string[]) =>
  `<PrecSearch><totalCnt>${total}</totalCnt><page>1</page>${items.join("")}</PrecSearch>`

// 실측(2026-10-05) 모양: "학원강사 근로자" 제목검색 1건, 본문검색 70건
const titleXml = page(1, item("1", "학원강사를 근로자수에 포함"))
const bodyXml = page(70, item("1", "학원강사를 근로자수에 포함"), item("2", "퇴직금"), item("3", "임금"))

function api() {
  const fetchApi = vi.fn(async (request: Request) => request.extraParams.search === "2" ? bodyXml : titleXml)
  return { fetchApi, client: { fetchApi } as unknown as LawApiClient }
}

describe('search="both": 판례명+본문 합침', () => {
  it("두 검색을 모두 돌려 판례ID로 중복을 빼고 제목 적중을 앞에 둔다", async () => {
    const { fetchApi, client } = api()
    const result = await searchPrecedentsStructured(client, { query: "학원강사 근로자", search: "both", display: 20, page: 1 })
    expect(fetchApi).toHaveBeenCalledTimes(2)
    expect(result.hits.map(hit => [hit.id, hit.searchMode])).toEqual([["1", 1], ["2", 2], ["3", 2]])
    expect(result.fallbackUsed).toBe(false)
  })

  it("렌더가 범위별 건수와 건마다 어느 검색에서 맞았는지 보인다", async () => {
    const text = renderPrecedentSearchResult(
      await searchPrecedentsStructured(api().client, { query: "학원강사 근로자", search: "both", display: 20, page: 1 })
    )
    expect(text).toContain("제목검색 1건 · 본문검색 70건")
    expect(text).toMatch(/\[1\] 학원강사를 근로자수에 포함\n(?:.*\n)*?  적중: 제목검색/)
    expect(text).toMatch(/\[2\] 퇴직금\n(?:.*\n)*?  적중: 본문검색/)
  })

  it("사건번호만 넣으면 both 여도 exact 조회 한 번으로 끝난다", async () => {
    const { fetchApi, client } = api()
    await searchPrecedentsStructured(client, { query: "2020다1", search: "both", display: 20, page: 1 })
    expect(fetchApi).toHaveBeenCalledTimes(1)
    expect(fetchApi.mock.calls[0][0].extraParams.nb).toBe("2020다1")
  })
})

describe("search 문자열 입력 (search_decisions options 는 스키마 검증 없이 넘어온다)", () => {
  it('"2" 는 본문검색으로 보낸다', async () => {
    const { fetchApi, client } = api()
    await searchPrecedentsStructured(client, { query: "학원강사 근로자", search: "2" as never, display: 20, page: 1 })
    expect(fetchApi.mock.calls[0][0].extraParams.search).toBe("2")
  })
})

describe("제목검색 소량 적중 안내", () => {
  const hint = /본문검색도 보세요/

  it("제목검색이 3건 이하로 끝나면 search 옵션을 안내한다", async () => {
    const text = renderPrecedentSearchResult(
      await searchPrecedentsStructured(api().client, { query: "학원강사 근로자", display: 20, page: 1 })
    )
    expect(text).toMatch(hint)
    expect(text).toContain('options={search:"both"}')
  })

  it("제목검색 적중이 많거나 both·본문검색이면 안내하지 않는다", async () => {
    const many = { fetchApi: async () => page(4, item("1", "가"), item("2", "나"), item("3", "다"), item("4", "라")) } as unknown as LawApiClient
    for (const [client, search] of [[many, undefined], [api().client, "both"], [api().client, 2]] as const) {
      const text = renderPrecedentSearchResult(
        await searchPrecedentsStructured(client, { query: "학원강사 근로자", search, display: 20, page: 1 })
      )
      expect(text).not.toMatch(hint)
    }
  })
})
