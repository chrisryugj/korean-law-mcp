/**
 * 연혁(계보) 기능 독립 리뷰가 실측으로 찾은 결함의 회귀 (2026-09-28).
 * 되돌리면 실패해야 하는 테스트만 둔다 — 각 케이스 주석에 "종전 결과"를 적는다.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { applicableLaw } from "./applicable-law.js"
import { applicableAdminRule } from "./applicable-admin-rule.js"
import { searchHistoricalLaw } from "./historical-law.js"
import { getLawText } from "./law-text.js"
import { verifyCitations } from "./verify-citations.js"
import { fetchAdminRuleHistory } from "../lib/admin-rule-history.js"
import { lawStateAt, resolveLawId } from "../lib/law-lineage.js"
import { ExecutionLimitError } from "../lib/execution-limits.js"
import { adminRuleXmlCache } from "../lib/admin-rule-views.js"
import { lawCache } from "../lib/cache.js"
import type { LawApiClient } from "../lib/api-client.js"

const lawRow = (mst: string, efYd: string, name: string, id: string, rr: string, st = "연혁") =>
  `<law id="x"><법령일련번호>${mst}</법령일련번호><현행연혁코드>${st}</현행연혁코드><법령명한글><![CDATA[${name}]]></법령명한글>` +
  `<법령ID>${id}</법령ID><공포일자>${efYd}</공포일자><공포번호>1</공포번호><제개정구분명>${rr}</제개정구분명><시행일자>${efYd}</시행일자></law>`
const xml = (rows: string[]) => `<LawSearch><totalCnt>${rows.length}</totalCnt>${rows.join("")}</LawSearch>`

beforeEach(() => { lawCache.clear(); adminRuleXmlCache.clear() })

describe("폐지 행은 시행 중 버전이 아니다 (종전: 소방법 타법폐지 행을 '현행'으로)", () => {
  // eflaw LID=001630 실측 축약: 마지막 행이 2004.5.30. 타법폐지
  const FIRE = [lawRow("61542", "20040530", "소방법", "001630", "타법폐지"), lawRow("50000", "20030101", "소방법", "001630", "일부개정")]
  const client = {
    searchLaw: async (_q: string, _k?: string, _d?: number, target?: string) =>
      target === "eflaw" ? xml(FIRE) : xml([]),
    fetchApi: async (p: { target: string, extraParams?: Record<string, string> }) =>
      p.extraParams?.LID ? xml(FIRE) : `{"법령":{"부칙":{"부칙단위":[]}}}`,
  } as unknown as LawApiClient

  it("lawStateAt: 폐지 뒤 기준일은 version 없이 repeal", () => {
    const versions = FIRE.map((_, i) => i === 0
      ? { mst: "61542", efYd: "20040530", ancNo: "1", ancYd: "", lawNm: "소방법", rrCls: "타법폐지" }
      : { mst: "50000", efYd: "20030101", ancNo: "1", ancYd: "", lawNm: "소방법", rrCls: "일부개정" })
    expect(lawStateAt(versions, "20100101")).toEqual({ repeal: versions[0] })
    expect(lawStateAt(versions, "20030601").version?.mst).toBe("50000")
  })

  it("applicable_law: 폐지 뒤 기준일은 '이미 폐지'", async () => {
    const text = (await applicableLaw(client, { lawName: "소방법", date: "2010-01-01" })).content[0].text
    expect(text).toContain("이미 폐지됐습니다")
    expect(text).not.toContain("이 버전이 현행입니다")
  })

  it("search_historical_law: 폐지 행에 [현행] 대신 [폐지]", async () => {
    const text = (await searchHistoricalLaw(client, { lawName: "소방법", display: 100 })).content[0].text
    expect(text).toContain("타법폐지 [폐지]")
    expect(text).not.toContain("[현행]")
  })
})

describe("폐지 후 동명 재제정 법령의 구법 시절 기준일 (종전 v4.15.0: '시행 전입니다. 최초 시행일 1997.03.13')", () => {
  // 근로기준법: 1997.3.13. 구법(법률 제5305호로 폐지) → 같은 날 같은 이름 신법 제정(법령ID 001872). 감사 실측 축약
  const LSA = "근로기준법"
  const lineage = xml([lawRow("283457", "20260820", LSA, "001872", "타법개정", "현행"), lawRow("53681", "19970313", LSA, "001872", "제정")])
  const tr = (mst: string, efYd: string, rr: string, no: string) =>
    `<tr><td><a href="/DRF/lawService.do?target=lsHistory&amp;MST=${mst}&amp;efYd=${efYd}" >${LSA}</a></td><td>${rr}</td><td>제 ${no}호</td><td>${efYd.slice(0, 4)}.1.1</td></tr>`
  const history = `<html><strong>4</strong> 건<table>${tr("53681", "19970313", "제정", "05309")}${tr("4974", "19970313", "폐지", "05305")}` +
    `${tr("4972", "19900714", "타법개정", "04220")}${tr("4963", "19530809", "제정", "00286")}</table></html>`
  const article = (body: string) => JSON.stringify({ 법령: { 조문: { 조문단위: [{ 조문여부: "조문", 조문번호: "1", 조문내용: body }] } } })
  const calls: string[] = []
  const client = {
    searchLaw: async (_q: string, _k?: string, _d?: number, target?: string) =>
      target === "eflaw" ? xml([]) : xml([lawRow("283457", "20260820", LSA, "001872", "타법개정", "현행")]),
    fetchApi: async (p: { target: string, extraParams?: Record<string, string> }) => {
      calls.push(p.extraParams?.LID ? "lineage" : p.target)
      if (p.extraParams?.LID) return lineage
      if (p.target === "lsHistory") return history
      if (p.target === "eflaw") return xml([])   // 분리시행 보정 검색 (구법은 공포 단위 행이라 v4.14.2 처럼 보정한다)
      return `{"법령":{"부칙":{"부칙단위":[]}}}`
    },
    getLawText: async (p: { mst: string }) => {
      calls.push(`text:${p.mst}`)
      return article(p.mst === "4972" ? "제1조(목적) 구법 목적" : "제1조(목적) 신법 목적")
    },
  } as unknown as LawApiClient

  it("applicable_law: 계보 시작 전 기준일은 동명 구법 버전, 현행 같은 조번호 비교는 생략", async () => {
    calls.length = 0
    const text = (await applicableLaw(client, { lawName: LSA, date: "1995-05-01", jo: "제1조" })).content[0].text
    expect(text).toContain("근로기준법 [시행 1990.07.14]")
    expect(text).toContain("(MST 4972)")
    expect(text).toContain("법령ID가 다른 동명 구법")
    expect(text).toContain("구법 목적")
    expect(text).toContain("폐지 후 재제정")
    expect(text).not.toContain("시행 전입니다")
    expect(calls).not.toContain("text:283457")   // 다른 법령의 같은 조번호를 받아 "변경됨"으로 비교하지 않는다
  })

  it("applicable_law: 계보 안의 기준일은 lsHistory 를 부르지 않는다", async () => {
    calls.length = 0
    const text = (await applicableLaw(client, { lawName: LSA, date: "2000-01-01" })).content[0].text
    expect(text).toContain("(MST 53681)")
    expect(calls).not.toContain("lsHistory")
  })
})

describe("계보 조회 실패 + 옛 이름 입력은 '현행'을 단정하지 않는다", () => {
  it("이름 기반 폴백이면 경고하고 마지막 버전을 현행이라 하지 않는다", async () => {
    const OLD = "화재예방, 소방시설 설치ㆍ유지 및 안전관리에 관한 법률"
    const client = {
      searchLaw: async (_q: string, _k?: string, _d?: number, target?: string) =>
        target === "eflaw" ? xml([lawRow("1", "20220101", OLD, "009503", "타법개정")]) : xml([]),
      fetchApi: async (p: { target: string, extraParams?: Record<string, string> }) => {
        if (p.extraParams?.LID) throw new Error("일시 장애")
        if (p.target === "lsHistory") {
          return `<html><strong>1</strong> 건<table><tr><td><a href="/x?MST=1&efYd=20220101">${OLD}</a></td><td>제1호</td><td>2021.12.1</td><td>타법개정</td></tr></table></html>`
        }
        return `{"법령":{"부칙":{"부칙단위":[]}}}`
      },
    } as unknown as LawApiClient
    const text = (await applicableLaw(client, { lawName: OLD, date: "2025-01-01" })).content[0].text
    expect(text).toContain("법령ID 계보를 확인하지 못해")
    expect(text).toContain("현행 여부 미확인")
    expect(text).not.toContain("이 버전이 현행입니다")
  })
})

describe("resolveLawId: 법령명으로 시작하는 고시는 그 법령으로 풀지 않는다 (종전: 개인정보 보호법으로)", () => {
  it("입력이 법령명보다 길면 undefined — 행정규칙 갈래로 간다", async () => {
    const client = {
      searchLaw: async (_q: string, _k?: string, _d?: number, target?: string) =>
        target === "eflaw" ? xml([]) : xml([lawRow("1", "20240101", "개인정보 보호법", "011357", "일부개정", "현행")]),
    } as unknown as LawApiClient
    expect(await resolveLawId(client, "개인정보 보호법 위반에 대한 과징금 부과기준")).toBeUndefined()
  })
})

// ── 행정규칙 ────────────────────────────────────────
const admRow = (serial: string, id: string, name: string, issued: string, ef: string, no: string, rr: string, cur = "연혁") =>
  `<admrul id="1"><행정규칙일련번호>${serial}</행정규칙일련번호><행정규칙명><![CDATA[${name}]]></행정규칙명><행정규칙종류>고시</행정규칙종류>` +
  `<발령일자>${issued}</발령일자><발령번호>${no}</발령번호><소관부처명>소방청</소관부처명><현행연혁구분>${cur}</현행연혁구분>` +
  `<제개정구분명>${rr}</제개정구분명><행정규칙ID>${id}</행정규칙ID><시행일자>${ef}</시행일자></admrul>`
const NFSC = "스프링클러설비의 화재안전기준(NFSC 103)"
const detail = (serial: string, body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><AdmRulService><행정규칙기본정보><행정규칙일련번호>${serial}</행정규칙일련번호>` +
  `<행정규칙명><![CDATA[${NFSC}]]></행정규칙명><발령일자>20150123</발령일자><조문형식여부>Y</조문형식여부></행정규칙기본정보>` +
  `<조문내용><![CDATA[${body}]]></조문내용></AdmRulService>`

describe("fetchAdminRuleHistory: 행정규칙ID로 묶고 쪽을 이어 받고 중복을 걷는다", () => {
  it("2쪽에 걸친 같은 계보를 하나로, 시행일 내림차순", async () => {
    const pages: number[] = []
    const client = {
      searchAdminRule: async (p: { page?: number }) => {
        pages.push(p.page ?? 1)
        return p.page === 2
          ? `<AdmRulSearch><totalCnt>150</totalCnt>${admRow("S1", "35312", NFSC, "20150123", "20150324", "2015-23", "일부개정")}${admRow("S2", "35312", NFSC, "20160713", "20160713", "2016-87", "일부개정")}</AdmRulSearch>`
          : `<AdmRulSearch><totalCnt>150</totalCnt>${admRow("S2", "35312", NFSC, "20160713", "20160713", "2016-87", "일부개정")}${admRow("T1", "83616", "스프링클러설비의 화재안전기술기준(NFTC 103)", "20221201", "20230210", "2022-210", "제정")}</AdmRulSearch>`
      },
    } as unknown as LawApiClient
    const { groups } = await fetchAdminRuleHistory(client, "스프링클러설비의 화재안전")
    expect(pages.sort()).toEqual([1, 2])
    expect(groups.get("35312")?.map(v => v.serial)).toEqual(["S2", "S1"])
    expect(groups.get("83616")).toHaveLength(1)
  })
})

describe("applicableAdminRule: 현행 비교는 본문끼리 (종전: 이미지 안내 URL 차이로 늘 '변경됨')", () => {
  const history = `<AdmRulSearch><totalCnt>2</totalCnt>` +
    admRow("OLD1", "35312", NFSC, "20150123", "20150324", "2015-23", "일부개정") +
    admRow("NEW1", "35312", NFSC, "20160713", "20160713", "2016-87", "일부개정", "현행") + `</AdmRulSearch>`
  const body = `제10조(헤드) ① 스프링클러헤드는 천장에 설치한다.\n<img id="1"></img>\n제11조(배관) 배관은 …`
  const client = (details: Record<string, string>) => ({
    searchAdminRule: async () => history,
    getAdminRule: async (id: string) => details[id],
  }) as unknown as LawApiClient

  it("같은 조문이면 ✅ 동일", async () => {
    const r = await applicableAdminRule(client({ OLD1: detail("OLD1", body), NEW1: detail("NEW1", body) }), { lawName: NFSC, date: "20160101", jo: "제10조" })
    const text = r!.content[0].text
    expect(text).toContain("천장에 설치한다")
    expect(text).toContain("✅ 동일")
  })

  it("조문 체계 없는 본문에 제N조를 물으면 안내문을 조문으로 싣지 않는다", async () => {
    const nftc = "2.7.3 스프링클러헤드까지의 수평거리는 2.1 m 이하로 해야 한다."
    const r = await applicableAdminRule(client({ OLD1: detail("OLD1", nftc), NEW1: detail("NEW1", nftc) }), { lawName: NFSC, date: "20160101", jo: "제5조" })
    const text = r!.content[0].text
    expect(text).toContain("[NOT_FOUND] 해당 버전에서 제5조")
    expect(text).not.toContain("✅ 동일")
  })

  it("발령·시행 순서가 엇갈리면 시행 중인 것 중 나중 발령본, 그 뒤 개정 수도 기준일 다음부터 (종전: 2013-18호·3차례)", async () => {
    const staggered = `<AdmRulSearch><totalCnt>4</totalCnt>` +
      admRow("NEW1", "35312", NFSC, "20160713", "20160713", "2016-87", "일부개정", "현행") +
      admRow("OLD1", "35312", NFSC, "20150123", "20150324", "2015-23", "일부개정") +
      admRow("S18", "35312", NFSC, "20130610", "20130811", "2013-18", "일부개정") +
      admRow("S21", "35312", NFSC, "20130611", "20130712", "2013-21", "타법개정") + `</AdmRulSearch>`
    const c = { searchAdminRule: async () => staggered } as unknown as LawApiClient
    const text = (await applicableAdminRule(c, { lawName: NFSC, date: "20140101" }))!.content[0].text
    expect(text).toContain("제2013-21호, 2013.06.11 발령")
    expect(text).toContain("S21 ◀ 기준일 버전")
    expect(text).toContain("기준일 이후 현재까지 2차례")
  })

  it("본문 조회의 예산 소진은 '당시 미신설'로 삼키지 않고 올린다", async () => {
    const c = {
      searchAdminRule: async () => history,
      getAdminRule: async () => { throw new ExecutionLimitError("Request upstream work budget exceeded") },
    } as unknown as LawApiClient
    await expect(applicableAdminRule(c, { lawName: NFSC, date: "20160101", jo: "제10조" })).rejects.toThrow(ExecutionLimitError)
  })
})

describe("get_law_text 기준일 보정: 예산 소진은 '시행일 없음'으로 바뀌지 않는다", () => {
  it("계보 조회가 예산 소진이면 isError 이고 사유가 예산이다", async () => {
    const client = {
      getLawText: async () => "{}",
      fetchApi: async () => { throw new ExecutionLimitError("Request upstream work budget exceeded (max 48 attempts).") },
    } as unknown as LawApiClient
    const r = await getLawText(client, { lawId: "009694", efYd: "20150601" })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).not.toContain("시행일 버전이 없습니다")
  })
})

describe("verify_citations: 옛 법령명 인용은 제명 변경으로 (종전: 다른 법령을 '폐지'로)", () => {
  it("[RENAMED] 와 현행 명칭, 옛 이름 시절 조문 실존", async () => {
    const OLD = "소방시설 설치ㆍ유지 및 안전관리에 관한 법률"
    const NEW = "소방시설 설치 및 관리에 관한 법률"
    const client = {
      searchLaw: async (_q: string, _k?: string, _d?: number, target?: string) =>
        target === "eflaw" ? xml([lawRow("166244", "20150701", OLD, "009503", "일부개정"), lawRow("9", "20150716", `${OLD} 시행규칙`, "009730", "일부개정")]) : xml([]),
      fetchApi: async (p: { extraParams?: Record<string, string> }) => p.extraParams?.LID === "009503"
        ? xml([lawRow("236977", "20241201", NEW, "009503", "전부개정", "현행"), lawRow("166244", "20150701", OLD, "009503", "일부개정")])
        : xml([]),
      getLawText: async () => JSON.stringify({ 법령: { 조문: { 조문단위: [{ 조문여부: "조문", 조문번호: "9", 조문제목: "소방시설의 유지·관리" }] } } }),
    } as unknown as LawApiClient
    const text = (await verifyCitations(client, { text: `${OLD} 제9조에 따라`, maxCitations: 5 })).content[0].text
    expect(text).toContain("[RENAMED]")
    expect(text).toContain(`현행은 「${NEW}」`)
    expect(text).toContain("제9조(소방시설의 유지·관리) 실존")
    expect(text).not.toContain("[REPEALED]")
  })
})
