/**
 * 별표 목록 페이지네이션 (#148)
 *
 * 업스트림은 display 를 100 초과로 올려도 100건만 준다(2026-08-17 실측:
 * display=300 → numOfRows=100). 전 건은 page 로만 이어 받을 수 있다.
 * 100건 창 밖의 별표는 선택값으로도 query 필터로도 도달할 수 없었다.
 */
import { describe, expect, it } from "vitest"
import { getAnnexes } from "./annex.js"
import { collectAnnexList, MAX_ANNEX_PAGES } from "./annex-list.js"
import type { LawApiClient } from "../lib/api-client.js"

/** totalCnt 를 보고 page 를 잘라 주는 licbyl 스텁 */
function pagingStub(total: number, opts: { ignorePage?: boolean, omitTotal?: boolean } = {}) {
  const pages: number[] = []
  const client = {
    getAnnexes: async ({ page }: { page?: number }) => {
      pages.push(page ?? 1)
      const at = opts.ignorePage ? 0 : ((page ?? 1) - 1) * 100
      const items = Array.from({ length: Math.max(0, Math.min(100, total - at)) }, (_, i) => ({
        별표번호: String(at + i + 1).padStart(4, "0") + "00",
        별표명: `항목${at + i + 1}`,
        별표종류: "별표",
        관련법령명: "테스트법 시행규칙",
      }))
      return JSON.stringify({
        licBylSearch: {
          ...(opts.omitTotal ? {} : { totalCnt: String(total) }),
          page: String(page ?? 1),
          licbyl: items,
        },
      })
    },
    fetchApi: async () => { throw new Error("본문 조회 없음") },
  } as unknown as LawApiClient
  return { client, pages }
}

describe("collectAnnexList 페이지네이션", () => {
  it("264건을 전부 수집한다 (100건에서 멈추지 않는다)", async () => {
    const { client, pages } = pagingStub(264)
    const r = await collectAnnexList(client, { lawName: "테스트법 시행규칙" })
    expect(r.list).toHaveLength(264)
    expect(pages).toEqual([1, 2, 3])
    expect(r.truncated).toBe(false)
  })

  it("첫 페이지로 충분하면 더 부르지 않는다", async () => {
    const { client, pages } = pagingStub(40)
    expect((await collectAnnexList(client, { lawName: "X" })).list).toHaveLength(40)
    expect(pages).toEqual([1])
  })

  it("정확히 100건이면 2페이지를 부르지 않는다 (경계)", async () => {
    const { client, pages } = pagingStub(100)
    expect((await collectAnnexList(client, { lawName: "X" })).list).toHaveLength(100)
    expect(pages).toEqual([1])
  })

  it("상한에서 멈추고 truncated 로 알린다 (예산 잠식 방지)", async () => {
    const { client, pages } = pagingStub(1200)
    const r = await collectAnnexList(client, { lawName: "X" })
    expect(pages).toHaveLength(MAX_ANNEX_PAGES)
    expect(r.list).toHaveLength(MAX_ANNEX_PAGES * 100)
    expect(r.truncated).toBe(true)
    expect(r.totalCnt).toBe(1200)
  })

  it("업스트림이 page 를 무시해도 무한 루프에 빠지지 않는다", async () => {
    // 같은 페이지를 계속 돌려주면 새로 담기는 항목이 0건 → 즉시 멈춘다
    const { client, pages } = pagingStub(264, { ignorePage: true })
    const r = await collectAnnexList(client, { lawName: "X" })
    // 남은 페이지는 총계만큼 한꺼번에 받는다(v4.15.0) — 무시당해도 총계로 정한 상한(3쪽)에서 끝난다
    expect(pages.sort()).toEqual([1, 2, 3])
    expect(r.list).toHaveLength(100)
    expect(r.truncated).toBe(true)
  })

  it("totalCnt 가 없는 응답은 첫 페이지만 쓴다", async () => {
    const { client, pages } = pagingStub(264, { omitTotal: true })
    expect((await collectAnnexList(client, { lawName: "X" })).list).toHaveLength(100)
    expect(pages).toEqual([1])
  })
})

describe("get_annexes 가 100건 창 밖의 별표에 도달한다 (#148)", () => {
  it("목록 총계가 전 건이다", async () => {
    const { client } = pagingStub(264)
    const r = await getAnnexes(client, { lawName: "테스트법 시행규칙" } as never)
    expect(r.content[0].text).toContain("총 264건")
  })

  it("3페이지에만 있는 별표를 선택값으로 집는다", async () => {
    // 별표 210 = 코드 021000 — 종전에는 1페이지(1~100)만 받아
    // `별표 선택값 "210"에 해당하는 항목을 찾을 수 없습니다` 로 끝났다.
    // (픽스처에 파일 링크가 없어 본문 추출까지는 못 가지만, 항목 특정은 성공한다)
    const { client } = pagingStub(264)
    const r = await getAnnexes(client, { lawName: "테스트법 시행규칙", annexNo: "210" } as never)
    expect(r.content[0].text).not.toContain(`선택값 "210"에 해당하는 항목을 찾을 수 없습니다`)
    expect(r.content[0].text).toContain("항목210")
  })

  it("3페이지에만 있는 별표명을 query 로 좁힌다", async () => {
    const { client } = pagingStub(264)
    const r = await getAnnexes(client, { lawName: "테스트법 시행규칙", query: "항목255" } as never)
    expect(r.content[0].text).toContain("항목255")
    expect(r.content[0].text).not.toContain("일치하는 별표명이 없어")
  })

  it("상한을 넘겨 잘리면 그 사실을 목록에 명시한다", async () => {
    const { client } = pagingStub(1200)
    const r = await getAnnexes(client, { lawName: "테스트법 시행규칙" } as never)
    expect(r.content[0].text).toContain("500건까지만 수집")
  })
})
