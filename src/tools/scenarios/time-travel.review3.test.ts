import { expect, it, vi } from "vitest"
import { fetchLawVersions } from "../../lib/law-lineage.js"
import { runTimeTravelScenario } from "./time-travel.js"
import type { ScenarioContext } from "./types.js"

vi.mock("../../lib/law-lineage.js", async original => ({
  ...await original<typeof import("../../lib/law-lineage.js")>(), fetchLawVersions: vi.fn(),
}))

it("does not compare another effective slice when historical eflaw is empty", async () => {
  vi.mocked(fetchLawVersions).mockResolvedValue({
    versions: ["20271231", "20260701"].map(efYd => ({
      mst: "281865", efYd, lawNm: "형사소송법", ancNo: "21241", ancYd: "20260609", rrCls: "일부개정",
    })), totalCount: 2, fetchedPages: 1,
  })
  const body = JSON.stringify({ 법령: { 조문: { 조문단위: [{
    조문여부: "조문", 조문번호: "1", 조문내용: "제1조 미래 시행 본문",
  }] } } })
  const fetchApi = vi.fn(async (p: { target: string; extraParams: { efYd?: string } }) =>
    p.target === "eflaw" && p.extraParams.efYd === "20260701" ? "{}" : body)
  const result = await runTimeTravelScenario({
    query: "형사소송법", apiClient: { fetchApi }, extras: { fromDate: "20260801", toDate: "20280101" },
  } as unknown as ScenarioContext)
  const text = result.sections.map(s => s.content).join("\n")
  expect(text).toContain("추출 실패")
  expect(text).not.toContain("본문 동일")
  expect(fetchApi.mock.calls.some(([p]) => p.target === "law")).toBe(false)
})
