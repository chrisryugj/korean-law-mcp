/**
 * penalty·delegation 시나리오 회귀 (2026-09-23 리뷰 B#9)
 *
 * penalty: get_law_text 에 없는 search:"벌칙" 인자가 조용히 버려져 "벌칙·과태료 조항"이 법령 전체
 *   목차였고, "벌칙 조항 개정이력"은 법령 전체 조문의 1948년 이후 이력이었으며, 실패 갈래는 흔적 없이 빠졌다.
 * delegation: 필터를 지원하지 않는 위임 연계 목록(lnkDep)을 불러 헤드라인 섹션이 한 번도 실리지 못했다.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { runPenaltyScenario, extractPenaltyArticles } from "./penalty.js"
import { runDelegationScenario } from "./delegation.js"
import { lawCache } from "../../lib/cache.js"
import type { LawApiClient } from "../../lib/api-client.js"

const LAW_JSON = JSON.stringify({
  법령: {
    조문: {
      조문단위: [
        { 조문여부: "전문", 조문번호: "1", 조문내용: "      제1장 총칙" },
        { 조문여부: "조문", 조문번호: "1", 조문가지번호: "0", 조문제목: "목적", 조문내용: "제1조(목적) 이 법은 도로교통의 안전을 목적으로 한다." },
        { 조문여부: "조문", 조문번호: "44", 조문가지번호: "0", 조문제목: "술에 취한 상태에서의 운전 금지", 조문내용: "제44조(술에 취한 상태에서의 운전 금지) 누구든지…" },
        { 조문여부: "전문", 조문번호: "148", 조문내용: "      제12장 벌칙 <개정 2011.6.8.>" },
        { 조문여부: "조문", 조문번호: "148", 조문가지번호: "0", 조문제목: "벌칙", 조문내용: "제148조(벌칙) 5년 이하의 징역…" },
        { 조문여부: "조문", 조문번호: "148", 조문가지번호: "2", 조문제목: "벌칙", 조문내용: "제148조의2(벌칙) 음주운전…" },
        { 조문여부: "조문", 조문번호: "159", 조문가지번호: "0", 조문제목: "양벌규정", 조문내용: "제159조(양벌규정) 법인의 대표자…" },
        { 조문여부: "조문", 조문번호: "160", 조문가지번호: "0", 조문제목: "과태료", 조문내용: "제160조(과태료) 20만원 이하의 과태료…" },
      ],
    },
  },
})

function penaltyClient() {
  const calls: string[] = []
  const client = {
    calls,
    async getLawText() { calls.push("getLawText"); return LAW_JSON },
    async getAnnexes() { calls.push("getAnnexes"); throw new Error("법제처 서버 오류 (500) - getAnnexes") },
    async getArticleHistory() { calls.push("getArticleHistory"); return "" },
    async fetchApi({ target }: { target?: string }) {
      calls.push(`fetchApi:${target}`)
      if (target === "admbyl") throw new Error("법제처 서버 오류 (500) - admbyl")
      return `<?xml version="1.0" encoding="UTF-8"?><Empty><totalCnt>0</totalCnt></Empty>`
    },
  }
  return client as unknown as LawApiClient & { calls: string[] }
}

const LAW = { lawName: "도로교통법", lawId: "001638", mst: "281875", lawType: "법률" }

describe("penalty: 벌칙 장만 싣고, 목차·전체 이력을 벌칙으로 둔갑시키지 않는다 (B#9)", () => {
  beforeEach(() => lawCache.clear())

  it("'벌칙·과태료 조항'은 벌칙 장의 조문(양벌·과태료 포함)이고 목차가 아니다", async () => {
    const c = penaltyClient()
    const r = await runPenaltyScenario({ apiClient: c, query: "도로교통법 과태료", law: LAW })
    const penalty = r.sections.find(s => s.title === "벌칙·과태료 조항")
    expect(penalty?.content).toContain("제148조의2 벌칙")
    expect(penalty?.content).toContain("제159조 양벌규정")
    expect(penalty?.content).toContain("제160조 과태료")
    expect(penalty?.content).not.toContain("목차")
    expect(penalty?.content).not.toContain("제1조")
    expect(c.calls.filter(x => x === "getLawText")).toHaveLength(1)
  })

  it("'벌칙 조항 개정이력'은 받지 않고(#158) 벌칙 조문별 조회 경로를 남긴다", async () => {
    const c = penaltyClient()
    const r = await runPenaltyScenario({ apiClient: c, query: "도로교통법 과태료", law: LAW })
    expect(c.calls).not.toContain("getArticleHistory")
    const hist = r.sections.find(s => s.title === "벌칙 조항 개정이력")
    expect(hist?.content).toContain(`get_article_history(lawId="001638", jo="제148조")`)
    expect(hist?.content).toContain("제148조·제148조의2·제159조·제160조")
  })

  it("별표 조회 실패는 조용히 빠지지 않고 실패 섹션으로 남는다", async () => {
    const r = await runPenaltyScenario({ apiClient: penaltyClient(), query: "도로교통법 과태료", law: LAW })
    const annex = r.sections.find(s => s.title === "별표 (행정처분/과태료 기준표)")
    expect(annex?.isError).toBe(true)
  })

  it("장 구조가 없는 법령은 조문 제목으로 고른다", () => {
    const json = { 법령: { 조문: { 조문단위: [
      { 조문여부: "조문", 조문번호: "1", 조문제목: "목적", 조문내용: "제1조(목적) …" },
      { 조문여부: "조문", 조문번호: "30", 조문제목: "과태료", 조문내용: "제30조(과태료) …" },
    ] } } }
    const { text, labels } = extractPenaltyArticles(json)
    expect(labels).toEqual(["제30조"])
    expect(text).not.toContain("제1조")
  })
})

describe("delegation: 필터 없는 위임 연계 목록을 부르지 않고, 못 주는 것을 밝힌다 (B#9)", () => {
  it("lnkDep 을 호출하지 않고 '자동 대조 미제공' 안내를 싣는다", async () => {
    const c = penaltyClient()
    const r = await runDelegationScenario({ apiClient: c, query: "관세법 위임입법", law: LAW })
    expect(c.calls).not.toContain("fetchApi:lnkDep")
    const status = r.sections.find(s => s.title === "위임입법 현황 (미제정 포함)")
    expect(status?.content).toContain("자동 대조 미제공")
    expect(status?.content).toContain("단정하지 마세요")
  })
})
