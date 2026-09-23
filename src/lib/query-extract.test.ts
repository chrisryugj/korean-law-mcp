/**
 * query-extract 추출기 회귀 (PR #150 결함 2 · 결함 3 보강)
 *
 * extractTimeTravel 의 접속어 걷어내기가 법령명 내부 음절을 자르던 결함과,
 * 상대 과거("작년이랑")가 fromDate 없이 남아 시나리오가 오류 안내로 끝나던 공백.
 */
import { describe, it, expect } from "vitest"
import { extractArticleNumbers, extractTimeTravel, lawNameFromQuery, stripArticleTail } from "./query-extract.js"

describe("결함2 — 접속어 제거가 법령명 내부를 절단하지 않는다", () => {
  it("'과' 를 품은 법령명이 보존된다", () => {
    expect(extractTimeTravel("과학기술기본법 2024 vs 2026").query).toBe("과학기술기본법")
    expect(extractTimeTravel("성과평가법 2024 vs 올해").query).toBe("성과평가법")
  })

  it("시점 토큰에 붙었던 조사·접속어는 여전히 걷어낸다", () => {
    expect(extractTimeTravel("관세법 2024와 2026 비교").query).toBe("관세법")
    expect(extractTimeTravel("관세법 2024년과 2025년 차이").query).toBe("관세법")
    expect(extractTimeTravel("관세법 2024부터 2026까지").query).toBe("관세법")
    expect(extractTimeTravel("민법 작년이랑 지금 뭐가 달라").query).toBe("민법")
  })

  it("날짜 파라미터 추출은 그대로다", () => {
    const p = extractTimeTravel("과학기술기본법 2024 vs 2026")
    expect([p.fromDate, p.toDate]).toEqual(["20240101", "20260101"])
  })
})

describe("결함3 보강 — 상대 과거 시점이 fromDate 로 완결된다", () => {
  it("'작년이랑 지금' 이 fromDate 없이 남지 않는다", () => {
    const p = extractTimeTravel("민법 작년이랑 지금 뭐가 달라")
    expect(p.fromDate).toBe(`${new Date().getFullYear() - 1}0101`)
    expect(String(p.toDate)).toMatch(/^\d{8}$/)
  })

  it("'재작년' 은 2년 전 연초다", () => {
    const p = extractTimeTravel("민법 재작년이랑 현재 비교")
    expect(p.fromDate).toBe(`${new Date().getFullYear() - 2}0101`)
  })

  it("명시 연도가 있으면 상대 어휘보다 우선한다", () => {
    expect(extractTimeTravel("관세법 2024 vs 올해").fromDate).toBe("20240101")
  })
})

// 2026-09-23 리뷰 C3: ARTICLE_RE·ARTICLE_TAIL_RE 의 `제?\s*\d+` 는 공백 덩어리의 시작 위치마다
// 끝까지 훑어 제곱이 됐다(search_ordinance 질의 공백 10만 자: stripArticleTail 5.7초,
// extractArticleNumbers 13.4초, lawNameFromQuery 18.9초). 추출기 입구에서 공백을 접는다.
describe("추출기: 공백 덩어리 입력 (리뷰 C3)", () => {
  it("공백 10만 자 질의도 즉시 끝난다", () => {
    const huge = "관세법" + " ".repeat(100_000) + "제38조"
    const t0 = performance.now()
    expect(stripArticleTail(huge)).toBe("관세법")
    expect(extractArticleNumbers(huge)).toEqual(["제38조"])
    expect(lawNameFromQuery(huge)).toBe("관세법")
    expect(performance.now() - t0).toBeLessThan(200)
  })

  // 리뷰 전 구현으로 뽑은 기준값 (2026-09-23)
  it("정상 질의 결과는 종전과 같다", () => {
    const CASES: Record<string, { strip: string, arts: string[], law: string }> = {
      "민법 제309조·제310조": { strip: "민법 ·", arts: ["제309조", "제310조"], law: "민법" },
      "도로교통법 제148조의2": { strip: "도로교통법", arts: ["제148조의2"], law: "도로교통법" },
      "형법 1조 2항": { strip: "형법", arts: ["제1조"], law: "형법" },
      "관세법 제38조 제2항 제3호 별표 2": { strip: "관세법 별표 2", arts: ["제38조"], law: "관세법" },
      "근로기준법  제60조   연차": { strip: "근로기준법 연차", arts: ["제60조"], law: "근로기준법 연차" },
      "민법 판례 검색": { strip: "민법 판례 검색", arts: [], law: "민법" },
      "개정 연혁 도로교통법": { strip: "개정 연혁 도로교통법", arts: [], law: "도로교통법" },
      "  공백   많은   질의  ": { strip: "공백 많은 질의", arts: [], law: "공백 많은 질의" },
      "서식 신청서 여권법": { strip: "서식 신청서 여권법", arts: [], law: "여권법" },
      "도교법 44조": { strip: "도교법", arts: ["제44조"], law: "도교법" },
      "영문 English 민법": { strip: "영문 English 민법", arts: [], law: "민법" },
    }
    for (const [q, want] of Object.entries(CASES)) {
      expect({ strip: stripArticleTail(q), arts: extractArticleNumbers(q), law: lawNameFromQuery(q) }).toEqual(want)
    }
  })
})
