/**
 * 라우팅 설명기 회귀 테스트 (#132 #136 #142)
 */
import { describe, it, expect } from "vitest"
import { explainRoute } from "./route-explain.js"
import { routeQuery } from "./query-router.js"
import { parseDateRange } from "./date-parser.js"

describe("#142 설명기가 CLI 본 출력과 같은 정보를 보여준다", () => {
  it("미지원 파라미터를 표시한다", () => {
    // 법령해석례 상세(get_interpretation_text)는 full 을 받지 않는다 (자치법규 상세는 4.15.34 부터 받는다)
    const q = "근로기준법 해석례 전문 보여줘"
    expect(routeQuery(q).unsupportedParams).toContain("full")
    expect(explainRoute(q)).toContain("full")
  })

  it("확인 요청 문구를 표시한다", () => {
    const q = "민법 2024"
    const clarify = routeQuery(q).clarify
    expect(clarify).toBeDefined()
    // reason 문구에 "확인 요청"이 들어 있어 헛통과하지 않도록 clarify 본문으로 대조한다
    expect(explainRoute(q)).toContain(clarify!)
  })
})

describe("#132 설명기가 라우팅을 다시 계산하지 않는다", () => {
  it("이미 계산한 RouteResult 를 받아 그대로 설명한다", () => {
    const q = "최근 3년 음주운전 판례"
    const route = routeQuery(q)
    route.reason = "테스트용 표식"
    // 재라우팅하면 이 표식이 사라진다
    expect(explainRoute(q, route)).toContain("테스트용 표식")
  })

  it("인자를 생략하면 종전대로 스스로 계산한다", () => {
    expect(explainRoute("민법 제1조")).toContain("get_law_text")
  })
})

describe("#136 date-parser 고아 필드", () => {
  it("cleanQuery 필드를 더 이상 만들지 않는다", () => {
    const r = parseDateRange("최근 3년 음주운전 판례")
    expect(Object.keys(r)).not.toContain("cleanQuery")
  })

  it("범위와 매칭 조각은 그대로 제공한다", () => {
    const r = parseDateRange("최근 3년 음주운전 판례")
    expect(r.range).toBeDefined()
    expect(r.matched).toBe("최근 3년")
  })
})
