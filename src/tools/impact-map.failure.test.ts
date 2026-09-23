/**
 * impact_map 조회 실패 ≠ 0건 (2026-09-23 리뷰 B#5)
 *
 * 하위 검색이 5xx 로 실패해도 버킷이 "0건"으로 찍히고 합계 "0건"이 사실처럼 나갔다.
 * 실패는 LawApiClient 아래(HTTP 상태)에서 생기므로 fetch 를 흉내 낸다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { impactMap } from "./impact-map.js"
import { parseBucket, bucketLine } from "../lib/impact-buckets.js"
import { parseArticleAnchor } from "../lib/article-anchor.js"
import { LawApiClient } from "../lib/api-client.js"
import { lawCache } from "../lib/cache.js"

const CIVIL_LAW_XML = `<?xml version="1.0" encoding="UTF-8"?><LawSearch><totalCnt>1</totalCnt>` +
  `<law id="1"><법령일련번호>284415</법령일련번호><법령명한글><![CDATA[민법]]></법령명한글>` +
  `<법령ID>001706</법령ID><법령구분명>법률</법령구분명></law></LawSearch>`

const ARTICLE_JSON = JSON.stringify({
  법령: {
    기본정보: { 법령명_한글: "민법" },
    조문: { 조문단위: [{ 조문여부: "조문", 조문번호: "103", 조문제목: "반사회질서의 법률행위", 조문내용: "제103조(반사회질서의 법률행위) 선량한 풍속…" }] },
  },
})

/** 법령 검색·조문 조회는 정상, 역방향 5개 검색은 searches 로 결정 */
function installFetch(searches: "fail" | "empty", article: "ok" | "fail" = "ok") {
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = new URL(String(input))
    const target = url.searchParams.get("target")
    if (url.pathname.endsWith("lawSearch.do") && target === "law") return new Response(CIVIL_LAW_XML)
    if (url.pathname.endsWith("lawService.do")) {
      return article === "ok" ? new Response(ARTICLE_JSON) : new Response("Internal Server Error", { status: 500 })
    }
    if (searches === "fail") return new Response("Internal Server Error", { status: 500 })
    return new Response(`<?xml version="1.0" encoding="UTF-8"?><Empty><totalCnt>0</totalCnt><page>1</page></Empty>`)
  })
}

const run = (includeMermaid = false) =>
  impactMap(new LawApiClient({ apiKey: "test" }), { lawName: "민법", jo: "제103조", includeOrdinances: true, includeMermaid })

describe("impactMap: 조회 실패를 0건으로 둔갑시키지 않는다 (B#5)", () => {
  beforeEach(() => lawCache.clear())
  afterEach(() => vi.unstubAllGlobals())

  it("역방향 검색이 전부 5xx 면 축마다 조회 실패로 적고 합계를 부분 결과로 밝힌다", async () => {
    installFetch("fail")
    const r = await run(true)
    const text = r.content[0].text
    expect(text).toContain("📚 대법원 판례: 조회 실패")
    expect(text).not.toContain("📚 대법원 판례: 0건")
    expect(text).toMatch(/총 영향 건수\(경계 확인분\): 0건 \[부분 결과: 대법원 판례·헌재 결정례·법령해석례·행정심판례·자치법규/)
    expect(text).toContain("❓ 대법원 판례 조회 실패")   // mermaid 에서도 가지가 조용히 사라지지 않는다
    expect(r.isError).toBeFalsy()                         // 부분 결과는 유효한 답이다 (#131 계약)
  })

  it("진짜 0건(NOT_FOUND)은 종전대로 0건이고 부분 결과 표시가 없다", async () => {
    installFetch("empty")
    const text = (await run()).content[0].text
    expect(text).toContain("📚 대법원 판례: 0건")
    expect(text).not.toContain("부분 결과")
  })

  it("대상 조문 조회 장애는 '법령명·조문번호 확인'으로 오진하지 않는다", async () => {
    installFetch("empty", "fail")
    const text = (await run()).content[0].text
    expect(text).toContain("▶ 대상 조문 본문 [FAILED]")
    expect(text).toContain("인용 법령: 확인 불가")
    expect(text).not.toContain("법령명·조문번호 확인 필요")
  })
})

describe("parseBucket: 실패와 0건 구분 (B#5)", () => {
  const anchor = parseArticleAnchor("제103조")!
  it("[NOT_FOUND] 없는 isError 는 조회 실패", () => {
    const stat = parseBucket({ text: "[EXTERNAL_API_ERROR] 법제처 서버 오류 (500)", isError: true }, anchor, 5)
    expect(stat.failed).toBe(true)
    expect(bucketLine(stat)).toMatch(/^조회 실패/)
  })
  it("[NOT_FOUND] 는 0건", () => {
    const stat = parseBucket({ text: "[NOT_FOUND] '민법 제103조' 검색 결과가 없습니다.", isError: true }, anchor, 5)
    expect(stat.failed).toBeFalsy()
    expect(bucketLine(stat)).toBe("0건")
  })
})
