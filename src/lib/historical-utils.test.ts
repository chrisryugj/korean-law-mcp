import { describe, it, expect } from "vitest"
import { fetchHistoricalVersionsFull } from "./historical-utils.js"
import type { LawApiClient } from "./api-client.js"

/** lsHistory HTML 행 생성 — parseHistoryRows의 ROW_PATTERN/필드 정규식에 맞춤 */
const row = (lawNm: string, mst: number, efYd: string) =>
  `<tr><td><a href="/lsInfoP.do?MST=${mst}&efYd=${efYd}">${lawNm}</a></td><td>제${mst}호</td><td>${efYd.slice(0, 4)}.${efYd.slice(4, 6)}.${efYd.slice(6, 8)}</td><td>일부개정</td></tr>`

const pageHtml = (totalCount: number, rows: string[]) =>
  `<html><body><strong>${totalCount}</strong> 건<table>${rows.join("\n")}</table></body></html>`

describe("fetchHistoricalVersionsFull — 페이징 종료 판정", () => {
  // 회귀: 종료 판정이 "필터 후 행수 < pageSize"였다.
  // 1페이지 원시 500행(대부분 시행령·규칙)이 본법 몇 건으로 필터링되면
  // 500 미만이라 즉시 종료 → 2페이지의 옛 본법 버전이 통째로 누락됐다.
  it("필터 후 행수가 적어도 원시 총계만큼 페이지를 끝까지 훑는다", async () => {
    // 원시 총 4행, pageSize=2 → 2페이지. 각 페이지에 본법 1행 + 시행령 1행(필터 대상).
    const page1 = pageHtml(4, [
      row("소득세법", 900, "20200101"),
      row("소득세법 시행령", 901, "20200102"),
    ])
    const page2 = pageHtml(4, [
      row("소득세법", 800, "20100101"),   // ← 옛 본법 버전 (종전 코드에선 도달 못함)
      row("소득세법 시행령", 801, "20100102"),
    ])
    const served: string[] = []
    const client = {
      fetchApi: async (p: { extraParams: Record<string, string> }) => {
        served.push(p.extraParams.page)
        return p.extraParams.page === "1" ? page1 : page2
      },
    } as unknown as LawApiClient

    const r = await fetchHistoricalVersionsFull(client, "소득세법", undefined, 2)
    expect(served).toEqual(["1", "2"])
    expect(r.versions.map(v => v.mst)).toEqual(["900", "800"])  // 시행일 내림차순, 옛 버전 포함
    expect(r.fetchedPages).toBe(2)
  })

  it("마지막 페이지에서 정확히 멈춘다 (원시 총계 기준)", async () => {
    const page1 = pageHtml(2, [row("상법", 500, "20200101"), row("상법", 400, "20100101")])
    let calls = 0
    const client = {
      fetchApi: async () => { calls++; return page1 },
    } as unknown as LawApiClient

    const r = await fetchHistoricalVersionsFull(client, "상법", undefined, 2)
    expect(calls).toBe(1)          // 2행 = 총계 2 → 1페이지로 종료
    expect(r.versions).toHaveLength(2)
  })

  it("총계 파싱 실패 시 빈 페이지에서 보수적으로 종료 (무한루프 방지)", async () => {
    const noTotal = `<html><body><table>${row("상법", 500, "20200101")}</table></body></html>`
    const empty = `<html><body><table></table></body></html>`
    let calls = 0
    const client = {
      fetchApi: async () => { calls++; return calls === 1 ? noTotal : empty },
    } as unknown as LawApiClient

    const r = await fetchHistoricalVersionsFull(client, "상법", undefined, 2)
    expect(calls).toBeLessThanOrEqual(2)
    expect(r.versions).toHaveLength(1)
  })

  // 회귀: 총계가 콤마 표기(1,696)로 오면 \d+ 가 "1"만 잡아 totalCount=1 →
  // page*pageSize>=1 이 1페이지 후 참이 되어, 정작 이 함수가 고치려던 대형 법령이
  // 오히려 1페이지에서 조기 종료(역행). 콤마를 제거하고 파싱해야 한다.
  it("콤마 표기 총계(1,696 건)도 파싱해 대형 연혁을 끝까지 훑는다", async () => {
    const withComma = (rows: string[]) =>
      `<html><body><strong>1,696</strong> 건<table>${rows.join("\n")}</table></body></html>`
    const page1 = withComma([row("소득세법", 900, "20200101"), row("소득세법", 899, "20190101")])
    const page2 = withComma([row("소득세법", 800, "20100101"), row("소득세법", 799, "20090101")])
    const served: string[] = []
    const client = {
      fetchApi: async (p: { extraParams: Record<string, string> }) => {
        served.push(p.extraParams.page)
        return p.extraParams.page === "1" ? page1 : page2
      },
    } as unknown as LawApiClient

    const r = await fetchHistoricalVersionsFull(client, "소득세법", undefined, 1000)
    expect(served).toEqual(["1", "2"])                   // 콤마 미파싱이면 1페이지에서 끊겨 "2" 없음
    expect(r.versions.map(v => v.mst)).toContain("800")  // 옛 본법 버전 도달
  })
})
