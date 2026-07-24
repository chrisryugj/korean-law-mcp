import { describe, it, expect } from "vitest"
import { parseLawXml, pickRepealed, type LawInfo } from "./law-search.js"

// eflaw 검색 XML 조각 — 실제 응답 구조(현행연혁코드·시행일자 포함)
const EFLAW_XML = `
<LawSearch>
  <law>
    <법령일련번호>235583</법령일련번호>
    <현행연혁코드>연혁</현행연혁코드>
    <법령명한글>저탄소 녹색성장 기본법</법령명한글>
    <법령ID>011134</법령ID>
    <법령구분명>법률</법령구분명>
    <시행일자>20220325</시행일자>
  </law>
  <law>
    <법령일련번호>200000</법령일련번호>
    <현행연혁코드>연혁</현행연혁코드>
    <법령명한글>저탄소 녹색성장 기본법</법령명한글>
    <법령ID>011134</법령ID>
    <법령구분명>법률</법령구분명>
    <시행일자>20200527</시행일자>
  </law>
</LawSearch>`

describe("parseLawXml — 현행연혁 상태·시행일 캡처", () => {
  it("현행연혁코드와 시행일자를 함께 파싱한다", () => {
    const rows = parseLawXml(EFLAW_XML, 10)
    expect(rows).toHaveLength(2)
    expect(rows[0].lawName).toBe("저탄소 녹색성장 기본법")
    expect(rows[0].status).toBe("연혁")
    expect(rows[0].effectiveDate).toBe("20220325")
  })
})

describe("pickRepealed — 폐지(연혁) 법령 최신본 선택", () => {
  it("질의명과 일치하는 연혁 법령 중 최신 시행본을 고른다", () => {
    const rows = parseLawXml(EFLAW_XML, 10)
    const r = pickRepealed(rows, "저탄소 녹색성장 기본법")
    expect(r?.lawName).toBe("저탄소 녹색성장 기본법")
    expect(r?.effectiveDate).toBe("20220325") // 20200527보다 최신
  })

  it("공백 차이는 무시하고 매칭한다", () => {
    const rows = parseLawXml(EFLAW_XML, 10)
    expect(pickRepealed(rows, "저탄소녹색성장기본법")?.status).toBe("연혁")
  })

  it("현행(연혁 아님) 행은 폐지로 잡지 않는다", () => {
    const current: LawInfo[] = [
      { lawName: "민법", lawId: "1", mst: "1", lawType: "법률", status: "현행", effectiveDate: "20230101" },
    ]
    expect(pickRepealed(current, "민법")).toBeUndefined()
  })

  it("이름이 다른 연혁 법령은 흡수하지 않는다", () => {
    const rows = parseLawXml(EFLAW_XML, 10)
    expect(pickRepealed(rows, "전혀 다른 법률")).toBeUndefined()
  })
})
