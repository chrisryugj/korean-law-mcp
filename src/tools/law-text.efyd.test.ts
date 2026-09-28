import { describe, it, expect, beforeEach } from "vitest"
import { getLawText } from "./law-text.js"
import { applicableLaw } from "./applicable-law.js"
import { lawCache } from "../lib/cache.js"
import type { LawApiClient } from "../lib/api-client.js"

const NEW = "소방시설 설치 및 관리에 관한 법률 시행령"
const MID = "소방시설 설치ㆍ유지 및 안전관리에 관한 법률 시행령"
const row = (mst: string, efYd: string, name: string, ancNo: string, rr: string) =>
  `<law id="x"><법령일련번호>${mst}</법령일련번호><법령명한글><![CDATA[${name}]]></법령명한글><법령ID>009694</법령ID>` +
  `<공포일자>${efYd}</공포일자><공포번호>${ancNo}</공포번호><제개정구분명>${rr}</제개정구분명><시행일자>${efYd}</시행일자></law>`
const LINEAGE = `<LawSearch><totalCnt>3</totalCnt>` + [
  row("287375", "20260701", NEW, "36432", "타법개정"),
  row("245535", "20221201", NEW, "33004", "전부개정"),
  row("166678", "20150407", MID, "26033", "일부개정"),
].join("") + `</LawSearch>`
const article = (name: string, efYd: string, body: string) => JSON.stringify({
  법령: {
    기본정보: { 법령명_한글: name, 법령ID: "009694", 시행일자: efYd, 공포일자: efYd },
    조문: { 조문단위: [{ 조문여부: "조문", 조문번호: "15", 조문제목: "소방시설", 조문내용: `제15조(소방시설) ${body}` }] },
    부칙: { 부칙단위: [] },
  },
})

/** 실재 시행일(MST+efYd)만 본문을 주고, 그 밖의 efYd 는 법제처처럼 빈 봉투 */
function client(calls: string[]): LawApiClient {
  return {
    searchLaw: async () => `<LawSearch><law id="1"><법령일련번호>287375</법령일련번호><법령명한글><![CDATA[${NEW}]]></법령명한글><법령ID>009694</법령ID></law></LawSearch>`,
    getLawText: async (p: { mst?: string, lawId?: string, jo?: string, efYd?: string }) => {
      calls.push(`getLawText:${p.mst ?? ""}:${p.lawId ?? ""}:${p.efYd ?? ""}:${p.jo ?? ""}`)
      if (p.mst === "166678" && p.efYd === "20150407") return article(MID, "20150407", "…별표 5와 같다.")
      if (p.mst === "287375" && p.efYd === "20260701") return article(NEW, "20260701", "현행 본문")
      if (p.mst === "287375" && !p.efYd) return article(NEW, "20260701", "")
      return "{}"
    },
    fetchApi: async (p: { target: string, extraParams?: Record<string, string> }) => {
      calls.push(`fetchApi:${p.target}:${p.extraParams?.LID ?? p.extraParams?.MST ?? ""}`)
      if (p.target === "eflaw" && p.extraParams?.LID) return LINEAGE
      if (p.target === "law") return article(NEW, "20260701", "현행 본문")
      throw new Error(`unexpected ${p.target}`)
    },
  } as unknown as LawApiClient
}

describe("get_law_text — 시행일이 아닌 efYd 는 그날 시행 버전으로 보정 (#160 계열)", () => {
  beforeEach(() => lawCache.clear())

  it("lawId + 기준일 → 옛 이름 시절 버전 본문과 보정 사실을 밝힌다", async () => {
    const calls: string[] = []
    const r = await getLawText(client(calls), { lawId: "009694", efYd: "2015-06-01", jo: "제15조" })
    const text = r.content[0].text
    expect(r.isError).toBeFalsy()
    expect(text).toContain("efYd=2015-06-01는 이 법령의 시행일이 아니어서")
    expect(text).toContain("시행 2015.04.07")
    expect(text).toContain(`당시 법령명 「${MID}」`)
    expect(text).toContain("별표 5와 같다")
  })

  it("mst 만 오면 JO=000100 가벼운 조회로 법령ID를 얻는다 (오늘 날짜 efYd → 현행)", async () => {
    const calls: string[] = []
    const r = await getLawText(client(calls), { mst: "287375", efYd: "20990101", jo: "제15조" })
    expect(r.content[0].text).toContain("시행 2026.07.01")
    expect(calls).toContain("getLawText:287375:::000100")
  })

  it("보정이 안 되면(계보 밖 기준일) 종전 NOT_FOUND 와 올바른 재조회 인자를 안내한다", async () => {
    const r = await getLawText(client([]), { lawId: "009694", efYd: "19990101" })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain('get_law_text(lawId="009694")')   // 종전엔 lawId 를 mst= 로 안내했다
  })
})

describe("applicable_law — 제명이 바뀐 법령의 옛 기준일", () => {
  beforeEach(() => lawCache.clear())

  it("2015년 기준일이 '시행 전'이 아니라 옛 이름 시절 버전으로 특정되고, 전부개정 경고가 붙는다", async () => {
    const calls: string[] = []
    const r = await applicableLaw(client(calls), { lawName: "소방시설법 시행령", date: "2015-06-01", jo: "제15조" })
    const text = r.content[0].text
    expect(text).not.toContain("시행 전입니다")
    expect(text).toContain(`${MID} [시행 2015.04.07]`)
    expect(text).toContain("당시 법령명은")
    expect(text).toContain("전부개정(시행 2022.12.01")
    expect(text).toContain("별표 5와 같다")
    // 전부개정이 끼면 같은 조번호 현행 조문은 받지 않는다
    expect(calls.some(c => c.startsWith("getLawText:287375:") && c.endsWith(":001500"))).toBe(false)
  })
})
