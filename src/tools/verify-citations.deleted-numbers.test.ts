/** verify_citations. 삭제된 조문·인용문 수량 대조 (법제처 law-mcp 대조에서 실측: 형법 제241조 ✓ 실존, 제250조 "3년 이상" 통과) */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { quantitiesOf, verifyCitations } from "./verify-citations.js"
import { lawCache } from "../lib/cache.js"
import type { LawApiClient } from "../lib/api-client.js"

const lawSearch = `<LawSearch><totalCnt>1</totalCnt><law><법령일련번호>200</법령일련번호><법령명한글>형법</법령명한글><법령ID>001692</법령ID></law></LawSearch>`
const units = [
  { 조문여부: "조문", 조문번호: "241", 조문내용: "제241조 삭제 <2016. 1. 6.>" },
  { 조문여부: "조문", 조문번호: "250", 조문제목: "살인, 존속살해", 조문내용: "제250조(살인, 존속살해)",
    항: [{ 항번호: "①", 항내용: "① 사람을 살해한 자는 사형, 무기 또는 5년 이상의 징역에 처한다." }, { 항번호: "②", 항내용: "② 자기 또는 배우자의 직계존속을 살해한 자는 사형, 무기 또는 7년 이상의 징역에 처한다." }] },
]
function client() {
  return {
    searchLaw: vi.fn(async () => lawSearch),
    getLawText: vi.fn(async ({ jo }: { jo: string }) => JSON.stringify({ 법령: { 조문: { 조문단위: units.filter(u => jo.startsWith(u.조문번호.padStart(4, "0"))) } } })),
    fetchApi: vi.fn(async () => "<PrecSearch><totalCnt>0</totalCnt></PrecSearch>"),
  }
}

describe("삭제 조문·수량 대조", () => {
  beforeEach(() => lawCache.clear())

  it("본문이 \"삭제 <날짜>\" 뿐인 조문은 실존이 아니라 삭제로 판정한다", async () => {
    const r = await verifyCitations(client() as unknown as LawApiClient, { text: "형법 제241조에 따라 처벌된다", maxCitations: 15 })
    expect(r.content[0].text).toContain("[DELETED] 삭제된 조문 (2016. 1. 6.)")
    expect(r.content[0].text).not.toMatch(/✓ 형법 제241조/)
  })

  it("인용문의 형량이 원문에 없으면 경고, 원문과 같으면 통과", async () => {
    const bad = await verifyCitations(client() as unknown as LawApiClient, { text: "형법 제250조는 살인죄를 3년 이상의 징역으로 처벌한다.", maxCitations: 15 })
    expect(bad.content[0].text).toContain("[NUMBER_MISMATCH] 인용문의 수량 '3년'")
    lawCache.clear()
    const ok = await verifyCitations(client() as unknown as LawApiClient, { text: "형법 제250조는 5년 이상의 징역에 처한다.", maxCitations: 15 })
    expect(ok.content[0].text).not.toContain("NUMBER_MISMATCH")
  })

  it("금액은 표기가 달라도 같은 값이면 같다", () => {
    expect(quantitiesOf("5천만원 이하의 벌금").map(q => q.key)).toEqual(quantitiesOf("5,000만 원 이하").map(q => q.key))
    expect(quantitiesOf("제3조 2년")).toEqual([{ raw: "2년", key: "2년" }])
  })
})
