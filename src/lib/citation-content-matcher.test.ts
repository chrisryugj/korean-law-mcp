import { describe, it, expect } from "vitest"
import { matchCitationContent, normalizeLegalText } from "./citation-content-matcher.js"

describe("matchCitationContent", () => {
  it("동일 제목은 match", () => {
    expect(matchCitationContent("불법행위", "불법행위").matched).toBe(true)
  })

  it("짧은 claim이 실제 제목에 포함되면 match", () => {
    expect(matchCitationContent("불법행위", "불법행위의 내용").matched).toBe(true)
  })

  it("조사/어미 차이는 bigram jaccard로 흡수", () => {
    expect(matchCitationContent("손해배상책임", "손해배상의 책임").matched).toBe(true)
  })

  it("전혀 다른 제목은 mismatch (환각 탐지)", () => {
    const r = matchCitationContent("계약의 해제", "불법행위")
    expect(r.matched).toBe(false)
    expect(r.method).toBe("mismatch")
  })

  it("빈 입력은 mismatch", () => {
    expect(matchCitationContent("", "불법행위").matched).toBe(false)
    expect(matchCitationContent("불법행위", "").matched).toBe(false)
  })
})

describe("normalizeLegalText", () => {
  it("원문자 → 괄호숫자", () => {
    expect(normalizeLegalText("①항")).toBe("(1)항")
  })

  it("법명 홑화살괄호 제거", () => {
    expect(normalizeLegalText("「민법」")).toBe("민법")
  })

  it("NBSP는 일반 공백으로 정규화", () => {
    // U+00A0 (NBSP)를 코드포인트로 구성 — 소스에 제어문자 미포함
    const nbsp = String.fromCharCode(0x00a0)
    expect(normalizeLegalText(`손해${nbsp}배상`)).toBe("손해 배상")
  })
})
