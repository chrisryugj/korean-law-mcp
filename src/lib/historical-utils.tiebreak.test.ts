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
  it("같은 시행일이면 공포일·공포번호가 큰 쪽이 앞선다 (실측 무패딩 날짜)", async () => {
    // 일부러 앞선 공포본(제9897호)을 페이지 앞쪽에 배치 — 수집 순서로는 틀리게.
    // ★날짜는 실측 lsHistory 형식(0패딩 없음): "2010.1.1"의 한 자리 월·일이
    // 파싱되지 않으면 공포일이 ""(=0)이 되어 tie-break가 역전된다 (G21 결함).
    const html = page(2, [
      row("소득세법", "131405", "20100101", "9897", "2009.12.31", "일부개정"),
      row("소득세법", "98343", "20100101", "9924", "2010.1.1", "타법개정"),
    ])
    const client = {
      fetchApi: async () => html,
    } as unknown as LawApiClient

    const r = await fetchHistoricalVersionsFull(client, "소득세법", undefined, 500)
    expect(r.versions.map(v => v.mst)).toEqual(["98343", "131405"])
  })

  it("'폐지제정' 행이 '폐지'로 오분류되지 않는다", async () => {
    // 지방세법 제827호(1961.12.8. 폐지제정, 시행 1962.1.1.) 유형 — 구법 폐지 +
    // 동명 신법 제정. "폐지"로 표시되면 유효한 재제정판을 폐지된 법으로 오독하게 한다.
    const html = page(1, [row("지방세법", "52908", "19620101", "827", "1961.12.8", "폐지제정")])
    const client = {
      fetchApi: async () => html,
    } as unknown as LawApiClient

    const r = await fetchHistoricalVersionsFull(client, "지방세법", undefined, 500)
    expect(r.versions[0].rrCls).toBe("폐지제정")
  })

  it("같은 날 폐지(구법)와 제정(신법)이 겹치면 신법이 앞선다 — 근로기준법 1997 유형", async () => {
    // 1997.3.13. 구 근로기준법 폐지(제5305호) + 새 근로기준법 제정(제5309호) 동시.
    // tie-break가 없거나 역전되면 폐지된 구법 레코드를 '시행 중'으로 내놓는다.
    const html = page(2, [
      row("근로기준법", "4974", "19970313", "5305", "1997.3.13", "폐지"),
      row("근로기준법", "53681", "19970313", "5309", "1997.3.13", "제정"),
    ])
    const client = {
      fetchApi: async () => html,
    } as unknown as LawApiClient

    const r = await fetchHistoricalVersionsFull(client, "근로기준법", undefined, 500)
    expect(r.versions.map(v => v.mst)).toEqual(["53681", "4974"])
    expect(r.versions[0].rrCls).toBe("제정")
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
