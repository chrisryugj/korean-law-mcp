import { beforeEach, describe, it, expect } from "vitest"
import { summarizePrecedent } from "./precedent-summary.js"
import { UpstreamRecordMissingError } from "../lib/upstream-miss.js"
import type { LawApiClient } from "../lib/api-client.js"
import { precedentCache } from "./precedents.js"

beforeEach(() => precedentCache.clear())

// 2026-09-23 리뷰 D8: 판례 조회의 오류 결과를 "[NOT_FOUND] 판례를 찾을 수 없습니다"로 덮던 결함.
// prec 단건 조회 미스는 부존재를 증명하지 않는 [UPSTREAM_NO_DATA]다. 라벨이 바뀌면 거짓 부정이 된다.
describe("summarizePrecedent: 판례 조회 오류 라벨을 보존한다 (D8)", () => {
  it("[UPSTREAM_NO_DATA]를 [NOT_FOUND]로 바꾸지 않는다", async () => {
    const client = {
      fetchApi: async () => {
        throw new UpstreamRecordMissingError("https://www.law.go.kr/DRF/lawService.do?OC=***&target=prec&ID=1", "empty")
      },
    } as unknown as LawApiClient
    const r = await summarizePrecedent(client, { id: "1", maxLength: 500 })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain("[UPSTREAM_NO_DATA]")
    expect(r.content[0].text).not.toContain("[NOT_FOUND]")
  })
})

describe("summarizePrecedent: 요약 섹션 경계", () => {
  it("참조조문·참조판례·전문을 판결요지에 합치지 않는다", async () => {
    const client = { fetchApi: async () => JSON.stringify({ PrecService: {
      사건번호: "2020다1", 법원명: "대법원", 판시사항: "쟁점 판시사항이다.", 판결요지: "판결요지 내용이다.",
      참조조문: "민법 제750조", 참조판례: "대법원 2013다61381 판결", 판례내용: "전문에만 있는 별도 문장이다.",
    } }) } as unknown as LawApiClient
    const result = await summarizePrecedent(client, { id: "summary-boundary", maxLength: 3000 })
    const text = result.content[0].text
    expect(text).toContain("판결요지 내용이다.")
    expect(text).not.toContain("민법 제750조")
    expect(text).not.toContain("2013다61381")
    expect(text).not.toContain("전문에만 있는")
  })

  it("판시사항 안의 사건번호·법원 언급이 대상 기본정보를 덮어쓰지 않는다", async () => {
    const client = { fetchApi: async () => JSON.stringify({ PrecService: {
      사건번호: "2020다1", 법원명: "대법원",
      판시사항: "[1] 관련 사건번호: 2013다61381을 확인할 필요가 있는지 여부\n[2] 원심 법원: 서울고등법원의 판단이 적법한지 여부",
      판결요지: "판결요지 내용이다.",
    } }) } as unknown as LawApiClient
    const result = await summarizePrecedent(client, { id: "summary-metadata", maxLength: 3000 })
    const text = result.content[0].text
    expect(text).toMatch(/^판례 요약\n\n사건번호: 2020다1\n법원: 대법원/)
    expect(text).toContain("[1] 관련 사건번호: 2013다61381")
    expect(text).toContain("[2] 원심 법원: 서울고등법원")
  })

  it("판례 전문의 주문은 별도 주문 섹션으로 유지한다", async () => {
    const client = { fetchApi: async () => JSON.stringify({ PrecService: {
      사건번호: "2020다1", 법원명: "대법원", 판결요지: "판결요지 내용이다.",
      판례내용: "【주문】\n원심판결을 파기한다.\n【이유】\n원심 판단에는 법리 오해가 있다.",
    } }) } as unknown as LawApiClient
    const result = await summarizePrecedent(client, { id: "summary-order", maxLength: 3000 })
    const text = result.content[0].text
    expect(text).toContain("【주문】\n원심판결을 파기한다.")
    expect(text).not.toContain("원심 판단에는 법리 오해")
  })
})
