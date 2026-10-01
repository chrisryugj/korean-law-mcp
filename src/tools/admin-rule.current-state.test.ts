import { describe, expect, it, vi } from "vitest"
import { searchAdminRule } from "./admin-rule.js"
import type { LawApiClient } from "../lib/api-client.js"

const row = (serial: string, issued: string, effective: string, revision: string, state: string) =>
  `<admrul><행정규칙일련번호>${serial}</행정규칙일련번호><행정규칙ID>1</행정규칙ID>` +
  `<행정규칙명>표시 검증 고시</행정규칙명><발령일자>${issued}</발령일자><시행일자>${effective}</시행일자>` +
  `<발령번호>${serial}</발령번호><제개정구분명>${revision}</제개정구분명><현행연혁구분>${state}</현행연혁구분></admrul>`

function client(rows: string[]): LawApiClient {
  return { searchAdminRule: async () => `<AdmRulSearch><totalCnt>${rows.length}</totalCnt>${rows.join("")}</AdmRulSearch>` } as unknown as LawApiClient
}

describe("행정규칙 연혁의 현행·시행예정·폐지 표시", () => {
  it("API의 현행 플래그가 시행 전 개정에 붙어도 실제 시행 버전을 현행으로 표시한다", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-02T00:00:00Z"))
    try {
      const r = await searchAdminRule(client([
        row("3", "20260901", "20270101", "일부개정", "현행"),
        row("2", "20260101", "20260101", "일부개정", "연혁"),
        row("1", "20200101", "20200101", "제정", "연혁"),
      ]), { query: "표시 검증 고시", display: 20, history: true })
      expect(r.content[0].text).toContain("| 3 [시행예정]")
      expect(r.content[0].text).toContain("| 2 [현행]")
      expect(r.content[0].text).not.toContain("| 3 [현행]")
    } finally { clock.mockRestore() }
  })

  it("폐지 행을 현행으로 표시하지 않는다", async () => {
    const r = await searchAdminRule(client([
      row("2", "20250101", "20250101", "폐지", "현행"),
      row("1", "20200101", "20200101", "제정", "연혁"),
    ]), { query: "표시 검증 고시", display: 20, history: true })
    expect(r.content[0].text).toContain("| 2 [폐지]")
    expect(r.content[0].text).not.toContain("[현행]")
  })
})
