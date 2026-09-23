import { describe, it, expect } from "vitest"
import { searchInterpretations, getInterpretationText, searchInterpretationsSchema } from "./interpretations.js"
import type { LawApiClient } from "../lib/api-client.js"

// 2026-09-23 리뷰 D4·D11 실측 응답(OC만 치환, 긴 본문은 앞부분만).

/** expc 검색 query=자동차 explYd=20240101~20241231 → 서버 총 10건 (여기엔 2건만 실음) */
const SEARCH_2024_XML =
  `<?xml version="1.0" encoding="UTF-8"?><Expc><target>expc</target><키워드>자동차</키워드><section>itmNm</section>` +
  `<totalCnt>10</totalCnt><page>1</page><numOfRows>5</numOfRows><resultCode>00</resultCode><resultMsg>success</resultMsg>` +
  `<expc id="1"><법령해석례일련번호>338575</법령해석례일련번호><안건명><![CDATA[경기도 김포시, 민원인 - 「여객자동차 운수사업법 시행규칙」 별표 3 제1호가목에 따른 전세버스운송사업의 등록기준 대수는 주사무소와 영업소에 상주하는 모든 전세버스 대수를 의미하는 것인지 여부(「여객자동차 운수사업법」 제5조 등 관련)]]></안건명>` +
  `<안건번호>23-0984</안건번호><질의기관명>경기도 김포시</질의기관명><질의기관코드>6410000</질의기관코드><회신기관명>법제처</회신기관명>` +
  `<회신기관코드>1170000</회신기관코드><회신일자>2024.04.24</회신일자><법령해석례상세링크>/DRF/lawService.do?OC=test&amp;target=expc&amp;ID=338575&amp;type=HTML&amp;mobileYn=</법령해석례상세링크></expc>` +
  `<expc id="3"><법령해석례일련번호>340455</법령해석례일련번호><안건명><![CDATA[국토교통부 - 「자동차관리법 시행령」 제14조의4제1항 단서를 근거로 자동차매매업자 소유 자동차의 같은 영 제14조의3에 해당하지 않는 정보를 자동차매매업자의 동의를 받지 않고 제공할 수 있는지 여부(「자동차관리법 시행령」 제14조의4제1항 등 관련)]]></안건명>` +
  `<안건번호>24-0731</안건번호><질의기관명>국토교통부</질의기관명><질의기관코드>1613000</질의기관코드><회신기관명>법제처</회신기관명>` +
  `<회신기관코드>1170000</회신기관코드><회신일자>2024.12.16</회신일자><법령해석례상세링크>/DRF/lawService.do?OC=test&amp;target=expc&amp;ID=340455&amp;type=HTML&amp;mobileYn=</법령해석례상세링크></expc></Expc>`

/** expc 본문 ID=338575: ExpcService 키 원문. 관계법령 키는 없고 이유가 따로 있다 */
const DETAIL_JSON = JSON.stringify({
  ExpcService: {
    해석기관코드: "1170000", 안건번호: "23-0984",
    이유: "여객자동차법령에서는 여객자동차운송사업의 “주사무소”와 “영업소”의 의미를 별도로 규정하고 있지는 않으나,",
    해석기관명: "법제처", 관리기관코드: "", 해석일자: "20240424",
    안건명: "경기도 김포시, 민원인 - 「여객자동차 운수사업법 시행규칙」 별표 3 제1호가목에 따른 전세버스운송사업의 등록기준 대수",
    질의요지: "「여객자동차 운수사업법」(이하 “여객자동차법”이라 함) 제4조제1항 및 같은 법 시행령 제4조제2항에 따르면,",
    법령해석례일련번호: "338575", 질의기관명: "경기도 김포시", 질의기관코드: "4090000", 등록일시: "20240426",
    회답: "여객자동차법 시행규칙 별표 3 제1호가목에 따른 전세버스운송사업의 지역별 자동차 등록기준 대수는",
  },
})

function recordingClient(body: string) {
  const calls: Array<Record<string, string>> = []
  const client = {
    fetchApi: async (p: { extraParams: Record<string, string> }) => { calls.push(p.extraParams); return body },
  } as unknown as LawApiClient
  return { client, calls }
}

describe("searchInterpretations: 기간은 서버에 explYd로 (D4)", () => {
  it("fromDate·toDate를 explYd로 보내고 서버 총건수를 그대로 쓴다 (종전: 1페이지 로컬 필터로 '총 4건')", async () => {
    const { client, calls } = recordingClient(SEARCH_2024_XML)
    const r = await searchInterpretations(client, { query: "자동차", display: 20, page: 1, fromDate: "20240101", toDate: "20241231" })
    expect(calls[0].explYd).toBe("20240101~20241231")
    expect(r.isError).toBeFalsy()
    expect(r.content[0].text).toContain("총 10건")
    expect(r.content[0].text).toContain("[기간: 20240101 ~ 20241231]")
  })

  it("한쪽만 주면 반대쪽을 열린 경계로 채운다", async () => {
    const { client, calls } = recordingClient(SEARCH_2024_XML)
    await searchInterpretations(client, { query: "자동차", display: 20, page: 1, fromDate: "20240101" })
    expect(calls[0].explYd).toBe("20240101~20991231")
  })

  it("기간이 없으면 explYd를 붙이지 않는다", async () => {
    const { client, calls } = recordingClient(SEARCH_2024_XML)
    await searchInterpretations(client, { query: "자동차", display: 20, page: 1 })
    expect(calls[0]).not.toHaveProperty("explYd")
  })

  it("스키마는 YYYYMMDD만 받는다", () => {
    expect(searchInterpretationsSchema.safeParse({ query: "자동차", fromDate: "2024-01-01" }).success).toBe(false)
  })

  it("스키마를 거치지 않는 search_decisions 경로에서도 잘못된 날짜를 걸러 낸다 (오류에 필드명)", async () => {
    const { client, calls } = recordingClient(SEARCH_2024_XML)
    const r = await searchInterpretations(client, { query: "자동차", display: 20, page: 1, fromDate: "2024-13-45" } as never)
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain("[INVALID_PARAMETER]")
    expect(r.content[0].text).toContain("fromDate")
    expect(calls).toHaveLength(0)
  })

  // 독립 리뷰: options 로 숫자(20240101)나 구분자 표기를 보내는 클라이언트가 있다 (CLAUDE.md 규칙 9)
  it("search_decisions 경로의 숫자·구분자 날짜도 받는다", async () => {
    const { client, calls } = recordingClient(SEARCH_2024_XML)
    await searchInterpretations(client, { query: "자동차", display: 20, page: 1, fromDate: 20240101, toDate: "2024.12.31" } as never)
    expect(calls[0].explYd).toBe("20240101~20241231")
  })

  it("거꾸로 된 기간은 업스트림에 보내지 않고 파라미터 오류로 답한다", async () => {
    const { client, calls } = recordingClient(SEARCH_2024_XML)
    const r = await searchInterpretations(client, { query: "자동차", display: 20, page: 1, fromDate: "20250101", toDate: "20240101" })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain("[INVALID_PARAMETER]")
    expect(calls).toHaveLength(0)
  })
})

describe("getInterpretationText: 라벨 (D11)", () => {
  it("해석례번호는 안건번호, 이유는 '이유'로 싣는다 (종전: 일련번호·'관계법령')", async () => {
    const { client } = recordingClient(DETAIL_JSON)
    const r = await getInterpretationText(client, { id: "338575" })
    const t = r.content[0].text
    expect(t).toContain("해석례번호: 23-0984")
    expect(t).toContain("일련번호: 338575")
    expect(t).toContain("이유:\n여객자동차법령에서는")
    expect(t).not.toContain("관계법령")
  })
})
