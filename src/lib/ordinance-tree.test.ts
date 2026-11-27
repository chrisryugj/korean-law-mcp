import { describe, it, expect } from "vitest"
import { collectTreeOrdinances, jurisdictionOf, matchesRegion, renderTreeOrdinances } from "./ordinance-tree.js"

const ord = (name: string, seq: string) => ({ 기본정보: { 자치법규명: name, 자치법규일련번호: seq, 시행일자: "20260227" } })

// lsStmd JSON 상하위법 꼴(주차장법 실응답 경로): 법률/자치법규/조례[], 법률/시행령/자치법규/조례[], 법률/시행령/시행규칙/자치법규/조례[]
const HIER = {
  법률: {
    기본정보: { 법령명: "주차장법" },
    자치법규: { 조례: [ord("서울특별시 광진구 주차장 설치 및 관리 조례", "2112919"), ord("거제시 주차장 조례", "2184983"), ord("서울특별시 주차장 설치 및 관리 조례", "1")] },
    시행령: {
      기본정보: { 법령명: "주차장법 시행령" },
      자치법규: { 조례: ord("서울특별시 광진구 주차장 설치 및 관리 조례", "2112919") },
      시행규칙: { 자치법규: { 규칙: [ord("서울특별시 광진구 주차장 설치 및 관리 조례 시행규칙", "9")] } },
    },
  },
}

describe("체계도 자치법규", () => {
  it("단계마다 조례·규칙을 모은다(하나면 단일 객체)", () => {
    const list = collectTreeOrdinances(HIER)
    expect(list.map(o => `${o.level}:${o.kind}:${o.seq}`)).toEqual(["법률:조례:2112919", "법률:조례:2184983", "법률:조례:1", "시행령:조례:2112919", "시행규칙:규칙:9"])
  })

  it("제목 맨 앞 지자체: 광역+기초면 둘, 기초만 있거나 광역 자체면 하나", () => {
    expect(jurisdictionOf("서울특별시 광진구 주차장 설치 및 관리 조례")).toBe("서울특별시 광진구")
    expect(jurisdictionOf("거제시 주차장 조례")).toBe("거제시")
    expect(jurisdictionOf("서울특별시 주차장 설치 및 관리 조례")).toBe("서울특별시")
  })

  it("region 은 기초 이름만 줘도 맞고, 광역 이름은 그 광역 자체 자치법규만", () => {
    expect(matchesRegion("서울특별시 광진구 주차장 설치 및 관리 조례", "광진구")).toBe(true)
    expect(matchesRegion("서울특별시 광진구 주차장 설치 및 관리 조례", "서울특별시 광진구")).toBe(true)
    expect(matchesRegion("서울특별시 광진구 주차장 설치 및 관리 조례", "서울특별시")).toBe(false)
    expect(matchesRegion("서울특별시 주차장 설치 및 관리 조례", "서울특별시")).toBe(true)
    expect(matchesRegion("거제시 주차장 조례", "광진구")).toBe(false)
  })

  it("단계별 제목 건수와 region 자치법규(일련번호 중복 제거)를 싣는다", () => {
    const t = renderTreeOrdinances(collectTreeOrdinances(HIER), "광진구")
    expect(t).toContain("법률 단계 3건. 제목별: 주차장 설치 및 관리 조례 2, 주차장 조례 1")
    expect(t).toContain("광진구 자치법규 (2건):")
    expect(t).toContain("서울특별시 광진구 주차장 설치 및 관리 조례 [조례, 법률 단계, 자치법규일련번호 2112919, 시행 2026.02.27]")
    expect(t).toContain("서울특별시 광진구 주차장 설치 및 관리 조례 시행규칙 [규칙, 시행규칙 단계, 자치법규일련번호 9")
    expect(renderTreeOrdinances(collectTreeOrdinances(HIER), "수원시")).toContain("수원시 자치법규: 이 체계도에 연결된 것이 없습니다")
  })
})
