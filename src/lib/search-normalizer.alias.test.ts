import { describe, it, expect } from "vitest"
import { resolveLawAlias, expandLawQuery } from "./search-normalizer.js"

// 2026-01 시행 인공지능기본법 — 통칭("인공지능법")이 정식명과 달라
// 법제처 LIKE 검색이 0건을 반환하던 사례 (lexdiff fast-path 오법령 사고)
const AI_ACT = "인공지능 발전과 신뢰 기반 조성 등에 관한 기본법"

describe("인공지능기본법 약칭", () => {
  it.each(["인공지능법", "인공지능기본법", "AI법", "ai기본법"])(
    "'%s' → 정식명으로 해석",
    (alias) => {
      expect(resolveLawAlias(alias).canonical).toBe(AI_ACT)
    }
  )

  it("expandLawQuery('인공지능법') 첫 확장쿼리가 정식명 (AI법 같은 잡음보다 우선)", () => {
    const { expanded } = expandLawQuery("인공지능법")
    expect(expanded[0]).toBe(AI_ACT)
  })
})
