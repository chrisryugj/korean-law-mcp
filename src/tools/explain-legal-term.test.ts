import { describe, expect, it, vi } from "vitest"
vi.mock("./knowledge-base.js", () => ({
  getDailyToLegal: vi.fn(async () => ({ content: [{ type: "text", text: "전세금 → 전세권" }] })),
  getLegalToDaily: vi.fn(async () => ({ content: [{ type: "text", text: "[NOT_FOUND]" }], isError: true })),
  getTermArticles: vi.fn(async () => { throw new Error("upstream down") }),
}))
vi.mock("./legal-terms.js", () => ({ searchLegalTerms: vi.fn(async () => ({ content: [{ type: "text", text: "전세권: 전세금을 지급하고…" }] })) }))
const { explainLegalTerm } = await import("./explain-legal-term.js")

describe("explain_legal_term", () => {
  it("용어 도구 넷을 묶고, 실패·없음은 빼고 나머지를 낸다", async () => {
    const t = (await explainLegalTerm({} as never, { term: "전세금" })).content[0].text
    expect(t).toContain("▶ 일상어 → 법령용어\n전세금 → 전세권")
    expect(t).toContain("▶ 법령용어 뜻")
    expect(t).not.toContain("법령용어 → 일상어")
    expect(t).not.toContain("쓰인 조문")
  })
})
