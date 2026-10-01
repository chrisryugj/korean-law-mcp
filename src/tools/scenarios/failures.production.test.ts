import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ScenarioContext } from "./types.js"
import { runManualScenario } from "./manual.js"
import { runImpactScenario } from "./impact.js"
import { runComplianceScenario } from "./compliance.js"
import { runTimelineScenario } from "./timeline.js"

const handlers = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock("../law-system-tree.js", () => ({ getLawSystemTree: handlers.lookup }))
vi.mock("../law-linkage.js", () => ({
  getLinkedOrdinances: handlers.lookup, getLinkedOrdinanceArticles: handlers.lookup,
  getLinkedLawsFromOrdinance: handlers.lookup,
}))
vi.mock("../admin-rule.js", () => ({ searchAdminRule: handlers.lookup }))
vi.mock("../interpretations.js", () => ({ searchInterpretations: handlers.lookup }))
vi.mock("../constitutional-decisions.js", () => ({ searchConstitutionalDecisions: handlers.lookup }))
vi.mock("../admin-appeals.js", () => ({ searchAdminAppeals: handlers.lookup }))
vi.mock("../precedents.js", () => ({ searchPrecedents: handlers.lookup }))

const ctx = {
  apiClient: {}, query: "민법", law: { lawName: "민법", lawId: "001706", mst: "100", lawType: "법률" },
} as ScenarioContext

describe("scenario supplementary lookup failures", () => {
  beforeEach(() => handlers.lookup.mockReset())

  it.each([
    ["manual", runManualScenario, 3], ["impact", runImpactScenario, 4],
    ["compliance", runComplianceScenario, 3], ["timeline", runTimelineScenario, 2],
  ] as const)("%s preserves failure evidence for each requested lookup", async (_name, run, expected) => {
    handlers.lookup.mockResolvedValue({ content: [{ type: "text", text: "[EXTERNAL_API_ERROR] upstream unavailable" }], isError: true })
    const result = await run(ctx)
    expect(result.sections).toHaveLength(expected)
    expect(result.sections.every(section => section.isError && section.content.includes("upstream unavailable"))).toBe(true)
  })

  it.each([runManualScenario, runImpactScenario, runComplianceScenario, runTimelineScenario])(
    "keeps definitive no-result responses separate from lookup failures", async run => {
      handlers.lookup.mockResolvedValue({ content: [{ type: "text", text: "[NOT_FOUND] 검색 결과 없음" }], isError: true })
      expect((await run(ctx)).sections).toEqual([])
    },
  )
})
