import { afterEach, describe, it, expect, vi } from "vitest"
import { advancedSearch, AdvancedSearchSchema } from "./advanced-search.js"
import { LawApiClient } from "../lib/api-client.js"

// 2026-09-23 리뷰 D3: 대상별 검색 오류를 빈 배열로 삼켜 "고급 검색 결과 (0건)"을 성공으로 내던 결함.

/** 실측 법령 검색(target=law, query=관세법) 첫 항목 원문(OC만 치환) */
const LAW_XML =
  `<?xml version="1.0" encoding="UTF-8"?><LawSearch><target>law</target><키워드>관세법</키워드><section>lawNm</section>` +
  `<totalCnt>1</totalCnt><page>1</page><numOfRows>1</numOfRows><resultCode>00</resultCode><resultMsg>success</resultMsg>` +
  `<law id="1"><법령일련번호>288689</법령일련번호><현행연혁코드>현행</현행연혁코드><법령명한글><![CDATA[관세법]]></법령명한글>` +
  `<법령약칭명><![CDATA[]]></법령약칭명><법령ID>001556</법령ID><공포일자>20260811</공포일자><공포번호>21858</공포번호>` +
  `<제개정구분명>일부개정</제개정구분명><소관부처코드>1053000</소관부처코드><소관부처명>재정경제부</소관부처명>` +
  `<법령구분명>법률</법령구분명><공동부령정보></공동부령정보><시행일자>20260811</시행일자><자법타법여부></자법타법여부>` +
  `<법령상세링크>/DRF/lawService.do?OC=test&amp;target=law&amp;MST=288689&amp;type=HTML</법령상세링크></law></LawSearch>`

/** 실측 자치법규 검색(target=ordin) 원문(OC만 치환). 항목 태그가 <ordin>이 아니라 <law>다 */
const ORDIN_XML =
  `<?xml version="1.0" encoding="UTF-8"?><OrdinSearch><target>ordin</target><키워드>서울특별시 주차장 설치</키워드><section>ordinNm</section>` +
  `<totalCnt>74</totalCnt><page>1</page><numOfRows>1</numOfRows><resultCode>00</resultCode><resultMsg>success</resultMsg>` +
  `<law id="1"><자치법규일련번호>1589887</자치법규일련번호><자치법규명><![CDATA[서울특별시 강남구 민영주차장 설치자금 융자 및 보조금 시행규칙]]></자치법규명>` +
  `<자치법규ID>2072388</자치법규ID><공포일자>20210416</공포일자><공포번호>936</공포번호><제개정구분명>일부개정</제개정구분명>` +
  `<지자체기관명>서울특별시 강남구</지자체기관명><자치법규종류>규칙</자치법규종류><시행일자>20210416</시행일자>` +
  `<자치법규상세링크>/DRF/lawService.do?OC=test&amp;target=ordin&amp;MST=1589887&amp;type=HTML&amp;mobileYn=</자치법규상세링크>` +
  `<자치법규분야명><![CDATA[제5장 맑은도시]]></자치법규분야명><참조데이터구분>0</참조데이터구분></law></OrdinSearch>`

const EMPTY_LAW_XML = `<?xml version="1.0" encoding="UTF-8"?><LawSearch><target>law</target><totalCnt>0</totalCnt></LawSearch>`
const EMPTY_ORDIN_XML = `<?xml version="1.0" encoding="UTF-8"?><OrdinSearch><target>ordin</target><totalCnt>0</totalCnt></OrdinSearch>`

const input = (over: Partial<Parameters<typeof advancedSearch>[1]> = {}) =>
  AdvancedSearchSchema.parse({ query: "관세법", ...over })

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("advancedSearch: 업스트림 실패를 0건으로 둔갑시키지 않는다 (D3)", () => {
  it("실제 재시도 경로에서 매번 503이면 오류로 답한다 (종전: '0건' 성공)", async () => {
    vi.useFakeTimers()
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })))
    const pending = advancedSearch(new LawApiClient({ apiKey: "test" }), input({ query: "주차장" }))
    await vi.advanceTimersByTimeAsync(60_000)
    const r = await pending
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain("법제처 서버 오류 (503)")
    expect(r.content[0].text).not.toContain("(0건)")
  })

  it("일부 대상만 실패하면 받은 결과를 싣고 실패 대상을 밝힌다", async () => {
    const client = {
      searchLaw: async () => LAW_XML,
      searchAdminRule: async () => { throw new Error("법제처 서버 오류 (503) - searchAdminRule") },
      searchOrdinance: async () => EMPTY_ORDIN_XML,
    } as unknown as LawApiClient
    const r = await advancedSearch(client, input({ searchType: "all" }))
    const t = r.content[0].text
    expect(r.isError).toBeFalsy()
    expect(t).toContain("1. 관세법")
    expect(t).toContain("행정규칙: 법제처 서버 오류 (503)")
    expect(t).toContain("해당 자료가 없다는 뜻이 아닙니다")
  })

  it("전 대상이 실패하면 대상별 원인을 모아 오류로 답한다", async () => {
    const fail = (name: string) => async () => { throw new Error(`법제처 서버 오류 (503) - ${name}`) }
    const client = {
      searchLaw: fail("searchLaw"), searchAdminRule: fail("searchAdminRule"), searchOrdinance: fail("searchOrdinance"),
    } as unknown as LawApiClient
    const r = await advancedSearch(client, input({ searchType: "all" }))
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain("자치법규 검색 실패")
  })
})

describe("advancedSearch: 자치법규 항목 태그 (D3)", () => {
  it("<OrdinSearch> 아래 <law> 항목을 읽는다 (종전: <ordin>을 찾아 매번 0건)", async () => {
    const client = { searchOrdinance: async () => ORDIN_XML } as unknown as LawApiClient
    const r = await advancedSearch(client, input({ query: "주차장", searchType: "ordinance" }))
    const t = r.content[0].text
    expect(r.isError).toBeFalsy()
    expect(t).toContain("서울특별시 강남구 민영주차장 설치자금 융자 및 보조금 시행규칙")
    // get_ordinance 가 받는 자치법규일련번호를 싣는다. 자치법규ID(2072388)로 조회하면 "없음"이 난다(독립 리뷰)
    expect(t).toContain("ID: 1589887")
    expect(t).not.toContain("ID: 2072388")
  })
})

describe("advancedSearch: 결과 0건은 NOT_FOUND 가드를 단다 (D3)", () => {
  it("모든 대상이 정상 응답했는데 0건이면 [NOT_FOUND]", async () => {
    const client = { searchLaw: async () => EMPTY_LAW_XML } as unknown as LawApiClient
    const r = await advancedSearch(client, input())
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain("[NOT_FOUND]")
  })

  it("필터로 전부 빠진 경우 필터 전 건수를 밝힌다", async () => {
    const client = { searchLaw: async () => LAW_XML } as unknown as LawApiClient
    const r = await advancedSearch(client, input({ fromDate: "20270101" }))   // 공포일 20260811 < 20270101
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain("필터 적용 전 1건")
  })
})

describe("advancedSearch: 기간·연산자 표기 (D3)", () => {
  it("기간은 YYYYMMDD만 받는다 (형식이 다르면 문자열 비교가 조용히 틀린다)", () => {
    expect(AdvancedSearchSchema.safeParse({ query: "관세법", fromDate: "2024-01-01" }).success).toBe(false)
    expect(AdvancedSearchSchema.safeParse({ query: "관세법", fromDate: "20240101" }).success).toBe(true)
  })

  it("OR은 키워드별 조회를 하지 않는다는 사실을 밝힌다", async () => {
    const client = { searchLaw: async () => LAW_XML } as unknown as LawApiClient
    const r = await advancedSearch(client, input({ query: "관세법 관세", operator: "OR" }))
    expect(r.content[0].text).toContain("OR 연산은 키워드별로 따로 조회하지 않습니다")
  })
})
