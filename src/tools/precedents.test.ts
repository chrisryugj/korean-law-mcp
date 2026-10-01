/**
 * precedents 렌더·HTML 정규화 회귀 (2026-09-23 리뷰 C5·C7)
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import { getPrecedentText, normalizeHtmlText, renderPrecedentSearchResult, precedentCache } from "./precedents.js"
import { searchPrecedentsStructured } from "./precedent-search-core.js"
import { LawApiClient } from "../lib/api-client.js"

// 국세법령정보 HWP 편집기 HTML은 &nbsp; 를 줄지어 쓴다. `[ \t]+\n` 이 그 덩어리에서 제곱이었다
// (&nbsp; 3만 개 842ms, 10만 개 13.8초).
describe("normalizeHtmlText: 공백 덩어리 (리뷰 C7)", () => {
  it("&nbsp; 10만 개에서도 선형이다", () => {
    const t0 = performance.now()
    expect(normalizeHtmlText("<p>가" + "&nbsp;".repeat(100_000) + "나</p>")).toBe("가 나")
    expect(performance.now() - t0).toBeLessThan(200)
  })

  // 리뷰 전 구현으로 뽑은 기준값 (2026-09-23)
  it("정상 HTML 결과는 종전과 같다", () => {
    expect(normalizeHtmlText("<p>제1조(목적)&nbsp;&nbsp;이 법은</p><p>  &nbsp; 둘째 줄 </p>")).toBe("제1조(목적) 이 법은\n\n둘째 줄")
    expect(normalizeHtmlText("<table><tr><td>구분</td><td>금액</td></tr><tr><td> 가 </td><td>1,000원</td></tr></table>")).toBe("구분\t금액\n\n가 1,000원")
    expect(normalizeHtmlText("<div>첫째<br/>둘째<br>셋째\r\n\r\n\r\n\r\n넷째\t\t끝</div>")).toBe("첫째\n둘째\n셋째\n\n넷째 끝")
    expect(normalizeHtmlText("  \t 앞뒤 공백 \t  ")).toBe("앞뒤 공백")
  })
})

// 업스트림 상세링크는 요청 키(OC=)를 박은 채 &amp; 로 인코딩돼 온다(실측). 그대로 찍으면
// 서버 폴백 키가 익명 호출자에게 노출되고 링크로도 못 쓴다. 후속 조회는 id 로 한다.
describe("판례 검색 렌더: 원시 상세링크를 싣지 않는다 (리뷰 C5)", () => {
  it("OC 키·&amp; 가 박힌 링크 줄이 사라지고 id 는 남는다", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><PrecSearch><totalCnt>1</totalCnt><page>1</page>` +
      `<prec id="1"><판례일련번호>623009</판례일련번호><사건명><![CDATA[손해배상(기)]]></사건명>` +
      `<사건번호>2013다61381</사건번호><선고일자>2014.01.01</선고일자><법원명>대법원</법원명><판결유형>판결</판결유형>` +
      `<판례상세링크>/DRF/lawService.do?OC=SECRETKEY&amp;target=prec&amp;ID=623009&amp;type=HTML</판례상세링크></prec></PrecSearch>`
    const api = { fetchApi: async () => xml } as unknown as LawApiClient
    const result = await searchPrecedentsStructured(api, { query: "손해배상", display: 20, page: 1 })
    const text = renderPrecedentSearchResult(result)
    expect(text).toContain("[623009] 손해배상(기)")
    expect(text).toContain('get_decision_text(domain="precedent", id="623009")')
    expect(text).not.toContain("SECRETKEY")
    expect(text).not.toContain("&amp;")
    expect(text).not.toContain("링크:")
  })
})

// 법제처 판례 JSON 필드는 줄바꿈을 <br/> 로 싣는다(실측 ID 616245: 판시사항·판결요지·전문에 77개).
// 그대로 내보내면 토큰만 먹고, 전문이 한 줄이라 축약이 줄 경계("다.\n")를 못 쓴다.
describe("판례 본문 렌더: <br/> 를 줄바꿈으로 편다", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("판시사항·판결요지·전문에 <br/> 가 남지 않는다", async () => {
    const body = JSON.stringify({ PrecService: {
      사건명: "부당해고구제재심판정취소", 사건번호: "2023두54914", 법원명: "대법원", 선고일자: "20260129",
      판시사항: "<br/> [1] 근로자 판단 기준<br/><br/> [2] 영업양도 승계",
      판결요지: "[1] 종속적 관계 여부로 판단한다.<br/>[2] 원칙적으로 승계된다.",
      판례내용: "【주    문】<br/>  원심판결을 파기한다. <br/><br/>【이    유】  상고이유를 판단한다.",
    } })
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } })))

    const text = (await getPrecedentText(new LawApiClient({ apiKey: "test" }), { id: "616245" })).content[0].text

    expect(text).not.toMatch(/<br\s*\/?>/i)
    expect(text).toContain("판시사항:\n[1] 근로자 판단 기준\n\n[2] 영업양도 승계")
    expect(text).toContain("[1] 종속적 관계 여부로 판단한다.\n[2] 원칙적으로 승계된다.")
    expect(text).toContain("원심판결을 파기한다.\n\n【이 유】 상고이유를 판단한다.")
  })
})

// 같은 판례를 한 체인 안에서 전문(본문검색 검증)과 축약(근거)으로 받으면 업스트림을 두 번 쳤다(2026-10-01 감사 dispute_prep 실측).
// 렌더만 다르고 원문은 같다 — 판례 원문은 바뀌지 않으므로 원문 JSON 을 캐시한다
describe("판례 원문 캐시", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("같은 판례를 full·축약으로 두 번 받아도 업스트림은 한 번", async () => {
    precedentCache.clear()
    const body = JSON.stringify({ PrecService: { 사건명: "손해배상", 사건번호: "2020다1", 법원명: "대법원", 판례내용: "본문" } })
    const fetchMock = vi.fn(async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } }))
    vi.stubGlobal("fetch", fetchMock)
    const api = new LawApiClient({ apiKey: "test" })
    const a = await getPrecedentText(api, { id: "325170", full: true })
    const b = await getPrecedentText(api, { id: "325170" })
    expect(a.isError).toBeFalsy()
    expect(b.isError).toBeFalsy()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
