/** 조례 조별 근거법 대조 (법제처 law-mcp check_ordinance_updates 조별_대조 대조: 광진구 주차장 조례 제15조③ → 주차장법 제12조제6항 삭제) */
import { describe, expect, it, vi } from "vitest"
import type { LawApiClient } from "./api-client.js"

const { extractOrdinanceCites, compareOrdinanceCites } = await import("./ordinance-cite-check.js")

const law = (art12h6: string, art19: string) => JSON.stringify({ 법령: { 조문: { 조문단위: [
  { 조문여부: "조문", 조문번호: "12", 조문내용: "제12조(노외주차장의 설치 등)", 항: [{ 항번호: "①", 항내용: "① 설치한다." }, { 항번호: "⑥", 항내용: art12h6 }] },
  { 조문여부: "조문", 조문번호: "19", 조문내용: art19 },
] } } })

describe("조례 조별 근거법 대조", () => {
  const articles = [
    { 조내용: "제1조(목적) 이 조례는 「주차장법」에서 위임한 사항을 정한다." },
    { 조내용: "제15조(사용료) ③ 법 제12조제6항에 따라 사용료를 감면한다. <개정 2019. 3. 7.>" },
    { 조내용: "제20조(부설주차장) 법 제19조에 따른 부설주차장. <개정 2019. 3. 7.>" },
  ]
  it("조마다 마지막 개정일을 기준일로, 법·「」·같은 법 인용을 근거법 조로 뽑는다", () => {
    const cites = extractOrdinanceCites(articles, "주차장법", "20200101")
    expect(cites.map(c => [c.ordArticle, c.lawName, c.jo, c.hang ?? 0, c.refDate])).toEqual([
      ["제15조", "주차장법", 12, 6, "20190307"],
      ["제20조", "주차장법", 19, 0, "20190307"],
    ])
  })
  it("항마다 개정 표시가 있으면 그 항 날짜, 맨 '시행규칙 제N조' 는 근거법 시행규칙", () => {
    const cites = extractOrdinanceCites([{ 조내용: "제15조(부대시설) ① 시행규칙 제6조제4항에 따른다. <개정 2023.3.2.> ③ 법 제12조제6항에 따른 지역은 10퍼센트 이내로 한다. <신설, 2014. 5. 14.>" }], "주차장법", "20260227")
    expect(cites.map(c => [c.lawName, c.jo, c.hang ?? 0, c.refDate])).toEqual([["주차장법 시행규칙", 6, 4, "20230302"], ["주차장법", 12, 6, "20140514"]])
  })
  it("오늘 판의 그 조·항 개정·삭제 표시가 조례 기준일보다 늦으면 바뀐 것", async () => {
    const getLawText = vi.fn(async () => law("⑥ 삭제 <2026.2.27>", "제19조(부설주차장의 설치) 설치하여야 한다. <개정 2018.1.1>"))
    const cites = extractOrdinanceCites(articles, "주차장법", "20200101")
    const r = await compareOrdinanceCites({ getLawText } as unknown as LawApiClient, cites, new Map([["주차장법", { lawId: "001234", mst: "300" }]]))
    expect(r.findings.map(f => [f.cite.ordArticle, f.kind, f.when])).toEqual([["제15조", "deleted", "20260227"]])
    expect(r.same).toBe(1)
    expect(getLawText).toHaveBeenCalledTimes(1)
})
})
