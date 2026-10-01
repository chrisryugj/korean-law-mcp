import { beforeEach, describe, expect, it, vi } from "vitest"
import { fetchLawVersions } from "../../lib/law-lineage.js"
import type { ScenarioContext } from "./types.js"
import { runTimeTravelScenario } from "./time-travel.js"

vi.mock("../../lib/law-lineage.js", async importOriginal => ({
  ...await importOriginal<typeof import("../../lib/law-lineage.js")>(), fetchLawVersions: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(fetchLawVersions).mockReset().mockResolvedValue({
  versions: [{ mst: "new", efYd: "20250101", lawNm: "테스트법", ancNo: "2", ancYd: "20240101", rrCls: "전부개정" },
    { mst: "old", efYd: "20240101", lawNm: "테스트법", ancNo: "1", ancYd: "20230101", rrCls: "일부개정" }],
  totalCount: 2, fetchedPages: 1,
  })
})

function context(fromDate: string, toDate: string): ScenarioContext {
  return { query: "테스트법", extras: { fromDate, toDate }, apiClient: {
    fetchApi: async (p: { extraParams: { MST: string } }) => JSON.stringify({ 법령: { 조문: { 조문단위: [{
      조문여부: "조문", 조문번호: "1", 조문내용: `제1조 ${p.extraParams.MST}`,
    }] } } }),
  } } as unknown as ScenarioContext
}

describe("time_travel 날짜와 역구간", () => {
  it.each([["20249999", "20241231"], ["20240101", "20250230"]])(
    "존재하지 않는 날짜는 비교 전에 거절한다: %s/%s", async (from, to) => {
      const result = await runTimeTravelScenario(context(from, to))
      expect(result.sections[0].content).toContain("날짜")
      expect(fetchLawVersions).not.toHaveBeenCalled()
    })

  it("역방향 비교에서도 사이의 전부개정 경고와 구간 연혁을 유지한다", async () => {
    const result = await runTimeTravelScenario(context("20260101", "20240101"))
    const text = result.sections.map(s => s.content).join("\n")
    expect(text).toContain("두 시점 사이 전부개정")
    expect(text).toContain("[구간 개정 연혁]")
    expect(text).toContain("시점 A: 2025.01.01 시행 | MST new")
    expect(text).toContain("시점 B: 2024.01.01 시행 | MST old")
  })
})
