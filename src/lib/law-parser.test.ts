import { describe, it, expect } from "vitest"
import { buildJO, buildOrdinanceJO, formatJO } from "./law-parser.js"

// JO Code 도메인 규칙(CLAUDE.md): 법령은 AAAABB (조번호 4자리 + 의번호 2자리)
describe("buildJO — 법령 JO코드 (AAAABB)", () => {
  it("제38조 → 003800", () => {
    expect(buildJO("제38조")).toBe("003800")
  })
  it("제10조의2 → 001002 (의번호가 하위 2자리)", () => {
    expect(buildJO("제10조의2")).toBe("001002")
  })
  it("제1조 → 000100", () => {
    expect(buildJO("제1조")).toBe("000100")
  })
})

// 자치법규는 AABBCC (조 2자리 + 의 2자리 + 목 2자리)
describe("buildOrdinanceJO — 자치법규 JO코드 (AABBCC)", () => {
  it("제1조 → 010000", () => {
    expect(buildOrdinanceJO("제1조")).toBe("010000")
  })
  it("제10조의2 → 100200", () => {
    expect(buildOrdinanceJO("제10조의2")).toBe("100200")
  })
})

// build → format 왕복이 원문을 보존해야 함 (조회 링크 정확성의 핵심)
describe("formatJO round-trip", () => {
  it.each(["제1조", "제38조", "제10조의2"])("%s 왕복 보존", (article) => {
    expect(formatJO(buildJO(article))).toBe(article)
  })
  it("자치법규 포맷: 010000 → 제1조", () => {
    expect(formatJO("010000", true)).toBe("제1조")
  })
  it("이미 사람이 읽는 형태면 그대로 반환", () => {
    expect(formatJO("제5조")).toBe("제5조")
  })
})
