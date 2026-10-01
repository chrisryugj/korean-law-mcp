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
