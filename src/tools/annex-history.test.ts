import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { getAnnexes } from "./annex.js"
import { lawCache } from "../lib/cache.js"
import type { LawApiClient } from "../lib/api-client.js"

// get_annexes(date) — 기준일 시행 버전의 별표. 제명이 바뀐 법령(소방시설법 시행령)의 2015년 별표5.
const NEW = "소방시설 설치 및 관리에 관한 법률 시행령"
const MID = "소방시설 설치ㆍ유지 및 안전관리에 관한 법률 시행령"
const row = (mst: string, efYd: string, name: string, ancNo: string, rr: string) =>
  `<law id="x"><법령일련번호>${mst}</법령일련번호><법령명한글><![CDATA[${name}]]></법령명한글><법령ID>009694</법령ID>` +
  `<공포일자>20150106</공포일자><공포번호>${ancNo}</공포번호><제개정구분명>${rr}</제개정구분명><시행일자>${efYd}</시행일자></law>`
const LINEAGE = `<LawSearch><totalCnt>3</totalCnt>` + [
  row("287375", "20260701", NEW, "36432", "타법개정"),
  row("166678", "20150407", MID, "26033", "일부개정"),
  row("166678", "20150108", MID, "26033", "일부개정"),
].join("") + `</LawSearch>`
const SEARCH = `<LawSearch><totalCnt>1</totalCnt><law id="1"><법령일련번호>287375</법령일련번호><법령명한글><![CDATA[${NEW}]]></법령명한글><법령ID>009694</법령ID><법령구분명>대통령령</법령구분명></law></LawSearch>`
// 분리시행: 같은 MST 라도 2015.4.7. 슬라이스의 별표5 파일이 1.8. 슬라이스와 다르다(실측 flSeq 25496262 vs 25496365)
const annexJson = (flSeq: string) => JSON.stringify({
  법령: {
    별표: {
      별표단위: [
        { 별표번호: "0004", 별표가지번호: "00", 별표구분: "별표", 별표제목: "수용인원의 산정 방법(제15조 관련)", 별표서식파일링크: "/LSW/flDownload.do?flSeq=1" },
        { 별표번호: "0005", 별표가지번호: "00", 별표구분: "별표", 별표제목: "특정소방대상물의 관계인이 … 갖추어야 하는 소방시설의 종류(제15조 관련)", 별표서식파일링크: `/LSW/flDownload.do?flSeq=${flSeq}` },
      ],
    },
  },
})

function client(seen: string[]): LawApiClient {
  return {
    searchLaw: async () => SEARCH,
    fetchApi: async (p: { target: string, extraParams?: Record<string, string> }) => {
      const ep = p.extraParams || {}
      seen.push(`${p.target}:${ep.MST || ep.LID || ""}:${ep.efYd || ""}`)
      if (p.target === "eflaw" && ep.LID) return LINEAGE
      if (p.target === "eflaw" && ep.MST === "166678") return annexJson(ep.efYd === "20150407" ? "25496262" : "25496365")
      throw new Error(`unexpected ${p.target}`)
    },
  } as unknown as LawApiClient
}

describe("get_annexes date — 기준일 시행 버전의 별표", () => {
  beforeEach(() => lawCache.clear())
  afterEach(() => vi.unstubAllGlobals())

  it("2015.6.1. → 옛 이름 시절 시행 2015.4.7. 슬라이스의 별표5 파일을 내려받는다", async () => {
    const urls: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
      urls.push(String(url))
      return new Response("[별표 5] 11층 이상인 특정소방대상물은 모든 층", { status: 200, headers: { "content-type": "text/plain" } })
    }))
    const seen: string[] = []
    const r = await getAnnexes(client(seen), { lawName: "소방시설법 시행령 별표5", date: "2015-06-01" })
    const text = r.content[0].text
    expect(text).toContain("기준일 2015.06.01 당시 시행 버전")
    expect(text).toContain(`「${MID}」 [시행 2015.04.07]`)
    expect(text).toContain(`현행 명칭 「${NEW}」`)
    expect(seen).toContain("eflaw:166678:20150407")
    expect(urls.some(u => u.includes("flSeq=25496262"))).toBe(true)
    expect(urls.some(u => u.includes("flSeq=25496365"))).toBe(false)
  })

  it("번호 없이 부르면 그 버전의 별표 목록과 다음 호출을 안내한다", async () => {
    const r = await getAnnexes(client([]), { lawName: "소방시설법 시행령", date: "20150601" })
    const text = r.content[0].text
    expect(text).toContain("[000500] 특정소방대상물의 관계인이")
    expect(text).toContain('date: "20150601"')
  })

  it("최초 시행 전 기준일은 NOT_FOUND", async () => {
    const r = await getAnnexes(client([]), { lawName: "소방시설법 시행령", date: "2001-01-01" })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain("시행 전")
  })
})
