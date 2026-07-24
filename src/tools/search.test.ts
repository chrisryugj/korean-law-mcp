import { describe, it, expect } from "vitest"
import { hasRelatedHit } from "./search.js"

const hit = (name: string, abbr = "") => ({
  name, abbr, lawId: "0", mst: "0", promDate: "", effDate: "", statusCode: "현행", lawType: "법률",
})

// 법제처 API가 "AI법" 쿼리에 검색어를 무시하고 가나다순 전체 목록을 반환하던 사례:
// 무관한 목록을 확장쿼리 결과로 채택하면 안 됨
describe("hasRelatedHit", () => {
  it("법령명이 쿼리를 포함하면 true", () => {
    expect(hasRelatedHit([hit("화학물질관리법 시행령")], "화학물질관리법")).toBe(true)
  })

  it("쿼리가 법령명을 포함해도 true (조문 꼬리 붙은 확장쿼리)", () => {
    expect(hasRelatedHit([hit("화학물질관리법")], "화학물질관리법 제5조")).toBe(true)
  })

  it("약칭 매칭도 인정", () => {
    expect(hasRelatedHit([hit("산업안전보건법", "산안법")], "산안법")).toBe(true)
  })

  it("무관한 목록(쿼리 무시 응답)은 false", () => {
    const junk = [hit("가맹사업거래의 공정화에 관한 법률"), hit("긴급복지지원법"), hit("도시철도법")]
    expect(hasRelatedHit(junk, "AI법")).toBe(false)
  })
})
