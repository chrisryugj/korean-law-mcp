import { describe, it, expect } from "vitest"
import { fetchHistoricalVersionsFull } from "./historical-utils.js"
import type { LawApiClient } from "./api-client.js"

/** lsHistory HTML 행 — parseHistoryRows의 링크·공포번호·날짜셀·제개정 정규식에 맞춤 */
const row = (lawNm: string, mst: string, efYd: string, ancNo: string, ancYmd: string, rrCls: string) =>
  `<tr><td><a href="/lsInfoP.do?MST=${mst}&efYd=${efYd}">${lawNm}</a></td><td>제${ancNo}호</td><td>${ancYmd}</td><td>${rrCls}</td></tr>`

const page = (totalCount: number, rows: string[]) =>
  `<html><body><strong>${totalCount}</strong> 건<table>${rows.join("\n")}</table></body></html>`

describe("fetchHistoricalVersionsFull — 동일 시행일 tie-break", () => {
  // 세법류는 매년 1.1. 시행 공포본이 여러 건 겹친다 (예: 소득세법 2010.1.1. =
  // 제9924호 타법개정 + 제9897호 일부개정). 나중 공포본이 앞선 공포본을 반영한
  // 통합본이므로 공포일·공포번호 내림차순이어야 한다. tie-break 없이는
  // 페이지 수집 순서라는 우연이 versions[0]을 결정했다.
  it("같은 시행일이면 공포일·공포번호가 큰 쪽이 앞선다", async () => {
    // 일부러 앞선 공포본(제9897호)을 페이지 앞쪽에 배치 — 수집 순서로는 틀리게
    const html = page(2, [
      row("소득세법", "131405", "20100101", "9897", "2009.12.31", "일부개정"),
      row("소득세법", "98343", "20100101", "9924", "2010.01.01", "타법개정"),
    ])
    const client = {
      fetchApi: async () => html,
    } as unknown as LawApiClient

    const r = await fetchHistoricalVersionsFull(client, "소득세법", undefined, 500)
    expect(r.versions.map(v => v.mst)).toEqual(["98343", "131405"])
  })

  it("시행일이 다르면 시행일 내림차순이 우선한다", async () => {
    const html = page(2, [
      row("소득세법", "100", "20100101", "9999", "2010.01.01", "일부개정"),
      row("소득세법", "200", "20100310", "9763", "2009.06.09", "타법개정"),
    ])
    const client = {
      fetchApi: async () => html,
    } as unknown as LawApiClient

    const r = await fetchHistoricalVersionsFull(client, "소득세법", undefined, 500)
    expect(r.versions.map(v => v.mst)).toEqual(["200", "100"])
  })
})
