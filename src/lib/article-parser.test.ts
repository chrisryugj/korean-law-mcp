import { describe, it, expect } from "vitest"
import { parseHangNumber } from "./article-parser.js"

describe("parseHangNumber — 원숫자 21항 이상", () => {
  // 회귀: ①~⑳까지만 매핑해 ㉑+(다른 유니코드 블록)가 NaN → verify_citations가
  // 실존하는 제21항 인용을 "존재하지 않는 항"(HALLUCINATION_DETECTED)으로 오판했다.
  it("㉑~㊿ 원숫자를 파싱한다", () => {
    expect(parseHangNumber("㉑")).toBe(21)
    expect(parseHangNumber("㉟")).toBe(35)
    expect(parseHangNumber("㊱")).toBe(36)
    expect(parseHangNumber("㊿")).toBe(50)
  })

  it("기존 ①~⑳·일반 숫자 동작 유지", () => {
    expect(parseHangNumber("①")).toBe(1)
    expect(parseHangNumber("⑳")).toBe(20)
    expect(parseHangNumber("제3항")).toBe(3)
    expect(parseHangNumber("")).toBeNaN()
  })
})
