import { describe, expect, it } from "vitest"
import { findMatchingAnnex, type AnnexItem } from "./annex-select.js"

const tables = (...titles: string[]): AnnexItem[] => titles.map(title => ({ 별표명: title, 별표종류: "별표" }))

describe("annex selector number boundaries", () => {
  it("does not accept a longer title number before the requested number", () => {
    expect(findMatchingAnnex(tables("[별표 10] 다른 기준", "[별표 1] 요청 기준"), "1")?.별표명).toBe("[별표 1] 요청 기준")
  })

  it("does not accept a branch title before its base number", () => {
    expect(findMatchingAnnex(tables("[별표 1의2] 가지 기준", "[별표 1] 본번 기준"), "1")?.별표명).toBe("[별표 1] 본번 기준")
  })

  it("does not accept a longer branch suffix", () => {
    expect(findMatchingAnnex(tables("[별표 1의20] 다른 기준", "[별표 1의2] 요청 기준"), "1의2")?.별표명).toBe("[별표 1의2] 요청 기준")
  })

  it("does not infer a branch number from a bundled base-number range", () => {
    expect(findMatchingAnnex(tables("[별표 1~5] 묶음 기준", "[별표 1의3] 다른 가지"), "1의2")).toBeUndefined()
  })
})
