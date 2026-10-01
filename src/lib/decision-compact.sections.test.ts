import { describe, expect, it } from "vitest"
import { compactLongSections } from "./decision-compact.js"

const longReason = "첫 판단이다. ".repeat(400)

describe("compactLongSections: section boundaries", () => {
  it("compacts an FTC reason preceding a short final document field", () => {
    // FtcService ID 19361 has long 이유 followed by a 21-character 의결문.
    const text = `제목\n\n결정요지:\n요지는 유지한다.\n\n이유:\n${longReason}\n\n전문:\n위원장 서명.\n`
    const compact = compactLongSections(text)
    expect(compact.length).toBeLessThan(text.length / 2)
    expect(compact).toContain("⋯ 중략")
    expect(compact).toContain("결정요지:\n요지는 유지한다.")
    expect(compact).toContain("전문:\n위원장 서명.")
  })

  it("preserves legal grounds after a long reason in both ordering and content", () => {
    const legalGrounds = "국민건강보험법 제70조. ".repeat(100)
    const text = `제목\n이유:\n${longReason}\n\n관련법령:\n${legalGrounds}\n`
    expect(compactLongSections(text)).toContain(`관련법령:\n${legalGrounds}`)
  })

  it("compacts each eligible long section and leaves protected sections intact", () => {
    const text = `제목\n주문:\n${longReason}\n이유:\n${longReason}\n전문:\n${longReason}`
    const result = compactLongSections(text)
    expect(result.match(/⋯ 중략/g)).toHaveLength(2)
    expect(result).toContain(`주문:\n${longReason}`)
    expect(compactLongSections(result)).toBe(result)
  })
})
