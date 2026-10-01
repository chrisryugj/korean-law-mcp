/**
 * decision-compact 회귀 (2026-09-23 리뷰 C10)
 *
 * compactBody 는 경계를 못 찾으면 HEAD·TAIL 자리에서 하드컷한다. 그 자리가 서로게이트 쌍
 * 한가운데면 lone surrogate 가 남아 JSON 직렬화에서 U+FFFD 로 변형된다(#150 과 같은 유형).
 */
import { describe, it, expect } from "vitest"
import { compactBody, densifyPrecedentRefs } from "./decision-compact.js"

// `𠮷`(U+20BB7)은 UTF-16 유닛 2개다
const ASTRAL = String.fromCodePoint(0x20bb7)

describe("compactBody: 서로게이트 쌍을 가르지 않는다 (리뷰 C10)", () => {
  it("앞쪽 하드컷 자리(HEAD=800)가 쌍 한가운데여도 온전하다", () => {
    // 앞에 한 글자를 둬 800번째 유닛이 high surrogate 가 되게 한다
    const out = compactBody("가" + ASTRAL.repeat(1000))
    expect(out).toContain("⋯ 중략")
    expect(out.isWellFormed()).toBe(true)
  })

  it("뒤쪽 하드컷 자리(length-400)가 쌍 한가운데여도 온전하다", () => {
    // 꼬리 시작 유닛이 low surrogate 가 되게 끝에 한 글자를 둔다
    const out = compactBody(ASTRAL.repeat(1000) + "가")
    expect(out).toContain("⋯ 중략")
    expect(out.isWellFormed()).toBe(true)
  })

  // 리뷰 전 구현으로 뽑은 기준값 (2026-09-23)
  it("정상 본문 결과는 종전과 같다", () => {
    expect(compactBody("가나다라마바사다. ".repeat(12) + "끝이다.", { headSize: 30, tailSize: 20, minSave: 5 }))
      .toBe("가나다라마바사다. 가나다라마바사다. 가나다라마바사다.\n\n⋯ 중략 81자 (full=true로 전문 조회) ⋯\n\n가나다라마바사다. 끝이다.")
    expect(compactBody("abc\n\n" + "x".repeat(200) + "\n\ndef", { headSize: 40, tailSize: 30, minSave: 10 }))
      .toBe("abc\n\n" + "x".repeat(35) + "\n\n⋯ 중략 140자 (full=true로 전문 조회) ⋯\n\n" + "x".repeat(25) + "\n\ndef")
  })
})

describe("compactBody: 문장 경계 (2026-10-01 감사 실측 616245·620409)", () => {
  it("머리는 숫자 바로 뒤의 '. '(날짜·번호)에서 끊지 않는다", () => {
    // 종전: 가장 뒤의 '. ' 가 이겨 "…소외 조합은 2020. 12. 28." 에서 끝났다
    const text = "가".repeat(700) + "제출하였다.\n소외 조합은 2020. 12. 28. 임시총회를 개최하여 " + "나".repeat(1200) + " 끝이다."
    const head = compactBody(text).split("\n\n⋯ 중략")[0]
    expect(head.slice(-20)).toMatch(/제출하였다\.$/)
  })

  it("꼬리는 '한다. ' 경계 뒤 문장 첫 글자에서 시작한다", () => {
    // 종전: 경계 길이와 무관하게 +2 라 꼬리가 ". 그런데…" 로 시작했다
    const text = "가".repeat(1500) + "한다. 그런데 원고는 " + "나".repeat(380)
    const tail = compactBody(text).split("(full=true로 전문 조회) ⋯\n\n")[1]
    expect(tail.slice(0, 20)).toMatch(/^그런데 원고는/)
  })
})

describe("densifyPrecedentRefs: 번호 표식 [10] 이상을 지우지 않는다 (리뷰 C10)", () => {
  it("[10] 은 [1] 처럼 남고 [공보 생략] 류 부가표기는 여전히 지운다", () => {
    expect(densifyPrecedentRefs("[1] 대법원 2020. 3. 26. 선고 2018두56077 판결 / [10] 대법원 2017. 5. 5. 선고 2016다2 판결 [공보 생략]"))
      .toBe("[1] 대법원 2020.3.26. 2018두56077 / [10] 대법원 2017.5.5. 2016다2")
  })

  // 리뷰 전 구현으로 뽑은 기준값 (2026-09-23)
  it("정상 입력은 종전과 같다", () => {
    expect(densifyPrecedentRefs("[1] 대법원 2020. 3. 26. 선고 2018두56077 판결 / [2] 대법원 2019. 1. 1. 선고 2018다1 판결 [공보 생략]"))
      .toBe("[1] 대법원 2020.3.26. 2018두56077 / [2] 대법원 2019.1.1. 2018다1")
    expect(densifyPrecedentRefs("[2] 대법원 1996. 4. 9. 선고 95누11405 판결(공1996상, 1395) [동지]"))
      .toBe("[2] 대법원 1996.4.9. 95누11405 판결(공1996상, 1395)")
  })
})
