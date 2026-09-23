import { describe, it, expect } from "vitest"
import { parseHangNumber, extractHangContent, groupMokByReset, cleanHtml } from "./article-parser.js"

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

describe("extractHangContent — 항 레벨 목(目) (#75)", () => {
  // 법제처 JSON은 목을 호의 자식이 아니라 항 레벨 형제 배열로 준다. 파서가 `호.목`만
  // 읽어, 조특법 §24 공제율·§7 감면업종 48개·§29의8 계산식이 "잘린 흔적 없이" 사라졌다.
  // 응답이 자연스러워 보여 LLM이 빈 자리를 자체 지식으로 메우는 게 이 결함의 진짜 위험.
  const 항 = {
    항번호: "①",
    항내용: "다음 각 호에 따른다.",
    호: [{ 호번호: "1.", 호내용: "첫째 호" }, { 호번호: "2.", 호내용: "둘째 호" }],
    목: [
      { 목번호: "가.", 목내용: "1호-가목" },
      { 목번호: "나.", 목내용: "1호-나목" },
      { 목번호: "가.", 목내용: "2호-가목" },
    ],
  }

  it("항 레벨 목을 목번호 '가' 리셋 기준으로 각 호 뒤에 배치한다", () => {
    const out = extractHangContent([항])
    expect(out).toContain("1호-가목")
    expect(out).toContain("2호-가목")
    // 원문 순서: 1호 → 1호의 목들 → 2호 → 2호의 목
    expect(out.indexOf("1호-나목")).toBeLessThan(out.indexOf("둘째 호"))
    expect(out.indexOf("둘째 호")).toBeLessThan(out.indexOf("2호-가목"))
  })

  it("그룹 수와 호 수가 어긋나면 누락시키지 않고 안내와 함께 일괄 출력한다", () => {
    const out = extractHangContent([{ ...항, 호: [{ 호번호: "1.", 호내용: "유일한 호" }] }])
    expect(out).toContain("1호-가목")
    expect(out).toContain("2호-가목")
    expect(out).toContain("[참고]")
  })

  it("호 안에 목이 실려 오는 응답도 종전대로 처리한다", () => {
    const out = extractHangContent([
      { 항내용: "본문", 호: [{ 호내용: "호내용", 목: [{ 목번호: "가.", 목내용: "호내부 목" }] }] },
    ])
    expect(out).toContain("호내부 목")
  })

  it("목이 없으면 출력이 달라지지 않는다", () => {
    const out = extractHangContent([{ 항내용: "본문", 호: [{ 호내용: "호내용" }] }])
    expect(out).toBe("본문\n호내용")
  })
})

describe("groupMokByReset", () => {
  it("'가'에서 새 그룹을 연다", () => {
    const groups = groupMokByReset([
      { 목번호: "가." }, { 목번호: "나." }, { 목번호: "가." }, { 목번호: "나." }, { 목번호: "다." },
    ])
    expect(groups.map((g) => g.length)).toEqual([2, 3])
  })

  it("'가'로 시작하지 않아도 첫 그룹을 만든다", () => {
    expect(groupMokByReset([{ 목번호: "나." }, { 목번호: "다." }]).length).toBe(1)
  })
})

// 2026-09-23: `<[^>]+>` 로 태그를 지우면 조문 본문의 꺾쇠 표기(개정 시점)까지 사라졌다(민법 전문에서 149개)
describe("cleanHtml: 영문 태그만 지우고 꺾쇠 표기는 남긴다", () => {
  it("개정·신설 표기와 부칙 일자를 보존한다", () => {
    expect(cleanHtml("① 선량한 풍속 <개정 2012.8.1.><img src=x>")).toBe("① 선량한 풍속 <개정 2012.8.1.>")
    expect(cleanHtml("부칙 <제17907호,2021.1.26> <br/>제1조")).toBe("부칙 <제17907호,2021.1.26> 제1조")
  })

  it("HTML 태그·주석은 여전히 지운다", () => {
    expect(cleanHtml("<p>본문</p><!-- 주석 --><strong class=\"x\">강조</strong>")).toBe("본문강조")
  })
})
