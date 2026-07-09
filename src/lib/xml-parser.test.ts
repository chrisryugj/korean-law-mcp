import { describe, it, expect } from "vitest"
import { stripHtml, toArray, extractTag } from "./xml-parser.js"

describe("stripHtml — 검색결과 하이라이트 태그 제거", () => {
  it('<strong class="...">지방</strong>자치법 → 지방자치법', () => {
    expect(stripHtml('<strong class="tbl_tx_type">지방</strong>자치법')).toBe("지방자치법")
  })
  it("태그 없으면 원문 유지", () => {
    expect(stripHtml("민법")).toBe("민법")
  })
})

// Critical Rule 6: API 응답의 배열 필드가 단일 객체로 올 수 있음
describe("toArray — 단일 객체 정규화", () => {
  it("단일 객체 → 길이 1 배열", () => {
    expect(toArray({ a: 1 })).toEqual([{ a: 1 }])
  })
  it("배열은 그대로", () => {
    expect(toArray([1, 2])).toEqual([1, 2])
  })
  it("null / undefined → 빈 배열", () => {
    expect(toArray(null)).toEqual([])
    expect(toArray(undefined)).toEqual([])
  })
})

describe("extractTag — XML 태그 텍스트 추출", () => {
  it("일반 태그", () => {
    expect(extractTag("<법령명한글>민법</법령명한글>", "법령명한글")).toBe("민법")
  })
  it("CDATA 우선 처리", () => {
    expect(extractTag("<본문><![CDATA[제1조 내용]]></본문>", "본문")).toBe("제1조 내용")
  })
  it("self-closing 태그는 빈 문자열", () => {
    expect(extractTag("<조문내용/>", "조문내용")).toBe("")
  })
  it("없는 태그는 빈 문자열", () => {
    expect(extractTag("<a>x</a>", "b")).toBe("")
  })
})
