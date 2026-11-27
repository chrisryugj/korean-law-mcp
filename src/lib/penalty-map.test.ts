import { describe, it, expect } from "vitest"
import { parseArticleNo, articleRefs, filterPenaltyBody, dutyIndex, annexRowsFor } from "./penalty-map.js"

// 근로기준법 제116조(과태료) 본문 발췌 (2026-11-28 실응답, formatArticleUnit 출력 꼴)
const ART116 = [
  "① 다음 각 호의 어느 하나에 해당하는 경우에는 1천만원 이하의 과태료를 부과한다.",
  "1. 사용자(사용자의 「민법」 제767조에 따른 친족 중 대통령령으로 정하는 사람이 해당 사업 또는 사업장의 근로자인 경우를 포함한다)가 제76조의2를 위반하여 직장 내 괴롭힘을 한 경우",
  "② 다음 각 호의 어느 하나에 해당하는 자에게는 500만원 이하의 과태료를 부과한다.",
  "1. 제13조에 따른 고용노동부장관, 노동위원회 또는 노동감독관의 요구가 있는 경우에 보고 또는 출석을 하지 아니하거나 거짓된 보고를 한 자",
  "2. 제14조, 제39조, 제41조, 제42조, 제44조의4제1항ㆍ제4항ㆍ제5항, 제48조, 제66조 및 제99조를 위반한 자",
].join("\n")
const ART110 = "다음 각 호의 어느 하나에 해당하는 자는 2년 이하의 징역 또는 2천만원 이하의 벌금에 처한다.\n\n1. 제10조, 제74조제1항부터 제5항까지, 제78조부터 제80조까지 및 제104조을 위반한 자"

describe("의무 조문 → 벌칙 조문", () => {
  it("조 번호 입력을 같은 꼴로 읽는다", () => {
    expect(parseArticleNo("48")).toBe("48")
    expect(parseArticleNo("제48조")).toBe("48")
    expect(parseArticleNo("제 44 조의 2")).toBe("44의2")
    expect(parseArticleNo("004402")).toBe("44의2")
    expect(parseArticleNo("004800")).toBe("48")
    expect(parseArticleNo("마흔여덟")).toBeUndefined()
  })

  it("이 법의 조 번호만 모은다: 「다른 법」 조는 빼고, 범위는 펼친다(범위 사이 괄호 포함)", () => {
    const r = articleRefs(ART116.split("\n")[1])
    expect(r.has("76의2")).toBe(true)
    expect(r.has("767")).toBe(false)
    expect([...articleRefs("제78조부터 제80조까지")].sort()).toEqual(["78", "79", "80"])
    expect(articleRefs("법 제32조(제6호는 제외한다)부터 제34조까지의 규정을 위반하여").has("33")).toBe(true)
    expect(articleRefs("제44조의4제1항").has("44")).toBe(false)
  })

  it("duty 를 지목한 호와 그 항 머리만 남긴다", () => {
    expect(filterPenaltyBody(ART116, "48")).toBe([ART116.split("\n")[2], ART116.split("\n")[4]].join("\n"))
    expect(filterPenaltyBody(ART116, "76의2")).toBe([ART116.split("\n")[0], ART116.split("\n")[1]].join("\n"))
    expect(filterPenaltyBody(ART116, "200")).toBeUndefined()
    // 항이 없는 조는 첫 문장이 머리
    expect(filterPenaltyBody(ART110, "79")).toContain("2년 이하의 징역")
  })

  it("\"…를 위반한\" 줄에서 의무 조문 → 벌칙 위치를 뽑는다(위반 없는 언급은 빼고)", () => {
    const idx = dutyIndex("제116조", ART116)
    expect(idx.get("48")).toEqual(["제116조제2항제2호"])
    expect(idx.get("76의2")).toEqual(["제116조제1항제1호"])
    expect(idx.has("13")).toBe(false)
  })
})

// 근로기준법 시행령 별표 7(HTML 표, 둘째 머리 행이 td)과 도로교통법 시행령 별표 6(GFM 표) 발췌
const HTML_ANNEX = `<table>
<tr><th rowspan="2">위반행위</th><th rowspan="2">근거 법조문</th><th colspan="3">과태료 금액(단위: 만원)</th></tr>
<tr><td>1차<br>위반</td><td>2차<br>위반</td><td>3차 이상<br>위반</td></tr>
<tr><td>바. 법 제48조제1항에 따른 임금대장 작성의무를 위반한 경우</td><td>법 제116조<br>제2항제2호</td><td>30</td><td>50</td><td>100</td></tr>
<tr><td>사. 법 제48조제2항에 따른 임금명세서 교부의무를 위반한 경우</td><td>법 제116조<br>제2항제2호</td><td></td><td></td><td></td></tr>
<tr><td>1) 임금명세서를 교부하지 않은 경우</td><td></td><td>30</td><td>50</td><td>100</td></tr>
<tr><td>아. 법 제51조의2제5항에 따른 임금보전방안을 신고하지 않은 경우</td><td>법 제116조<br>제2항제3호</td><td>80</td><td>150</td><td>300</td></tr>
</table>`
const PIPE_ANNEX = `| 위반행위 및 행위자 | 근거 법조문<br>(도로교통법) | 과태료 금액 |
| --- | --- | --- |
| 5. 법 제29조제4항을 위반하여 진로를 양보하지 않은 차의 고용주등 | 제160조제3항 | 1) 승합자동차등: 8만원 |
| 6. 법 제32조(제6호는 제외한다)부터 제34조까지의 규정을 위반하여 정차 또는 주차를 한 차의 고용주등 | 제160조제3항 | 1) 승합자동차등: 5만원(6만원) |
| 6의2. 법 제32조제6호를 위반하여 정차 또는 주차를 한 차의 고용주등 | 제160조제3항 |  |
| 가. 안전표지가 설치된 곳에 정차 또는 주차를 한 경우 |  | 1) 승합자동차등: 9만원(10만원) |`

describe("부과기준 별표 행", () => {
  it("HTML 표: 열 이름을 이어 붙이고, 묶음 머리(사.)와 딸린 행(1))을 함께 낸다", () => {
    const t = annexRowsFor(HTML_ANNEX, "48")!
    expect(t.split("\n")[0]).toBe("| 위반행위 | 근거 법조문 | 과태료 금액(단위: 만원) 1차 위반 | 과태료 금액(단위: 만원) 2차 위반 | 과태료 금액(단위: 만원) 3차 이상 위반 |")
    expect(t).toContain("| 1) 임금명세서를 교부하지 않은 경우 |  | 30 | 50 | 100 |")
    expect(t).not.toContain("임금보전방안")
  })

  it("GFM 표: 숫자 묶음 머리(6의2.)와 그 아래 가. 행, 범위 안 조(제33조)도 찾는다", () => {
    const t33 = annexRowsFor(PIPE_ANNEX, "33")!
    expect(t33).toContain("6. 법 제32조(제6호는 제외한다)부터 제34조까지")
    expect(t33).not.toContain("6의2.")
    const t32 = annexRowsFor(PIPE_ANNEX, "32")!
    expect(t32).toContain("6의2. 법 제32조제6호")
    expect(t32).toContain("가. 안전표지가 설치된 곳")
    expect(t32).not.toContain("제29조")
    expect(annexRowsFor(PIPE_ANNEX, "99")).toBeUndefined()
  })
})
