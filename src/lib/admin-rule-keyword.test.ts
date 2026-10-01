import { describe, it, expect } from "vitest"
import { parseAdminRuleArticles } from "./admin-rule-articles.js"
import { keywordView } from "./admin-rule-keyword.js"

// 외국환거래규정 제1-2조(용어의 정의) 실측 형상: 9,880자 한 조문, 매칭 줄이 2,500자 뒤에 있다
const DEFINITIONS = [
  "제1장 총칙",
  "제1-2조(용어의 정의) 이 규정에서 사용하는 용어의 정의는 다음과 같다.",
  ...Array.from({ length: 40 }, (_, i) => `  ${i + 1}. "용어${i + 1}"이라 함은 ${"외국환 거래에 관한 사항".repeat(8)}을 말한다.`),
  "  41. \"대외지급수단\"이란 외국환은행이 발급한 현금인출기능이 포함된 카드를 말한다. <기획재정부고시 제2020-21호, 2020. 9. 30. 개정>",
  ...Array.from({ length: 20 }, (_, i) => `  ${i + 42}. "용어${i + 42}"이라 함은 ${"지급 및 수령에 관한 사항".repeat(8)}을 말한다.`),
  "제1-3조(적용범위) 이 규정은 …",
].join("\n")

// 외국환거래규정 실측 축약: "경과조치"는 부칙에만, "외국환전문요원"은 별지 서식(별표)에만 있다 (2026-10-01 감사)
const RULE = [
  "제1장 총칙",
  "제1-1조(목적) 이 규정은 「외국환거래법」과 동법시행령에서 위임된 사항과 그 시행에 관하여 필요한 사항을 정함을 목적으로 한다.",
  "제1-2조(용어의 정의) 이 규정에서 사용하는 용어의 정의는 다음과 같다.",
].join("\n")
const ADDENDUM = {
  label: "부칙 <제2002-12호,2002. 7. 2.>",
  text: "부칙 <제2002-12호,2002. 7. 2.>\n제1조(시행일) 이 고시는 2002년 7월 2일부터 시행한다.\n제2조(경과조치) ①제1-2조제6호는 2002년 7월 31일까지 종전 규정을 적용한다.",
}
const ANNEX = {
  label: "[외국환업무등록신청서]",
  text: "[외국환업무등록신청서]\n■ 외국환거래규정 [별지 제2-1호 서식]\n┃⑧인 력 현 황       │임  원    │직  원    │외국환전문요원           명           ┃",
}

describe("keywordView — 조문에 없으면 부칙·별표까지", () => {
  const parsed = parseAdminRuleArticles(RULE)

  it("부칙·별표에만 있는 말은 NOT_FOUND 가 아니라 그 블록을 보여 준다", () => {
    const a = keywordView(parsed, "경과조치", 10, RULE, [ADDENDUM, ANNEX])
    expect(a.startsWith("[NOT_FOUND]")).toBe(false)
    expect(a).toContain("부칙 <제2002-12호,2002. 7. 2.>")
    expect(a).toContain("제2조(경과조치) ①제1-2조제6호는")
    const b = keywordView(parsed, "외국환전문요원", 10, RULE, [ADDENDUM, ANNEX])
    expect(b).toContain("[외국환업무등록신청서]")
    expect(b).not.toContain("경과조치")
  })

  it("어디에도 없을 때만 NOT_FOUND 이고, 부칙·별표까지 찾았다고 밝힌다", () => {
    const text = keywordView(parsed, "없는낱말", 10, RULE, [ADDENDUM, ANNEX])
    expect(text.startsWith("[NOT_FOUND]")).toBe(true)
    expect(text).toContain("부칙·별표")
  })

  it("조문에 있으면 조문을 싣고, 부칙·별표에도 있다고 알린다", () => {
    const text = keywordView(parsed, "시행", 10, RULE, [ADDENDUM, ANNEX])
    expect(text).toContain("제1-1조(목적)")
    expect(text).toContain("부칙·별표에도 1곳: 부칙 <제2002-12호,2002. 7. 2.>")
  })

  it("조문 체계 없는 규칙(절 단위)도 부칙·별표로 이어 찾는다", () => {
    const nftc = "2.1 일반\n  설치 기준은 다음과 같이 한다."
    const text = keywordView(parseAdminRuleArticles(nftc), "외국환전문요원", 10, nftc, [ANNEX])
    expect(text.startsWith("[NOT_FOUND]")).toBe(false)
    expect(text).toContain("[외국환업무등록신청서]")
  })
})

describe("keywordView — 긴 조문의 발췌 창", () => {
  it("매칭 줄이 앞 2,500자 밖이어도 발췌에 들어간다 (조문 제목 줄은 유지)", () => {
    const text = keywordView(parseAdminRuleArticles(DEFINITIONS), "현금인출기능이", 10)
    const body = text.slice(text.indexOf("\n\n") + 2)
    expect(body).toContain("현금인출기능이 포함된 카드")
    expect(body.startsWith("제1-2조(용어의 정의)")).toBe(true)
    expect(body).toContain('jo:"제1-2조"로 전체 조회')
    expect(body.length).toBeLessThan(2900)
  })

  it("조문 체계 없는 본문(절 단위)도 매칭 부분을 발췌한다", () => {
    const nftc = ["2.1 일반", ...Array.from({ length: 60 }, () => "  설치 기준은 다음과 같이 한다. ".repeat(3)), "  수평거리는 2.1 m 이하로 한다."].join("\n")
    const text = keywordView(parseAdminRuleArticles(nftc), "수평거리", 10, nftc)
    expect(text).toContain("수평거리는 2.1 m 이하")
    expect(text).toContain("2.1 일반")
  })
})
