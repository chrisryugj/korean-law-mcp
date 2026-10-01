import { describe, it, expect, beforeEach } from "vitest"
import { fetchLawVersions, fetchLineageVersions, nameTimeline, resolveLawId, versionInForce, wholeRevisionsBetween } from "./law-lineage.js"
import { lawCache } from "./cache.js"
import { ExecutionLimitError } from "./execution-limits.js"
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

  it("0 채움 없는 법령ID도 같은 계보로 본다 — 업스트림은 LID=1638 에도 001638 행을 준다 (감사 실측)", async () => {
    const client = { fetchApi: async () => lineageXml(5, ROWS) } as unknown as LawApiClient
    expect((await fetchLineageVersions(client, "9694")).versions).toHaveLength(5)
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

  it("wholeRevisionsBetween: 제정은 앞에 다른 법령 행이 있을 때(동명 재제정)만 — 분리시행 제정본의 뒤 시행분은 아니다", () => {
    // 개인정보 보호법 계보 실측: 제정 MST 111327 이 2011.9.30.·2012.3.30. 두 시행분 (검증 실측 — 종전 정규식이 2012.3.30. 행을 재제정으로 셌다)
    const staggered = [
      { mst: "111327", efYd: "20120330", ancNo: "10465", ancYd: "20110329", lawNm: "개인정보 보호법", rrCls: "제정" },
      { mst: "111327", efYd: "20110930", ancNo: "10465", ancYd: "20110329", lawNm: "개인정보 보호법", rrCls: "제정" },
    ]
    expect(wholeRevisionsBetween(staggered, "20110930", "20120330")).toEqual([])
    const reEnacted = [
      { mst: "53681", efYd: "19970313", ancNo: "5309", ancYd: "19970313", lawNm: "근로기준법", rrCls: "제정" },
      { mst: "4972", efYd: "19900714", ancNo: "04220", ancYd: "19900113", lawNm: "근로기준법", rrCls: "타법개정", priorLaw: true },
    ]
    expect(wholeRevisionsBetween(reEnacted, "19900714", "19970313").map(v => v.mst)).toEqual(["53681"])
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

// 폐지 후 같은 이름으로 재제정돼 법령ID가 바뀐 법령 — 근로기준법(1997.3.13. 구법 폐지·신법 제정, 신법 법령ID 001872).
// eflaw LID 계보는 신법(1997~)뿐이라, 기준일이 그 전이면 "시행 전"으로 답했다(감사 실측: 1995.5.1. → 종전 v4.14.2 는 MST 4972).
const LSA = "근로기준법"
const LSA_LINEAGE = lineageXml(2, [
  row("283457", "20260820", LSA, "21373", "20260219", "타법개정", "001872"),
  row("53681", "19970313", LSA, "05309", "19970313", "제정", "001872"),
])
// lsHistory 실응답 행 형식 (2026-10-01 「근로기준법」): 법령명 링크 · 소관부처 · 제개정구분 · 종류 · 공포번호 · 공포일 · 시행일
const histTr = (mst: string, efYd: string, name: string, rr: string, ancNo: string, ancYd: string) =>
  `<tr><td class="ce">1</td><td><a href="/DRF/lawService.do?OC=x&amp;target=lsHistory&amp;MST=${mst}&amp;type=HTML&amp;mobileYn=&amp;efYd=${efYd}" >${name}</a></td>` +
  `<td class="ce">고용노동부</td><td class="ce">${rr}</td><td class="ce">법률</td><td class="ce">제 ${ancNo}호</td><td class="ce">${ancYd}</td><td class="ce">${efYd}</td><td class="ce">연혁</td></tr>`
const LSA_HISTORY =`<html><strong>7</strong> 건<table>` + [
  histTr("283457", "20260820", LSA, "타법개정", "21373", "2026.2.19"),
  histTr("55265", "19971224", LSA, "일부개정", "05473", "1997.12.24"),   // 계보 시작 뒤 — 받지 않는다
  histTr("53681", "19970313", LSA, "제정", "05309", "1997.3.13"),        // 계보에 있는 MST — 받지 않는다
  histTr("4974", "19970313", LSA, "폐지", "05305", "1997.3.13"),
  histTr("4972", "19900714", LSA, "타법개정", "04220", "1990.1.13"),
  histTr("14383", "19540407", "근로기준법시행령", "제정", "00889", "1954.4.7"),
  histTr("4963", "19530809", LSA, "제정", "00286", "1953.5.10"),
].join("") + `</table></html>`

function lsaClient(targets: string[], lineage = LSA_LINEAGE): LawApiClient {
  return {
    fetchApi: async (p: { target: string }) => {
      targets.push(p.target)
      return p.target === "lsHistory" ? LSA_HISTORY : lineage
    },
  } as unknown as LawApiClient
}

describe("fetchLawVersions — 폐지 후 동명 재제정 (법령ID가 다른 구법)", () => {
  beforeEach(() => lawCache.clear())

  it("기준일이 계보 시작(제정)보다 앞이면 동명 구법 연혁을 이어 붙인다", async () => {
    const targets: string[] = []
    const r = await fetchLawVersions(lsaClient(targets), LSA, undefined, "001872", "19950501")
    expect(r.versions.map(v => `${v.mst}:${v.efYd}`)).toEqual([
      "283457:20260820", "53681:19970313", "4974:19970313", "4972:19900714", "4963:19530809",
    ])
    expect(r.versions.map(v => Boolean(v.priorLaw))).toEqual([false, false, true, true, true])
    expect(r.source).toBe("lineage")
    expect(versionInForce(r.versions, "19950501")?.mst).toBe("4972")
    // 재제정일 당일은 신법 제정 행이 구법 폐지 행보다 앞 — 폐지로 읽지 않는다
    expect(versionInForce(r.versions, "19970313")?.mst).toBe("53681")
    expect(targets.filter(t => t === "lsHistory")).toHaveLength(1)
  })

  it("기준일이 계보 안이거나 기준일이 없으면 lsHistory 를 부르지 않는다 (일반 법령 호출 수 그대로)", async () => {
    for (const asOf of ["19970313", "20000101", undefined]) {
      const targets: string[] = []
      const r = await fetchLawVersions(lsaClient(targets), LSA, undefined, "001872", asOf)
      expect(r.versions, String(asOf)).toHaveLength(2)
      expect(targets, String(asOf)).toEqual(["eflaw"])
    }
  })

  it("계보 첫 행이 제정이 아니면(계보가 덜 온 경우 등) 이름으로 덧붙이지 않는다", async () => {
    const targets: string[] = []
    const partial = lineageXml(1, [row("283457", "20260820", LSA, "21373", "20260219", "타법개정", "001872")])
    const r = await fetchLawVersions(lsaClient(targets, partial), LSA, undefined, "001872", "19950501")
    expect(r.versions).toHaveLength(1)
    expect(targets).toEqual(["eflaw"])
  })

  it("구법 조회 장애는 계보만으로 답한다 (예산 소진·취소는 올린다)", async () => {
    const failing = (error: Error) => ({
      fetchApi: async (p: { target: string }) => { if (p.target === "lsHistory") throw error; return LSA_LINEAGE },
    }) as unknown as LawApiClient
    const r = await fetchLawVersions(failing(new Error("일시 장애")), LSA, undefined, "001872", "19950501")
    expect(r.versions).toHaveLength(2)
    await expect(fetchLawVersions(failing(new ExecutionLimitError("budget")), LSA, undefined, "001872", "19950501"))
      .rejects.toThrow(ExecutionLimitError)
  })
})
