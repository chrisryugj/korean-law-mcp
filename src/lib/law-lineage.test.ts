import { describe, it, expect, beforeEach } from "vitest"
import { fetchLawVersions, fetchLineageVersions, nameTimeline, resolveLawId, versionInForce, wholeRevisionsBetween } from "./law-lineage.js"
import { lawCache } from "./cache.js"
import type { LawApiClient } from "./api-client.js"

// lawSearch.do?target=eflaw&LID=009694&nw=1,2,3 실응답 형식 축약 (2026-09-28).
// 법령ID 하나에 이름 셋(2004 붙여쓰기 → 2013 띄어쓰기 → 2022 전부개정 신명칭), 분리시행 슬라이스(MST 166678 두 행) 포함.
const row = (mst: string, efYd: string, name: string, ancNo: string, ancYd: string, rr: string, id = "009694") =>
  `<law id="x"><법령일련번호>${mst}</법령일련번호><현행연혁코드>연혁</현행연혁코드><법령명한글><![CDATA[${name}]]></법령명한글>` +
  `<법령ID>${id}</법령ID><공포일자>${ancYd}</공포일자><공포번호>${ancNo}</공포번호><제개정구분명>${rr}</제개정구분명><시행일자>${efYd}</시행일자></law>`
const lineageXml = (total: number, rows: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><LawSearch><target>eflaw</target><totalCnt>${total}</totalCnt><page>1</page>${rows.join("")}</LawSearch>`

const NEW = "소방시설 설치 및 관리에 관한 법률 시행령"
const MID = "소방시설 설치ㆍ유지 및 안전관리에 관한 법률 시행령"
const OLD = "소방시설설치유지및안전관리에관한법률시행령"
const ROWS = [
  row("287375", "20260701", NEW, "36432", "20260623", "타법개정"),
  row("245535", "20221201", NEW, "33004", "20221129", "전부개정"),
  row("166678", "20150407", MID, "26033", "20150106", "일부개정"),
  row("166678", "20150108", MID, "26033", "20150106", "일부개정"),
  row("59719", "20040530", OLD, "18404", "20040529", "제정"),
]

describe("fetchLineageVersions — 법령ID 계보", () => {
  it("이름이 달라도 같은 법령ID면 한 목록, 분리시행 슬라이스는 시행일별로 남는다", async () => {
    const client = { fetchApi: async () => lineageXml(5, ROWS) } as unknown as LawApiClient
    const { versions } = await fetchLineageVersions(client, "009694")
    expect(versions.map(v => `${v.mst}:${v.efYd}`)).toEqual([
      "287375:20260701", "245535:20221201", "166678:20150407", "166678:20150108", "59719:20040530",
    ])
    expect(versions[2].lawNm).toBe(MID)
    expect(versions[2].ancNo).toBe("26033")
  })

  it("LID 가 무시돼 다른 법령만 오면 더 받지 않고 빈 결과 (전 목록 16만 행을 페이지로 긁지 않는다)", async () => {
    let calls = 0
    const client = {
      fetchApi: async () => { calls++; return lineageXml(168865, [row("1", "20200101", "문화기본법", "1", "20200101", "제정", "010719")]) },
    } as unknown as LawApiClient
    const r = await fetchLineageVersions(client, "009694")
    expect(r.versions).toEqual([])
    expect(calls).toBe(1)
  })

  it("LID 가 무시됐는데 첫 쪽에 그 법령이 섞여 와도 총계가 상한을 넘으면 더 받지 않는다", async () => {
    let calls = 0
    const client = {
      fetchApi: async () => { calls++; return lineageXml(168865, [row("1", "20200101", NEW, "1", "20200101", "일부개정")]) },
    } as unknown as LawApiClient
    expect((await fetchLineageVersions(client, "009694")).versions).toEqual([])
    expect(calls).toBe(1)
  })

  it("총계가 한 페이지를 넘으면 나머지 페이지를 받는다", async () => {
    const pages: string[] = []
    const client = {
      fetchApi: async (p: { extraParams: Record<string, string> }) => {
        pages.push(p.extraParams.page)
        return lineageXml(250, [row(`m${p.extraParams.page}`, `2020010${p.extraParams.page}`, NEW, "1", "20200101", "일부개정")])
      },
    } as unknown as LawApiClient
    const r = await fetchLineageVersions(client, "009694")
    expect(pages.sort()).toEqual(["1", "2", "3"])
    expect(r.versions).toHaveLength(3)
  })
})

describe("계보 해석 도우미", () => {
  const versions = [
    { mst: "287375", efYd: "20260701", ancNo: "36432", ancYd: "20260623", lawNm: NEW, rrCls: "타법개정" },
    { mst: "245535", efYd: "20221201", ancNo: "33004", ancYd: "20221129", lawNm: NEW, rrCls: "전부개정" },
    { mst: "166678", efYd: "20150407", ancNo: "26033", ancYd: "20150106", lawNm: MID, rrCls: "일부개정" },
    { mst: "59719", efYd: "20040530", ancNo: "18404", ancYd: "20040529", lawNm: OLD, rrCls: "제정" },
  ]

  it("versionInForce: 기준일 이하 최신 시행일", () => {
    expect(versionInForce(versions, "20150601")?.mst).toBe("166678")
    expect(versionInForce(versions, "20221201")?.mst).toBe("245535")
    expect(versionInForce(versions, "20000101")).toBeUndefined()
  })

  it("nameTimeline: 공백·가운뎃점만 다른 표기는 한 이름으로, 표기는 나중 것", () => {
    expect(nameTimeline(versions)).toEqual([
      { name: MID, from: "20040530" },   // OLD 는 MID 와 공백·가운뎃점만 다르다
      { name: NEW, from: "20221201" },
    ])
  })

  it("wholeRevisionsBetween: (from, to] 구간의 전부개정", () => {
    expect(wholeRevisionsBetween(versions, "20150407", "20260701").map(v => v.mst)).toEqual(["245535"])
    expect(wholeRevisionsBetween(versions, "20221201", "20260701")).toEqual([])
  })
})

const searchXml = (rows: Array<[string, string, string?]>) =>
  `<?xml version="1.0" encoding="UTF-8"?><LawSearch><totalCnt>${rows.length}</totalCnt>` +
  rows.map(([name, id, st]) => `<law id="1"><법령일련번호>1</법령일련번호><법령명한글><![CDATA[${name}]]></법령명한글><법령ID>${id}</법령ID><법령구분명>대통령령</법령구분명>${st ? `<현행연혁코드>${st}</현행연혁코드>` : ""}</law>`).join("") +
  `</LawSearch>`

describe("resolveLawId — 현행명·약칭·옛 이름", () => {
  beforeEach(() => lawCache.clear())

  it("완전일치가 접두 일치(모법 ↔ 시행령)보다 먼저다", async () => {
    const client = {
      searchLaw: async () => searchXml([["소방시설 설치 및 관리에 관한 법률", "009503"], [NEW, "009694"]]),
    } as unknown as LawApiClient
    expect((await resolveLawId(client, NEW))?.lawId).toBe("009694")
  })

  it("약칭 + 시행령 접미('소방시설법 시행령')도 푼다", async () => {
    const queries: string[] = []
    const client = {
      searchLaw: async (q: string) => { queries.push(q); return searchXml([[NEW, "009694"]]) },
    } as unknown as LawApiClient
    expect((await resolveLawId(client, "소방시설법 시행령"))?.lawId).toBe("009694")
    expect(queries[0]).toBe(NEW)
  })

  it("현행 검색에 없는 옛 이름은 연혁(eflaw) 검색에서 법령ID를 찾는다", async () => {
    const client = {
      searchLaw: async (_q: string, _k?: string, _d?: number, target?: string) =>
        target === "eflaw" ? searchXml([[MID, "009694", "연혁"]]) : searchXml([[NEW, "009694"]]),
    } as unknown as LawApiClient
    const r = await resolveLawId(client, MID)
    expect(r).toEqual({ lawId: "009694", matchedName: MID })
  })

  it("무관한 부분매칭뿐이면 undefined (엉뚱한 법령으로 진행하지 않는다)", async () => {
    const client = { searchLaw: async () => searchXml([["1980년해직공무원의보상등에관한특별조치법", "001348"]]) } as unknown as LawApiClient
    expect(await resolveLawId(client, "상법")).toBeUndefined()
  })
})

describe("fetchLawVersions — 계보 실패 시 이름 기반 폴백", () => {
  beforeEach(() => lawCache.clear())

  it("계보가 비면 lsHistory 로 물러서고 source=name 을 밝힌다", async () => {
    const client = {
      fetchApi: async (p: { target: string }) => p.target === "lsHistory"
        ? `<html><strong>1</strong> 건<table><tr><td><a href="/x?MST=10&efYd=20200101">민법</a></td><td>제1호</td><td>2020.1.1</td><td>일부개정</td></tr></table></html>`
        : lineageXml(0, []),
    } as unknown as LawApiClient
    const r = await fetchLawVersions(client, "민법", undefined, "001706")
    expect(r.source).toBe("name")
    expect(r.versions[0].mst).toBe("10")
  })
})
