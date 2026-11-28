import { describe, expect, it } from "vitest"
import { pickHangHo, splitJo } from "./applicable-law.js"

describe("applicable_law 항·호 자르기", () => {
  it("jo 의 항·호를 가르고, 그 항(호)만 조 머리와 함께 낸다", () => {
    expect(splitJo("제44조 제1항 제2호")).toEqual({ article: "제44조", hang: 1, ho: 2 })
    expect(splitJo("제10조의2")).toEqual({ article: "제10조의2", hang: undefined, ho: undefined })
    const unit = { 조문내용: "제44조(술에 취한 상태에서의 운전 금지)", 항: [
      { 항번호: "①", 항내용: "① 누구든지 술에 취한 상태에서 운전하여서는 아니 된다.", 호: [{ 호번호: "1.", 호내용: "1. 가" }, { 호번호: "2.", 호내용: "2. 나" }] },
      { 항번호: "②", 항내용: "② 경찰공무원은 측정할 수 있다." },
    ] }
    expect(pickHangHo(unit, 1, 2)).toBe("제44조(술에 취한 상태에서의 운전 금지)\n① 누구든지 술에 취한 상태에서 운전하여서는 아니 된다.\n2. 나")
    expect(pickHangHo(unit, 2)).toContain("② 경찰공무원은")
    expect(pickHangHo(unit)).toBeUndefined()
  })
})
