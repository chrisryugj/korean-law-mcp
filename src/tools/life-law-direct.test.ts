import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { callEasylaw } from "../lib/easylaw-client.js"
import { renderAllKeyword } from "../lib/easylaw-render.js"
import { searchLifeLaw } from "./life-law-guide.js"
import { getLifeLaw, paragraphXmlToText, htmlToText } from "./life-law-detail.js"

const client = {} as never
const ok = (body: unknown) => new Response(JSON.stringify({ response: { header: { resultCode: "00", resultMsg: "정상입니다." }, body } }))

/** 키워드 통합검색 실응답(2026-11-28, 「임금명세서」) 꼴 발췌 */
const ALL = {
  totalCount: 8,
  items: { item: [{
    SearchLifeAreaListCount: "1",
    SearchLifeAreaListItems: { SearchLifeAreaListItem: { csmSeq: "1694", csmTtl: "<b>임금</b>", titleLink: "https://www.easylaw.go.kr/…csmfldSeq=1694", tree: "근로/노동>" } },
    MaskMAnswerSearchContentListCount: "1",
    MaskMAnswerSearchContentListItems: { MaskMAnswerSearchContentListItem: [{
      onhunqnaAstSeq: "82", onhunqueSeq: "5954", onhunqueSubjNm: "임금명세서 교부의무", onhunqueCts: "<b>임금명세서</b>에는 어떤 내용을 적어야 하나요?",
      onhunansCts: "사용자는 … <b>임금명세서</b>를 교부해야 합니다.<br />", webTitleLink: "https://www.easylaw.go.kr/…onhunqueSeq=5954",
    }] },
    SearchCardNewsListCount: "0", SearchCardNewsListItems: { SearchCardNewsListItem: [] },
    SearchAskNoticeListCount: "", SearchAskNoticeListItems: "",
  }] },
}

beforeEach(() => { process.env.EASYLAW_SERVICE_KEY = "test-key"; process.env.EASYLAW_REFERER = "https://example.org/" })
afterEach(() => { vi.unstubAllGlobals(); delete process.env.EASYLAW_SERVICE_KEY; delete process.env.EASYLAW_REFERER })

describe("생활법령 Open API 클라이언트", () => {
  it("서비스키는 SERVICE-KEY 헤더, 등록 도메인은 Referer·Origin 으로 보낸다(주소에는 싣지 않는다)", async () => {
    let seen: { url: string; headers: Headers } | undefined
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { seen = { url: String(url), headers: new Headers(init.headers) }; return ok({ totalCount: 0, items: { item: [] } }) })
    await callEasylaw("lifelawsearch/getSearchAllKeywordList.do", { txtQuery: "임금", pageNo: 1, numOfRows: 3, empty: "" })
    expect(seen!.url).toBe("https://open.easylaw.go.kr/api/lifelawsearch/getSearchAllKeywordList.do?type=json&txtQuery=%EC%9E%84%EA%B8%88&pageNo=1&numOfRows=3")
    expect(seen!.headers.get("SERVICE-KEY")).toBe("test-key")
    expect(seen!.headers.get("referer")).toBe("https://example.org/")
    expect(seen!.headers.get("origin")).toBe("https://example.org")
  })

  it("결과 코드가 00 이 아니면 오류(키 값은 싣지 않음)", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ response: { header: { resultCode: "30", resultMsg: "등록되지 않은 도메인입니다." }, body: null } })))
    await expect(callEasylaw("x.do", {})).rejects.toThrow("생활법령 Open API 오류 30: 등록되지 않은 도메인입니다.")
  })
})

describe("통합검색 렌더러", () => {
  it("분류별 제목·질문·발췌·원문과 본문 전문 식별값을 싣고, 빈 분류는 뺀다", () => {
    const t = renderAllKeyword(ALL, 3)!
    expect(t).toContain("## 생활분야 (1건 중 1건)\n1. 임금 [근로/노동]")
    expect(t).toContain("## 백문백답 (1건 중 1건)")
    expect(t).toContain("질문·쟁점: 임금명세서에는 어떤 내용을 적어야 하나요?")
    expect(t).toContain('본문 전문: kind="qa", onhunqnaAstSeq=82, onhunqueSeq=5954')
    expect(t).not.toContain("카드뉴스")
    expect(renderAllKeyword({ items: { item: [{}] } }, 3)).toBeUndefined()
  })
})

describe("search_life_law 직접 경로", () => {
  it("서비스키가 있으면 통합검색을 직접 부르고, 비면 공개 MCP 검색어로 다시 직접 받는다", async () => {
    const calls: string[] = []
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url))
      if (String(url).startsWith("https://open.easylaw.go.kr/mcp")) {
        return new Response(`data: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { structuredContent: { query_used: "임금명세서*", sections: [] }, content: [] } })}\n\n`)
      }
      return String(url).includes("%EC%9E%84%EA%B8%88%EB%AA%85%EC%84%B8%EC%84%9C&") ? ok(ALL) : ok({ totalCount: 0, items: { item: [{}] } })
    })
    const r = await searchLifeLaw(client, { question: "임금명세서를 안 주면 어떻게 되나요?", maxItems: 2 })
    expect(r.isError).toBeUndefined()
    expect(r.content[0].text).toContain("검색어: 임금명세서 (질문 전체로는 결과가 없어 줄여 찾음)")
    expect(calls.filter(u => u.includes("getSearchAllKeywordList")).length).toBe(2)
  })

  it("region 은 생활조례 해설에서 지자체로 거르고, 검색어가 0건이면 낱말 하나씩 다시 찾는다", async () => {
    const bylaw = { totalCount: 2, items: { item: [
      { rgnbyCsmodnSeq: "300", itrfldTtl: "경기도 연천군", rgnbyCsmodnTtl: "출산장려금 (경기도 연천군)", itrrlNm: "출산장려금 지원받기", itrrlExpstCn: "<p>첫째아: 100만원</p>", itrfldNo: "1", itritmNo: "1", itrrlNo: "1" },
      { rgnbyCsmodnSeq: "301", itrfldTtl: "강원특별자치도 화천군", rgnbyCsmodnTtl: "출산장려금 (화천군)", itrrlNm: "x", itrfldNo: "1", itritmNo: "1", itrrlNo: "1" },
    ] } }
    vi.stubGlobal("fetch", async (url: string) => (String(url).includes("txtQuery=%EC%B6%9C%EC%82%B0&") ? ok(bylaw) : ok({ totalCount: 0, items: { item: [] } })))
    const t = (await searchLifeLaw(client, { question: "출산 지원금", region: "연천군", maxItems: 3 })).content[0].text
    expect(t).toContain("검색어: 출산")
    expect(t).toContain("## 생활조례: 연천군 (1건, 전국 2건 중)")
    expect(t).toContain('본문 전문: kind="bylaw", rgnbyCsmodnSeq=300')
    expect(t).not.toContain("화천군")
  })

  it("서비스키가 없으면 region·lang 은 안내 오류", async () => {
    delete process.env.EASYLAW_SERVICE_KEY
    const r = await searchLifeLaw(client, { question: "출산", region: "연천군", maxItems: 3 })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain("EASYLAW_SERVICE_KEY")
  })
})

describe("get_life_law", () => {
  it("외국어 본문 XML 은 문단(textstr)만, 해설 HTML 은 문단 줄바꿈을 살린다", () => {
    expect(paragraphXmlToText("<ov><paragraph><uid>1</uid><textstr><![CDATA[First  line]]></textstr></paragraph><paragraph><textstr>\n<![CDATA[Second]]>\n</textstr></paragraph></ov>")).toBe("First line\nSecond")
    expect(htmlToText("<p>□ 가</p><p></p><p>○ <b>나</b></p>")).toBe("□ 가\n○ 나")
  })

  it("qa 는 답 전문·관련 법령·관련 해설 식별값을 낸다", async () => {
    vi.stubGlobal("fetch", async () => ok({ totalCount: 1, items: { item: [{
      onhunqnaAstSeq: "82", onhunqueSeq: "5954", onhunqueCts: "임금명세서에는 어떤 내용을 적어야 하나요?", onhunqnaAstNm: "근로/노동", onhunqueCatNm: "임금",
      onhunansCts: "<p>사용자는 임금명세서를 교부해야 합니다.</p>",
      MaskMAnswerAreaLawListItem: [{ onhunqueConLsiNm: "근로기준법 제48조제2항" }],
      MaskMAnswerAreaInfoListItem: [{ csmTtl: "임금", ccfTtl: "임금의 지급", csmSeq: "1694", ccfNo: "2", cciNo: "3", cnpClsNo: "1" }],
    }] } }))
    const t = (await getLifeLaw(client, { kind: "qa", onhunqnaAstSeq: "82", onhunqueSeq: "5954" })).content[0].text
    expect(t).toContain("백문백답: 임금명세서에는 어떤 내용을 적어야 하나요?")
    expect(t).toContain("사용자는 임금명세서를 교부해야 합니다.")
    expect(t).toContain("관련 법령: 근로기준법 제48조제2항")
    expect(t).toContain('kind="guide", csmSeq=1694, ccfNo=2, cciNo=3, cnpClsNo=1')
  })

  it("서비스키가 없으면 안내 오류", async () => {
    delete process.env.EASYLAW_SERVICE_KEY
    const r = await getLifeLaw(client, { kind: "qa", onhunqnaAstSeq: "1", onhunqueSeq: "2" })
    expect(r.isError).toBe(true)
  })
})
