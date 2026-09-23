import { describe, it, expect } from "vitest"
import { searchTreaties, getTreatyText } from "./treaties.js"
import type { LawApiClient } from "../lib/api-client.js"

// 2026-09-23 리뷰 D1 실측 응답. 조약기본정보·추가정보는 원문 그대로, 조약내용 본문만 앞부분으로 줄였다.

/** 다자조약 ID=4037 (ICSID): 루트가 MultTrtyService, 추가정보 빈 값은 문자열 "null" */
const MULTI_4037 = JSON.stringify({
  MultTrtyService: {
    조약내용: { 조약내용: "체약국은, 경제발전을 위한 국제적 협력의 필요와 그에 대한 국제적인 민간투자의 역할을 고려하고," },
    추가정보: {
      체결장소: "null", 체결일자: "null", 다자조약분야명: "분쟁해결/상사중재", 국내발효일자: "null",
      다자조약분야코드: "440321", 기탁처: "null", 국가코드: "다자조약", 수락서기탁일자: "null",
    },
    조약기본정보: {
      국회비준동의여부: "", 국회비준동의일자: "", 조약명_한글: "국가와 타방국가 국민간의 투자분쟁의 해결에 관한 협약",
      서명장소: "", 발효일자: "19670323", 비고: "",
      조약명_영문: "Convention on the Settlement of Investment Disputes between States and Nationals of Other States",
      국무회의심의일자: "", 국무회의심의회차: "0", 서명일자: "", 조약구분코드: "440102", 대통령재가일자: "",
      관보게재일자: "19670221", 조약번호: "234", 조약일련번호: "4037",
    },
  },
})

/** 양자조약 ID=1885: 루트가 BothTrtyService */
const BOTH_1885 = JSON.stringify({
  BothTrtyService: {
    조약내용: { 조약내용: "제1조본 협정에 의하여 부여되거나 본 협정에서 언급된 권리와 특권은 다음 사항에 관하여 적용된다." },
    추가정보: {
      양자조약분야코드: "440211", 체결대상국가: "IFC", 제2외국어종류: "null", 상대국측국내절차완료통보: "null",
      양자조약분야명: "기타", 우리측국내절차완료통보: "null", 국가코드: "085", 체결대상국가한글: "국제금융공사",
    },
    조약기본정보: {
      국회비준동의여부: "Y", 국회비준동의일자: "19721128", 조약명_한글: "대한민국과 국제금융공사간의 투자원본 회수에 관한 일반협정",
      서명장소: "워싱턴", 발효일자: "19730119", 비고: "",
      조약명_영문: "General Agreement between the Republic of Korea and the International Finance Corporation concerning Repayment of Principal of the Investment",
      국무회의심의일자: "19711102", 국무회의심의회차: "77", 서명일자: "19730119", 조약구분코드: "440101",
      대통령재가일자: "19721221", 관보게재일자: "19730119", 조약번호: "461", 조약일련번호: "1885",
    },
  },
})

/** 조약 검색(target=trty, query=투자) 원문: 조약일련번호 4037 ≠ 조약번호 234 */
const SEARCH_XML =
  `<?xml version="1.0" encoding="UTF-8"?><TrtySearch><target>trty</target><키워드>투자</키워드><section>trtyNm</section>` +
  `<totalCnt>149</totalCnt><page>1</page><numOfRows>2</numOfRows><resultCode>00</resultCode><resultMsg>success</resultMsg>` +
  `<Trty id="1"><조약일련번호>4037</조약일련번호><조약명><![CDATA[국가와 타방국가 국민간의 투자분쟁의 해결에 관한 협약]]></조약명>` +
  `<조약구분코드>440102</조약구분코드><조약구분명>다자조약</조약구분명><발효일자>19670323</발효일자><서명일자></서명일자>` +
  `<관보게제일자>19670221</관보게제일자><조약번호>234</조약번호><국가번호></국가번호>` +
  `<조약상세링크>/DRF/lawService.do?OC=test&amp;target=trty&amp;ID=4037&amp;type=HTML&amp;mobileYn=</조약상세링크></Trty>` +
  `<Trty id="2"><조약일련번호>244</조약일련번호><조약명><![CDATA[국제투자보증기구 설립협약]]></조약명>` +
  `<조약구분코드>440102</조약구분코드><조약구분명>다자조약</조약구분명><발효일자>19880412</발효일자><서명일자></서명일자>` +
  `<관보게제일자>19880418</관보게제일자><조약번호>948</조약번호><국가번호></국가번호>` +
  `<조약상세링크>/DRF/lawService.do?OC=test&amp;target=trty&amp;ID=244&amp;type=HTML&amp;mobileYn=</조약상세링크></Trty></TrtySearch>`

const clientReturning = (body: string) => ({ fetchApi: async () => body }) as unknown as LawApiClient

describe("getTreatyText: 조약 종류별 루트와 중첩 메타데이터 (D1)", () => {
  it("다자조약(MultTrtyService)을 not found로 떨어뜨리지 않고 기본정보를 채운다", async () => {
    const r = await getTreatyText(clientReturning(MULTI_4037), { id: "4037", chrClsCd: "010202" })
    const t = r.content[0].text
    expect(r.isError).toBeFalsy()
    expect(t).toContain("=== 국가와 타방국가 국민간의 투자분쟁의 해결에 관한 협약 ===")
    expect(t).toContain("조약일련번호: 4037")
    expect(t).toContain("조약번호: 234")
    expect(t).toContain("발효일: 19670323")
    expect(t).toContain("구분: 다자조약")
    expect(t).toContain("분야: 분쟁해결/상사중재")
    expect(t).toContain("체약국은, 경제발전을")
    expect(t).not.toContain("null")          // 추가정보의 "null" 문자열을 값으로 싣지 않는다
    expect(t).not.toContain("체결상대국")    // 다자조약엔 상대국이 없다 (N/A로 미상처럼 찍지 않음)
  })

  it("양자조약(BothTrtyService)의 조약명·체결일·상대국을 조약기본정보/추가정보에서 읽는다", async () => {
    const r = await getTreatyText(clientReturning(BOTH_1885), { id: "1885", chrClsCd: "010202" })
    const t = r.content[0].text
    expect(r.isError).toBeFalsy()
    expect(t).toContain("=== 대한민국과 국제금융공사간의 투자원본 회수에 관한 일반협정 ===")
    expect(t).toContain("조약번호: 461")
    expect(t).toContain("체결일: 19730119")
    expect(t).toContain("구분: 양자조약")
    expect(t).toContain("체결상대국: 국제금융공사 (IFC)")
    expect(t).not.toContain("N/A")           // 종전엔 조약명 포함 전 필드가 N/A였다
  })

  it("없는 조약일련번호(실측 응답 \"{}\")는 식별자 종류를 짚는 NOT_FOUND로 답한다", async () => {
    const r = await getTreatyText(clientReturning("{}"), { id: "234", chrClsCd: "010202" })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain("[NOT_FOUND]")
    expect(r.content[0].text).toContain("조약일련번호")
  })

  it("알 수 없는 루트는 최상위 키를 밝혀 오류로 낸다 (조용한 성공 금지)", async () => {
    const r = await getTreatyText(clientReturning(JSON.stringify({ Law: "점검 중" })), { id: "1", chrClsCd: "010202" })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain("최상위 키: Law")
  })
})

describe("searchTreaties: 전문 조회 안내가 조약일련번호를 가리킨다 (D1)", () => {
  it("treatySeq·조약번호가 아니라 get_decision_text + 조약일련번호로 안내한다", async () => {
    const r = await searchTreaties(clientReturning(SEARCH_XML), { query: "투자", display: 20, page: 1 })
    const t = r.content[0].text
    expect(t).toContain("[4037] 국가와 타방국가 국민간의 투자분쟁의 해결에 관한 협약")
    expect(t).toContain(`get_decision_text(domain="treaty", id="대괄호 안 조약일련번호")`)
    expect(t).not.toContain("treatySeq")
  })
})
