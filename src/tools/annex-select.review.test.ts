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


describe("single annex fallback preserves known number", () => {
  it("does not replace a missing number with the sole known numbered annex", () => {
    expect(findMatchingAnnex([{ 별표번호: "000100", 별표명: "단일 기준" }], "999")).toBeUndefined()
  })
  it("does not replace a missing number with a different number in the sole title", () => {
    expect(findMatchingAnnex(tables("[별표 10] 기준"), "1")).toBeUndefined()
  })
  it("retains the fallback for a sole genuinely unnumbered annex", () => {
    expect(findMatchingAnnex(tables("수수료 기준"), "1")?.별표명).toBe("수수료 기준")
  })
})
