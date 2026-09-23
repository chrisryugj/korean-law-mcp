import { afterEach, describe, expect, it, vi } from "vitest"
import { LawApiClient } from "./api-client.js"

/**
 * 재시도 백오프가 도는 경로: 기대를 먼저 걸고 가짜 시계를 돌린다. 실시간으로 기다리면
 * 이 파일 하나가 7초를 썼다(2026-09-23 리뷰 D14).
 */
async function settle<T>(run: () => Promise<T>, assert: (p: Promise<T>) => Promise<unknown>) {
  vi.useFakeTimers()
  try {
    const promise = run()
    const expectation = assert(promise)
    await vi.advanceTimersByTimeAsync(10_000)
    await expectation
  } finally {
    vi.useRealTimers()
  }
}

const PAGE_UPPER = `<!DOCTYPE html><html><body>점검 중</body></html>`

// HTML 판정이 세 벌로 갈려 있었다(#141). 재시도 계층은 앵커+대소문자 무시,
// api-client 는 비앵커+대소문자 구분이라 같은 본문에 두 계층이 다른 답을 냈다.
describe("checkHtmlError — 술어 단일화 (#141)", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("정상 XML 안에 <html 조각이 섞였다고 '점검 페이지'로 몰지 않는다", async () => {
    // 법령 본문은 CDATA 안에 서식 조각을 실어 나를 수 있다. 비앵커 includes 는
    // 이것을 HTML 에러 페이지로 오인해 정상 검색 결과를 통째로 버렸다.
    const xml = `<?xml version="1.0" encoding="UTF-8"?><LawSearch><totalCnt>1</totalCnt>` +
      `<law id="1"><법령명한글><![CDATA[별지 서식 <html>표</html> 관련 법률]]></법령명한글></law></LawSearch>`
    vi.stubGlobal("fetch", vi.fn(async () => new Response(xml, { status: 200 })))

    await expect(new LawApiClient({ apiKey: "test" }).searchLaw("민법")).resolves.toContain("totalCnt")
  })

  it("소문자 doctype 으로 시작하는 안내 페이지는 잡는다", async () => {
    const page = `<!doctype html><html><body>국가법령정보 공동활용 미신청</body></html>`
    vi.stubGlobal("fetch", vi.fn(async () => new Response(page, { status: 200 })))

    await settle(() => new LawApiClient({ apiKey: "test" }).searchLaw("민법"), p => expect(p).rejects.toThrow())
  })

  it("대문자 DOCTYPE 도 그대로 잡는다 (회귀)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(PAGE_UPPER, { status: 200 })))

    await settle(() => new LawApiClient({ apiKey: "test" }).searchLaw("민법"), p => expect(p).rejects.toThrow())
  })

  // #150-1: getAnnexes만 이 가드가 빠져 있었다. HTML이 그대로 반환되면
  // parseAnnexEnvelope의 JSON.parse catch가 무음으로 빈 목록을 만들고,
  // 사다리 전멸 끝에 "법제처 DB에 없습니다"라는 부존재 단정으로 둔갑한다.
  it("getAnnexes: HTML 안내 페이지를 무음 빈 목록이 아니라 오류로 표면화한다", async () => {
    let n = 0
    vi.stubGlobal("fetch", vi.fn(async () => { n++; return new Response(PAGE_UPPER, { status: 200 }) }))

    await settle(
      () => new LawApiClient({ apiKey: "test" }).getAnnexes({ lawName: "도로교통법" }),
      p => expect(p).rejects.toThrow(/HTML/),
    )
    expect(n).toBe(4)   // 검색 계열 재시도 사다리는 그대로 (소진 후 표면화)
  })
})

// 2026-09-23 리뷰 D7: HTML 가드가 searchLaw·getAnnexes 에만 있어 나머지 메서드는 점검·안내
// 페이지를 그대로 넘겼고, XML 파서 소비자는 "검색 결과 없음" 이나 알 수 없는 태그 오류를 냈다.
// 가드를 본문 읽기 단일 통로(readBody)로 옮겼다. 해가 되던 LAW_RESPONSE_TYPE=JSON 안내도 뺐다.
describe("readBody HTML 가드: 모든 메서드", () => {
  afterEach(() => vi.unstubAllGlobals())

  const cases: Array<[string, (c: LawApiClient) => Promise<string>]> = [
    ["searchAdminRule", c => c.searchAdminRule({ query: "외국환거래규정" })],
    ["searchOrdinance", c => c.searchOrdinance({ query: "주차" })],
    ["getArticleHistory", c => c.getArticleHistory({ lawId: "001706", jo: "000100" })],
    ["getLawHistory", c => c.getLawHistory({ regDt: "20260901" })],
    ["compareOldNew", c => c.compareOldNew({ mst: "1" })],
    ["getThreeTier", c => c.getThreeTier({ mst: "1" })],
  ]

  it.each(cases)("%s: HTML 페이지를 결과로 넘기지 않고 던진다 (우회 안내 없이)", async (_name, call) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(PAGE_UPPER, { status: 200 })))
    await settle(
      () => call(new LawApiClient({ apiKey: "test" })),
      // thdCmp 는 단건 조회라 재시도 계층이 먼저 "자료를 반환하지 않았다"로 확정한다(설계 동작)
      p => expect(p).rejects.toThrow(/^(?=.*(HTML 에러 페이지|반환하지 않았습니다))(?!.*LAW_RESPONSE_TYPE).*$/s),
    )
  })

  it("type=HTML 요청(lsHistory 등)은 HTML 을 정상 응답으로 받는다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(PAGE_UPPER, { status: 200 })))
    const text = await new LawApiClient({ apiKey: "test" })
      .fetchApi({ endpoint: "lawSearch.do", target: "lsHistory", type: "HTML" })
    expect(text).toContain("점검 중")
  })
})
