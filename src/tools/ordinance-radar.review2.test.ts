import { describe, expect, it, vi } from "vitest"
import type { LawApiClient } from "../lib/api-client.js"
import { ExecutionLimitError } from "../lib/execution-limits.js"
import { ordinanceRadar } from "./ordinance-radar.js"

function client(purpose: string, ordDate = "20200101") {
  const searchLaw = vi.fn(async (name: string) => `<LawSearch><law><법령명한글>${name}</법령명한글>` +
    `<시행일자>20210101</시행일자><법령일련번호>1</법령일련번호></law></LawSearch>`)
  const api = { searchLaw, getOrdinance: async () => JSON.stringify({ LawService: {
    자치법규기본정보: { 자치법규명: "테스트 조례", 시행일자: ordDate },
    조문: { 조: { 조제목: "목적", 조내용: purpose } },
  } }) } as unknown as LawApiClient
  return { api, searchLaw }
}

describe("조례 근거법과 기준일 검증", () => {
  it.each(["", "20209999"])("조례 시행일이 불명확하면 반영 완료로 인증하지 않는다: %s", async date => {
    const { api } = client("「주차장법」에 따른 사항을 정한다.", date)
    const text = (await ordinanceRadar(api, { ordinSeq: "1" })).content[0].text
    expect(text).not.toContain("✅")
    expect(text).not.toContain("반영된 것으로")
    expect(text).toContain("조례 시행일 확인 불가")
  })

  it("다른 법의 시행령 인용에서 명시되지 않은 시행령을 파생하지 않는다", async () => {
    const { api, searchLaw } = client("「주차장법」 및 「건축법 시행령」에 따른 사항을 정한다.")
    await ordinanceRadar(api, { ordinSeq: "1" })
    expect(searchLaw.mock.calls.map(([name]) => name)).toEqual(["주차장법", "건축법 시행령"])
  })

  it("같은 법은 직전 법률을 가리키고 병기된 시행령·시행규칙을 유지한다", async () => {
    const { api, searchLaw } = client("「주차장법」과 「건축법」 및 같은 법 시행령 및 시행규칙에 따른 사항을 정한다.")
    await ordinanceRadar(api, { ordinSeq: "1" })
    expect(searchLaw.mock.calls.map(([name]) => name)).toEqual(["주차장법", "건축법", "건축법 시행령", "건축법 시행규칙"])
  })

  it("상위법 조회 예산 소진을 성공 결과로 삼키지 않는다", async () => {
    const { api, searchLaw } = client("「주차장법」에 따른 사항을 정한다.")
    searchLaw.mockRejectedValue(new ExecutionLimitError("Request upstream work budget exceeded"))
    expect((await ordinanceRadar(api, { ordinSeq: "1" })).isError).toBe(true)
  })
})
