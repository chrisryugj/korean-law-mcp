import { describe, it, expect } from "vitest"
import { parseAdminRuleArticles } from "./admin-rule-articles.js"
import { buildPartialBody } from "./admin-rule-views.js"

// 금융투자업규정 실측 축약 (2026-10-01 감사, 일련번호 2100000285020): 편마다 장 번호가 1부터 다시 시작하고,
// 하이픈 앞자리는 장이 아니라 편 번호다. 편 바로 아래 조문(제1편·제4편의2), 장의2·편의2 헤더가 섞여 있다.
const FIN_BODY = [
  "제1편 총칙",
  "제1-1조(목적) 이 규정은 「자본시장과 금융투자업에 관한 법률」(이하 \"법\"이라 한다)…",
  "제2편 금융투자업",
  "제1장 인가ㆍ등록",
  "제2-1조(인가요건)",
  " ① 영 제16조제1항제8호에서 \"금융위원회가 정하여 고시하는 금융기관\"이란 …",
  "제2장 승인ㆍ보고",
  "제2-12조(합병등 승인)",
  " ① 영 제370조제2항제6호에 따라 금융투자업자가 …",
  "제3장 금융투자업자의 지배구조",
  "제2-17조",
  "제2-18조",
  "제3편 건전경영 유지",
  "제1장 회계처리",
  "제3-1조(회계처리기준) 금융투자업자의 회계처리에 관하여 …",
  "  [전문개정 2010. 12. 29.]",
  "제2장 재무건전성",
  "제1절 통칙",
  "제3-6조(용어의 정의) 이 규정에서 사용하는 용어의 정의는 다음 각 호와 같다.<개정 2016. 4. 14.>",
  "  1. \"순자본\"이란 영업용순자본에서 총위험액을 차감한 금액을 말한다.<신설 2014. 11. 4.>",
  "제4편 영업행위 규칙",
  "제1장 공통영업행위 규칙",
  "제1절 금융투자업자의 업무일반",
  "제4-1조(겸영업무)",
  " ① 영 제43조제3항제10호에서 \"금융위원회가 정하여 고시하는 금융업무\"란 …",
  "제3장 집합투자업자의 영업행위 규칙",
  "제1절 집합투자재산의 운용",
  "제4-49조(집합투자업자 명의의 자산 취득 등) 영 제79조제2항제8호에 따라 …",
  "제4-50조(부동산 관련 자산 등)",
  " ① 영 제80조제1항제1호마목에서 \"금융위원회가 정하여 고시하는 부동산 관련 자산\"이란 …",
  "제4편의2 온라인소액투자중개업자 [본편 신설 2016. 1. 19.]",
  "제4-104조(등록요건)",
  " ① 영 제118조의4제2항에 따른 사업계획, …",
  "제5편 장외거래",
  "제1장 총칙",
  "제5-1조(용어의 정의) 이 편에서 사용하는 용어의 정의는 다음 각 호와 같다.",
  "제2장 비상장 지분증권 등의 장외거래 <개정 2019. 11. 21., 2025. 9. 23.>",
  "제5-2조(호가중개시스템의 공시사항 및 공시방법 등)",
  "제11장 장외파생상품의 거래",
  "제5-49조(장외파생상품의 매매기준)",
  "  5. 그 밖에 금융위원회에 특정한 거래정보의 제공을 요청하여 승인을 받은 자",
  "제11장의2 장외거래의 청산의무 [본장신설 2013. 7. 9.]",
  "제5-50조의5(장외거래의 청산의무)",
  "제12장 공공적법인 발행주식의 취득승인",
  "제5-51조(주식의 대량취득의 승인신청) 법 제167조제1항의 기준을 초과하여 …",
].join("\n")

// 외국환거래규정 실측 축약 (일련번호 2100000285140): 절 헤더가 조문 사이에 낀다
const FX_SECTIONS = [
  "제2장 외국환업무취급기관 등",
  "제1절 외국환은행",
  "제2-11조의2(외환건전성부담금의 부과)",
  "  ⑤ 제2항 및 제4항은 2024년부터 2026년 사업연도까지의 외환건전성부담금을 부과하는 경우에 한정하여 적용한다.",
  "제2절 기타 외국환업무취급기관",
  "제2-12조(기타 외국환업무취급기관의 외국환업무)",
  "  ② <삭 제><기획재정부고시 제2016-6호, 2016. 3. 22. 개정>",
  "제5장 지급등의 방법",
  "제2절 상계등 계정의 대기 또는 차기에 의한 지급등의 방법",
  "제1관 상계",
  "제5-4조(상계)",
].join("\n")

const byKey = (body: string, key: string) => parseAdminRuleArticles(body).articles.find(a => a.key === key)!

describe("parseAdminRuleArticles — 절·관·편 헤더 위치", () => {
  it("절 헤더는 앞 조문 끝이 아니라 다음 조문 앞에 붙는다", () => {
    expect(byKey(FX_SECTIONS, "2-11의2").lines.at(-1)).toContain("2026년 사업연도까지")
    expect(byKey(FX_SECTIONS, "2-12").lines[0]).toBe("제2절 기타 외국환업무취급기관")
    expect(byKey(FX_SECTIONS, "5-4").lines.slice(0, 2)).toEqual(["제2절 상계등 계정의 대기 또는 차기에 의한 지급등의 방법", "제1관 상계"])
  })

  it("맨 앞 절 헤더는 서문이 아니라 첫 조문에, 맨 앞 편 헤더는 편 목록에 담긴다", () => {
    const p = parseAdminRuleArticles("제1장 총칙\n제1절 통칙\n제1-1조(목적) 가.")
    expect(p.preamble).toEqual([])
    expect(p.articles[0].lines[0]).toBe("제1절 통칙")
    const q = parseAdminRuleArticles(FIN_BODY)
    expect(q.preamble).toEqual([])
    expect(q.parts[0]).toEqual({ key: "1", title: "제1편 총칙" })
  })

  it("장의N 헤더를 인식해 그 장의 조문을 앞 장에 넣지 않는다", () => {
    expect(byKey(FIN_BODY, "5-49").lines.join("\n")).not.toContain("제11장의2")
    expect(byKey(FIN_BODY, "5-50의5").chapter).toBe("11의2")
    expect(byKey(FIN_BODY, "5-49").chapter).toBe("11")
  })

  it("조문은 (편, 장)에 귀속되고, 장 없는 편의 조문은 앞 편의 장을 물려받지 않는다", () => {
    expect([byKey(FIN_BODY, "2-17"), byKey(FIN_BODY, "4-50")].map(a => [a.part, a.chapter])).toEqual([["2", "3"], ["4", "3"]])
    expect([byKey(FIN_BODY, "1-1"), byKey(FIN_BODY, "4-104")].map(a => [a.part, a.chapter])).toEqual([["1", ""], ["4의2", ""]])
  })

  it("빈 줄 아닌 줄은 하나도 빠지거나 겹치지 않는다", () => {
    for (const body of [FIN_BODY, FX_SECTIONS]) {
      const p = parseAdminRuleArticles(body)
      const kept = [...p.preamble, ...p.parts.map(x => x.title), ...p.chapters.map(c => c.title), ...p.articles.flatMap(a => a.lines)]
      expect(kept.filter(l => l.trim()).sort()).toEqual(body.split("\n").filter(l => l.trim()).sort())
    }
  })

  it("조문이 하나도 없으면 절 헤더도 서문에 남는다 (유실 금지)", () => {
    expect(parseAdminRuleArticles("제1절 일반\n가. 성실히 수행한다.").preamble).toEqual(["제1절 일반", "가. 성실히 수행한다."])
  })
})

describe("buildPartialBody — 편이 있는 규칙의 장 (편마다 장 번호가 다시 시작)", () => {
  it("jo 결과의 장 제목은 그 조문이 속한 편의 장이다", () => {
    const { text } = buildPartialBody(FIN_BODY, FIN_BODY, { jo: "제4-50조" })
    expect(text.startsWith("제4편 영업행위 규칙\n제3장 집합투자업자의 영업행위 규칙\n\n")).toBe(true)
    expect(text).not.toContain("금융투자업자의 지배구조")
  })

  it("같은 번호 장이 여러 편에 있으면 섞지 않고 편 지정 후보를 돌려준다", () => {
    const { text } = buildPartialBody(FIN_BODY, FIN_BODY, { chapter: "제2장" })
    expect(text).toContain('chapter:"제2편 제2장"')
    expect(text).toContain('chapter:"제3편 제2장"')
    expect(text).toContain('chapter:"제5편 제2장"')
    expect(text).not.toContain("[NOT_FOUND]")
    expect(text).not.toContain("영 제370조제2항제6호") // 조문 본문은 싣지 않는다
  })

  it("chapter:'제4편 제3장' 은 그 편의 장만", () => {
    const { text } = buildPartialBody(FIN_BODY, FIN_BODY, { chapter: "제4편 제3장" })
    expect(text).toContain("제4편 영업행위 규칙 > 제3장 집합투자업자의 영업행위 규칙  (조문 2개)")
    expect(text).toContain("제4-50조(부동산 관련 자산 등)")
    expect(text).not.toContain("제2-17조")
  })

  it("한 편에만 있는 장의N 과 장 없는 편도 조회된다", () => {
    expect(buildPartialBody(FIN_BODY, FIN_BODY, { chapter: "제11장의2" }).text).toContain("제5-50조의5(장외거래의 청산의무)")
    const whole = buildPartialBody(FIN_BODY, FIN_BODY, { chapter: "제4편의2" }).text
    expect(whole).toContain("제4-104조(등록요건)")
    expect(whole).not.toContain("제4-50조")
  })

  it("편 없는 규칙의 장 조회는 종전과 같다", () => {
    const { text } = buildPartialBody(FX_SECTIONS, FX_SECTIONS, { chapter: "제5장" })
    expect(text.startsWith("제5장 지급등의 방법  (조문 1개)")).toBe(true)
  })
})
