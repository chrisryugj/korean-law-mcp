import { beforeEach, describe, expect, it } from "vitest"
import { getThreeTier } from "./three-tier.js"
import { lawCache } from "../lib/cache.js"
import type { LawApiClient } from "../lib/api-client.js"
import fixture from "./fixtures/three-tier-citation.json"

// lawService.do target=thdCmp ID=001556 knd=1 실응답 발췌 (2026-10-02).
// 인용조문은 ThdCmpLawXService + 시행령조문목록 봉투로 온다.
describe("get_three_tier: advertised citation mode", () => {
  beforeEach(() => lawCache.clear())
  it("knd=1 봉투를 파싱하고 장·절 헤더를 조문으로 세지 않는다", async () => {
    const client = { getThreeTier: async () => JSON.stringify(fixture) } as unknown as LawApiClient
    const r = await getThreeTier(client, { lawId: "001556", knd: "1" })
    expect(r.isError).toBeFalsy()
    const t = r.content[0].text
    expect(t).toContain("법령명: 관세법")
    expect(t).toContain("국민경제의 발전")
    expect(t).toContain("[시행령] 관세법 시행령 제1조의2")
    expect(t).toContain("[행정규칙] 체납정리 사무처리에 관한 훈령")
    expect(t).not.toContain("제1장 총칙")
    expect(t).not.toContain("제1절 통칙")
    expect(t.match(/^제1조 /gm)).toHaveLength(1)
  })
  it("단일 객체 조문과 하위 시행규칙 목록도 유지한다", async () => {
    const client = { getThreeTier: async () => JSON.stringify({ ThdCmpLawXService: {
      기본정보: { 법령명: "검토법", 시행규칙명: "검토법 시행규칙" },
      인용조문삼단비교: { 법률조문: { 조번호: "0010", 조가지번호: "02", 조제목: "제10조의2(대상)", 조내용: "본법 기준",
        시행규칙조문목록: { 시행규칙조문: { 조번호: "0003", 조제목: "제3조(신청)", 조내용: "신청 요건" } } } },
    } }) } as unknown as LawApiClient
    const r = await getThreeTier(client, { mst: "single-citation-review", knd: "1" })
    expect(r.isError).toBeFalsy()
    expect(r.content[0].text).toContain("제10조의2")
    expect(r.content[0].text).toContain("본법 기준")
    expect(r.content[0].text).toContain("[시행규칙] 검토법 시행규칙 제3조")
    expect(r.content[0].text).toContain("신청 요건")
  })
})
