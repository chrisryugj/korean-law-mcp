/**
 * 중앙부처 1차 해석 — 행정안전부(mois) 도메인 + ministry 도메인 (#182)
 *
 * 픽스처는 2026-11-03 법제처 OPEN API 실응답을 줄인 것이다(본문 일부 생략, 구조·태그는 원형 유지).
 */
import { describe, expect, it, vi } from "vitest"
import { searchDecisions, getDecisionText } from "./unified-decisions.js"
import { resolveMinistry } from "../lib/cgm-expc-ministries.js"
import { routeQuery } from "../lib/query-router.js"
import type { LawApiClient } from "../lib/api-client.js"

const MOIS_LIST_XML = `<?xml version="1.0" encoding="UTF-8"?><CgmExpc><target>moisCgmExpc</target><키워드>취득세</키워드><section>itmNm</section><totalCnt>1036</totalCnt><page>1</page><numOfRows>1</numOfRows><resultCode>00</resultCode><resultMsg>success</resultMsg><cgmExpc id="1"><법령해석일련번호>428154</법령해석일련번호><안건명><![CDATA[000공사 매입농지의 취득세 감면 관련 질의에 대한 회신]]></안건명><안건번호><![CDATA[지방세특례제도과-1963]]></안건번호><질의기관명></질의기관명><질의기관코드></질의기관코드><해석기관명>행정안전부</해석기관명><해석기관코드>1741000</해석기관코드><해석일자>2015.07.24</해석일자><법령해석상세링크>/DRF/lawService.do?OC=test&amp;target=moisCgmExpc&amp;ID=428154&amp;type=HTML&amp;mobileYn=</법령해석상세링크><데이터기준일시>2025.10.10</데이터기준일시></cgmExpc></CgmExpc>`

const MOIS_DETAIL = {
  CgmExpcService: {
    안건명: "000공사 매입농지의 취득세 감면 관련 질의에 대한 회신",
    질의요지: "○ 한국농어촌공사가 「한국농어촌공사 및 농지관리기금법」제24조의2제2항에 따라 취득한 농지를 농지외의 용도로 매각할 경우 면제된 취득세가 추징대상에 해당 하는지 여부",
    해석기관코드: "1741000",
    안건번호: "지방세특례제도과-1963",
    이유: "○ 「지방세특례제한법」제13조제2항제5호에서는 … 취득세를 면제하는 것으로 규정하고 있고,",
    법령해석일련번호: "428154",
    질의기관명: "",
    관련법령: "「지방세특례제한법」 제13조제2항제5호",
    해석기관명: "행정안전부",
    해석일자: "20150724",
    회답: "… 해당 농지를 전업농업인 등이 아닌 자에게 매각하는 경우에는 … 감면된 취득세 추징대상이다.",
    등록일시: "20251124",
  },
}

const MOLIT_LIST_XML = `<?xml version="1.0" encoding="UTF-8"?><CgmExpc><target>molitCgmExpc</target><키워드>건축허가</키워드><section>itmNm</section><totalCnt>92</totalCnt><page>1</page><numOfRows>1</numOfRows><resultCode>00</resultCode><resultMsg>success</resultMsg><cgmExpc id="1"><법령해석일련번호>8164</법령해석일련번호><안건명><![CDATA[개발부담금 부과개시시점은 언제인지]]></안건명><안건번호><![CDATA[토지정책과-632]]></안건번호><질의기관명></질의기관명><질의기관코드></질의기관코드><해석기관명>국토교통부</해석기관명><해석기관코드>1613000</해석기관코드><해석일자>2007.08.22</해석일자><법령해석상세링크>/DRF/lawService.do?OC=test&amp;target=molitCgmExpc&amp;ID=8164&amp;type=HTML&amp;mobileYn=</법령해석상세링크><데이터기준일시>2024.12.16</데이터기준일시></cgmExpc></CgmExpc>`

// 재정경제부는 국세청처럼 상세링크가 taxlaw 로 온다(법제처 lawService 본문 없음)
const MOEF_LIST_XML = `<?xml version="1.0" encoding="UTF-8"?><CgmExpc><target>moefCgmExpc</target><키워드>*</키워드><section>itmNm</section><totalCnt>2331</totalCnt><page>1</page><numOfRows>1</numOfRows><resultCode>00</resultCode><resultMsg>success</resultMsg><cgmExpc id="1"><법령해석일련번호>215980</법령해석일련번호><안건명><![CDATA[’01.12.31. 이전 주거지역에 편입된 농지를 ’02.1.1. 이후 취득 시, 조특법§69① 단서 적용]]></안건명><안건번호><![CDATA[재산세제과-245]]></안건번호><질의기관명></질의기관명><질의기관코드></질의기관코드><해석기관명>재정경제부</해석기관명><해석기관코드>1053000</해석기관코드><해석일자>2022.02.15</해석일자><법령해석상세링크>https://taxlaw.nts.go.kr/qt/USEQTA002P.do?ntstDcmId=010000000000515720</법령해석상세링크><데이터기준일시>2025.02.21</데이터기준일시></cgmExpc></CgmExpc>`

function apiReturning(body: string) {
  const fetchApi = vi.fn(async () => body)
  return { api: { fetchApi } as unknown as LawApiClient, fetchApi }
}

describe("mois: 행정안전부 법령해석", () => {
  it("search routes to target moisCgmExpc, forwards body search scope, and lists 안건번호", async () => {
    const { api, fetchApi } = apiReturning(MOIS_LIST_XML)
    const result = await searchDecisions(api, { domain: "mois", query: "취득세", options: { search: "2" } })
    expect(result.isError).not.toBe(true)
    expect(fetchApi.mock.calls[0]?.[0]).toMatchObject({
      endpoint: "lawSearch.do",
      target: "moisCgmExpc",
      extraParams: { query: "취득세", search: "2" },
    })
    const text = result.content[0].text
    expect(text).toContain("행정안전부 법령해석 검색 결과 (총 1036건")
    expect(text).toContain("[428154] 000공사 매입농지의 취득세 감면 관련 질의에 대한 회신")
    expect(text).toContain("안건번호: 지방세특례제도과-1963")
    expect(text).not.toContain("ntstDcmId")
  })

  it("detail renders 질의요지·회답·이유 without compaction", async () => {
    const { api, fetchApi } = apiReturning(JSON.stringify(MOIS_DETAIL))
    const result = await getDecisionText(api, { domain: "mois", id: "428154" })
    expect(fetchApi.mock.calls[0]?.[0]).toMatchObject({ endpoint: "lawService.do", target: "moisCgmExpc", extraParams: { ID: "428154" } })
    const text = result.content[0].text
    expect(text).toContain("=== 000공사 매입농지의 취득세 감면 관련 질의에 대한 회신 ===")
    expect(text).toContain("해석기관: 행정안전부")
    expect(text).toContain("회답:\n… 해당 농지를 전업농업인 등이 아닌 자에게 매각하는 경우")
    expect(text).toContain("이유:\n○ 「지방세특례제한법」")
  })
})

describe("ministry: 중앙부처 1차 해석 (options.ministry)", () => {
  it.each([
    ["molit", "molit"],
    ["MOLIT", "molit"],
    ["molitCgmExpc", "molit"],
    ["국토교통부", "molit"],
    ["국토 교통부", "molit"],
    ["기획재정부", "moef"],
    ["환경부", "me"],
    ["특허청", "kipo"],
  ])("resolveMinistry(%s) → %s", (input, code) => {
    expect(resolveMinistry(input)).toBe(code)
  })

  it("resolveMinistry rejects unknown or empty values", () => {
    expect(resolveMinistry("없는부")).toBeUndefined()
    expect(resolveMinistry("")).toBeUndefined()
    expect(resolveMinistry(undefined)).toBeUndefined()
  })

  it("search picks <code>CgmExpc from options.ministry and labels the ministry", async () => {
    const { api, fetchApi } = apiReturning(MOLIT_LIST_XML)
    const result = await searchDecisions(api, { domain: "ministry", query: "건축허가", options: { ministry: "국토교통부" } })
    expect(fetchApi.mock.calls[0]?.[0]).toMatchObject({ target: "molitCgmExpc", extraParams: { query: "건축허가" } })
    expect((fetchApi.mock.calls[0]?.[0] as { extraParams: Record<string, string> }).extraParams.ministry).toBeUndefined()
    const text = result.content[0].text
    expect(text).toContain("국토교통부 법령해석 검색 결과 (총 92건")
    expect(text).toContain("안건번호: 토지정책과-632")
  })

  it("missing or unknown ministry fails without calling the API and lists the codes", async () => {
    const { api, fetchApi } = apiReturning(MOLIT_LIST_XML)
    for (const options of [undefined, { ministry: "없는부" }]) {
      const result = await searchDecisions(api, { domain: "ministry", query: "건축허가", options })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("[INVALID_ARGUMENT]")
      expect(result.content[0].text).toContain("molit=국토교통부")
    }
    expect(fetchApi).not.toHaveBeenCalled()
  })

  it("detail routes to lawService.do with the ministry target", async () => {
    const { api, fetchApi } = apiReturning(JSON.stringify(MOIS_DETAIL))
    await getDecisionText(api, { domain: "ministry", id: "428154", options: { ministry: "행안부" } })
    expect(fetchApi.mock.calls[0]?.[0]).toMatchObject({ endpoint: "lawService.do", target: "moisCgmExpc", extraParams: { ID: "428154" } })
  })

  it("moef search exposes the taxlaw ntstDcmId; its 법제처 serial number is refused without an API call", async () => {
    const list = apiReturning(MOEF_LIST_XML)
    const text = (await searchDecisions(list.api, { domain: "ministry", options: { ministry: "moef" } })).content[0].text
    expect(text).toContain("재정경제부 법령해석 검색 결과 (총 2331건")
    expect(text).toContain("본문조회ID(ntstDcmId): 010000000000515720")

    const detail = apiReturning("{}")
    const result = await getDecisionText(detail.api, { domain: "ministry", id: "215980", options: { ministry: "moef" } })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("[NOT_SUPPORTED] 재정경제부 법령해석은")
    expect(detail.fetchApi).not.toHaveBeenCalled()
  })
})

describe("routing: 지방세 해석 → mois", () => {
  it.each([
    ["취득세 해석 감면 추징", "취득세 감면 추징"],
    ["재산세 질의 회신 분리과세", "재산세 분리과세"],
    ["지방소득세 해석 특별징수", "지방소득세 특별징수"],
    ["행안부 유권해석 생애최초", "생애최초"],
  ])("%s → search_decisions(domain=mois) — 세목명은 검색어에 남긴다", (query, keyword) => {
    const r = routeQuery(query)
    expect(r.tool).toBe("search_decisions")
    expect(r.params).toMatchObject({ domain: "mois", query: keyword })
  })

  it("국세 세목과 국세청 명시는 기존대로 nts", () => {
    expect(routeQuery("양도세 해석 1세대1주택").params).toMatchObject({ domain: "nts" })
    expect(routeQuery("소득세 질의 근로소득").params).toMatchObject({ domain: "nts" })
    expect(routeQuery("국세청 취득세 고급주택").params).toMatchObject({ domain: "nts" })
    expect(routeQuery("국세청 지방소득세 해석").params).toMatchObject({ domain: "nts" })
  })
})
