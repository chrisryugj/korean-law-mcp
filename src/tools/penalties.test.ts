import { describe, it, expect, vi, beforeEach } from "vitest"
import type { LawApiClient } from "../lib/api-client.js"
import { lawCache } from "../lib/cache.js"

// 별표 조회는 흉내 — 목록(별표 둘)이 오면 별표번호로 하나씩 받는 경로까지 본다
const annexCalls: Array<Record<string, unknown>> = []
vi.mock("./annex.js", () => ({
  getAnnexes: vi.fn(async (_c: unknown, input: Record<string, unknown>) => {
    annexCalls.push(input)
    if (input.query === "과태료") return { content: [{ type: "text", text: "법령명: 근로기준법 시행령\n별표/서식 목록 (총 2건)\n\n1. [000700] 과태료의 부과기준(제60조 관련) (별표)\n2. [000100] 상시 4명 이하의 근로자를 사용하는 사업 또는 사업장에 적용하는 법 규정(제7조 관련) (별표)\n" }] }
    if (input.bylSeq === "000700") return { content: [{ type: "text", text: "근로기준법 시행령 - 과태료의 부과기준(제60조 관련)\n<table>\n<tr><th>위반행위</th><th>근거 법조문</th><th>1차</th></tr>\n<tr><td>사. 법 제48조제2항에 따른 임금명세서 교부의무를 위반한 경우</td><td>법 제116조</td><td></td></tr>\n<tr><td>1) 임금명세서를 교부하지 않은 경우</td><td></td><td>30</td></tr>\n</table>" }] }
    if (input.bylSeq === "000100") return { content: [{ type: "text", text: "근로기준법 시행령 - 상시 4명 이하의 근로자를 사용하는 사업 또는 사업장에 적용하는 법 규정(제7조 관련)\n<table><tr><th>구분</th></tr><tr><td>제48조</td></tr></table>" }] }
    return { content: [{ type: "text", text: "[NOT_FOUND]" }], isError: true }
  }),
}))

const { getPenalties } = await import("./penalties.js")

const LAW_JSON = {
  법령: {
    기본정보: { 법령명_한글: "근로기준법", 법령ID: "001872", 시행일자: "20261008" },
    조문: { 조문단위: [
      { 조문여부: "조문", 조문번호: "48", 조문제목: "임금대장 및 임금명세서", 조문내용: "제48조(임금대장 및 임금명세서) ① 사용자는 …" },
      { 조문여부: "전문", 조문번호: "107", 조문내용: "제12장 벌칙" },
      { 조문여부: "조문", 조문번호: "115", 조문제목: "양벌규정", 조문내용: "제115조(양벌규정) 사업주의 대리인…" },
      { 조문여부: "조문", 조문번호: "116", 조문제목: "과태료", 조문내용: "제116조(과태료)", 항: [
        { 항번호: "②", 항내용: "② 다음 각 호의 어느 하나에 해당하는 자에게는 500만원 이하의 과태료를 부과한다.", 호: [
          { 호번호: "1.", 호내용: "1. 제13조에 따른 요구가 있는 경우에 보고를 하지 아니한 자" },
          { 호번호: "2.", 호내용: "2. 제14조, 제48조 및 제99조를 위반한 자" },
        ] },
      ] },
    ] },
  },
}

function client() {
  return {
    searchLaw: vi.fn(async () => `<LawSearch><totalCnt>1</totalCnt><law id="1"><법령일련번호>285279</법령일련번호><법령명한글><![CDATA[근로기준법]]></법령명한글><법령ID>001872</법령ID><법령구분명>법률</법령구분명></law></LawSearch>`),
    getLawText: vi.fn(async () => JSON.stringify(LAW_JSON)),
  } as unknown as LawApiClient & { getLawText: ReturnType<typeof vi.fn> }
}

beforeEach(() => { annexCalls.length = 0; lawCache.clear() })

describe("get_penalties", () => {
  it("duty 를 지목한 벌칙 항·호, 양벌규정, 시행령 부과기준 별표의 해당 행을 낸다", async () => {
    const c = client()
    const r = await getPenalties(c, { lawName: "근로기준법", duty: "제48조" })
    const t = r.content[0].text
    expect(r.isError).toBeUndefined()
    // 이름으로 찾으면 법령ID 로 현행 본문을 받는다(MST 는 시행예정 시점 본문일 수 있다)
    expect(c.getLawText.mock.calls[0][0]).toMatchObject({ lawId: "001872" })
    expect(t).toContain("의무 조문: 제48조")
    expect(t).toContain("② 다음 각 호의 어느 하나에 해당하는 자에게는 500만원 이하의 과태료를 부과한다.\n2. 제14조, 제48조 및 제99조를 위반한 자")
    expect(t).not.toContain("제13조에 따른 요구")
    expect(t).toContain("함께 적용될 수 있는 조: 제115조")
    expect(t).toContain("| 1) 임금명세서를 교부하지 않은 경우 |  | 30 |")
    // 부과기준이 아닌 별표(상시 4명 이하 사업장)는 싣지 않는다
    expect(t).not.toContain("상시 4명 이하")
    expect(annexCalls.some(a => a.bylSeq === "000700")).toBe(true)
  })

  it("duty 없이 부르면 의무 조문 → 벌칙 위치 목록을 낸다", async () => {
    const t = (await getPenalties(client(), { lawName: "근로기준법 시행령" })).content[0].text
    expect(t).toContain("- 제48조 → 제116조제2항제2호")
    expect(t).not.toContain("- 제13조 →")
  })

  it("duty 를 조 번호로 못 읽으면 오류", async () => {
    const r = await getPenalties(client(), { lawName: "근로기준법", duty: "임금명세서" })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain("[INVALID_PARAMETER]")
  })
})
