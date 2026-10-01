import { describe, expect, it } from "vitest"
import type { LawApiClient } from "../lib/api-client.js"
import { getAcrDecisionText, getFtcDecisionText, getNlrcDecisionText, getPipcDecisionText, searchNlrcDecisions } from "./committee-decisions.js"

describe("위원회 상세 실응답 구조", () => {
  it("노동위 검색에서도 등록일을 결정일로 표시하지 않는다", async () => {
    const api = { fetchApi: async () => `<Nlrc><totalCnt>1</totalCnt><page>1</page><nlrc><결정문일련번호>1</결정문일련번호><제목>부당해고</제목><등록일>20260103</등록일></nlrc></Nlrc>` } as unknown as LawApiClient
    const result = await searchNlrcDecisions(api, { query: "해고" })
    expect(result.content[0].text).toContain("등록일: 20260103")
    expect(result.content[0].text).not.toContain("결정일: 20260103")
  })

  it("노동위 판정일과 등록일을 구분한다", async () => {
    const api = { fetchApi: async () => JSON.stringify({ NlrcService: { 제목: "부당해고", 판정일자: "20260101", 등록일: "20260103", 판정요지: "판정 본문" } }) } as unknown as LawApiClient
    const result = await getNlrcDecisionText(api, { id: "1" })
    expect(result.content[0].text).toContain("결정일자: 20260101")
    expect(result.content[0].text).toContain("등록일: 20260103")
  })

  it.each([
    ["개인정보위", getPipcDecisionText, "PpcService", { 안건명: "개인정보 제공 요청", 안건번호: "2026-1", 의결일자: "2026.1.1", 주문: "요청을 기각한다.", 결정요지: "개인정보 제공 범위를 제한한다.", 이유: "요청의 필요성을 검토한다." }],
    ["권익위", getAcrDecisionText, "AcrService", { 제목: "민원서류 발급 거부 이의", 의안번호: "2026-2", 의결일: "2026.1.2", 주문: "민원서류를 발급할 것을 권고한다.", 결정요지: "발급 거부 사유가 없다.", 이유: "신청인의 이해관계를 확인한다." }],
  ] as const)("%s 의결서 봉투의 제목·식별자·판단을 보존한다", async (_label, handler, serviceKey, record) => {
    const api = { fetchApi: async () => JSON.stringify({ [serviceKey]: { 의결서: record } }) } as unknown as LawApiClient
    const result = await handler(api, { id: "1" })
    const text = result.content[0].text
    expect(result.isError).toBeFalsy()
    for (const value of Object.values(record)) expect(text).toContain(value)
  })

  it("노동위의 제목·판정사항·판정요지·판정결과를 보존한다", async () => {
    const api = { fetchApi: async () => JSON.stringify({ NlrcService: {
      제목: "부당해고 구제신청", 사건번호: "중앙2026부해1", 등록일: "2026.1.3", 자료구분: "판정례",
      판정사항: "해고의 정당성 여부", 판정요지: "해고 사유와 절차를 검토한 판단이다.", 판정결과: "인용", 내용: "추가 판단 본문이다.",
    } }) } as unknown as LawApiClient
    const result = await getNlrcDecisionText(api, { id: "1" })
    const text = result.content[0].text
    expect(result.isError).toBeFalsy()
    expect(text).toContain("결정일자: N/A")
    expect(text).toContain("등록일: 2026.1.3")
    for (const value of ["부당해고 구제신청", "중앙2026부해1", "2026.1.3", "판정례", "해고의 정당성 여부", "해고 사유와 절차", "인용", "추가 판단 본문"]) expect(text).toContain(value)
  })

  it("공정위의 평탄한 기존 봉투와 의결일자·회의종류를 유지한다", async () => {
    const api = { fetchApi: async () => JSON.stringify({ FtcService: {
      사건명: "부당한 공동행위", 사건번호: "2026카1", 의결일자: "2026.1.4", 회의종류: "전원회의", 주문: "시정명령을 취소한다.",
    } }) } as unknown as LawApiClient
    const result = await getFtcDecisionText(api, { id: "1" })
    const text = result.content[0].text
    for (const value of ["부당한 공동행위", "2026카1", "2026.1.4", "전원회의", "시정명령을 취소한다."]) expect(text).toContain(value)
  })
})
