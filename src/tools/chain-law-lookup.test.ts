/**
 * 체인 기반 법령 탐색 회귀 테스트 (#105)
 *
 * 원문 전체를 법제처 AND 검색에 넣으면 "음주운전 과태료 기준 얼마" 같은 구어 질의가
 * 기반 법령을 못 찾고 체인 전체가 중단된다 (2026-08-16 실호출로 확인).
 */
import { describe, it, expect } from "vitest"
import { resolveChainBaseLaw, aiSearchQuery, rankAiLawNames } from "./chain-law-lookup.js"
import type { LawApiClient } from "../lib/api-client.js"
import { lawCache } from "../lib/cache.js"

const lawXml = (names: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><LawSearch><totalCnt>${names.length}</totalCnt>` +
  names.map((n, i) =>
    `<law id="${i + 1}"><법령일련번호>${9000 + i}</법령일련번호><법령명한글><![CDATA[${n}]]></법령명한글>` +
    `<법령ID>${1000 + i}</법령ID><법령구분명>법률</법령구분명></law>`
  ).join("") + `</LawSearch>`

const aiXml = (lawName: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><aiSearch><totalCnt>1</totalCnt><법령조문>` +
  `<법령ID>1000</법령ID><법령명>${lawName}</법령명><법령종류명>법률</법령종류명>` +
  `<조문번호>0044</조문번호><조문제목>술에 취한 상태에서의 운전 금지</조문제목>` +
  `<조문내용><![CDATA[누구든지 술에 취한 상태에서…]]></조문내용><시행일자>20230101</시행일자>` +
  `</법령조문></aiSearch>`

/** 법령명 정확 검색만 응답하는 법제처 흉내 — 주제어("음주운전")로는 아무것도 안 나온다 */
function fakeClient(opts: { known: string[]; aiLawName?: string }) {
  const searched: string[] = []
  const client = {
    searched,
    aiQueries: [] as string[],
    async searchLaw(query: string) {
      searched.push(query)
      const hit = opts.known.filter(n => n.includes(query.trim()))
      return lawXml(hit)
    },
    async fetchApi({ extraParams }: { extraParams?: Record<string, string> }) {
      client.aiQueries.push(extraParams?.query ?? "")
      if (!opts.aiLawName) return lawXml([])
      return aiXml(opts.aiLawName)
    },
  }
  return client as unknown as LawApiClient & typeof client
}

describe("#105 체인 기반 법령 탐색", () => {
  it("구어 질의가 법령명 검색으로 죽지 않는다 — 의미검색으로 기반 법령을 확보한다", async () => {
    lawCache.clear()
    const c = fakeClient({ known: ["도로교통법"], aiLawName: "도로교통법" })
    const r = await resolveChainBaseLaw(c, "음주운전 과태료 기준 얼마")
    expect(r.laws.map(l => l.lawName)).toContain("도로교통법")
  })

  it("무엇으로 검색했는지 알려준다", async () => {
    lawCache.clear()
    const c = fakeClient({ known: ["도로교통법"], aiLawName: "도로교통법" })
    const r = await resolveChainBaseLaw(c, "음주운전 과태료 기준 얼마")
    expect(r.searchedWith).toBe("도로교통법")
    expect(r.attempts.length).toBeGreaterThan(1)
  })

  it("법령명이 직접 들어 있으면 의미검색까지 가지 않는다", async () => {
    lawCache.clear()
    const c = fakeClient({ known: ["관세법"], aiLawName: "엉뚱한법" })
    const r = await resolveChainBaseLaw(c, "관세법 위임 조문 확인")
    expect(r.laws[0]?.lawName).toBe("관세법")
    expect(c.aiQueries).toHaveLength(0)
  })

  it("전부 실패하면 시도한 검색어를 모아 돌려준다", async () => {
    lawCache.clear()
    const c = fakeClient({ known: [] })
    const r = await resolveChainBaseLaw(c, "존재하지 않는 주제 얼마")
    expect(r.laws).toHaveLength(0)
    expect(r.attempts.length).toBeGreaterThan(0)
  })
})

describe("의미검색 질의 정리·법령 점수 (법제처 law-mcp 대조, 2026-11-28)", () => {
  it("구어 꼬리와 낱말 뒤 목적격 조사를 뗀다. 다 떼서 비면 원문", () => {
    expect(aiSearchQuery("임금명세서를 안 주면 과태료 얼마")).toBe("임금명세서 안 주면 과태료")
    expect(aiSearchQuery("허가 없이 건물 증축하면 어떻게 되나요")).toBe("허가 없이 건물 증축하면")
    expect(aiSearchQuery("택배 물건이 파손됐는데 보상 받을 수 있나요")).toBe("택배 물건이 파손됐는데 보상")
    expect(aiSearchQuery("음주운전 처벌 기준")).toBe("음주운전 처벌 기준")
    expect(aiSearchQuery("얼마야")).toBe("얼마야")
  })

  it("1위 조문 하나가 아니라 법령별 점수로 고른다(시행령·시행규칙은 모법으로 묶음)", () => {
    const sig = (names: string[]) => names.map((lawName, i) => ({ lawName, articleNo: String(i + 1), articleTitle: "", articleContent: "", effectiveDate: "", sourceIndex: i }))
    // 「음식점 영업정지 근거」 실응답 순서: 1위가 식품위생법 시행령, 2위가 건강기능식품에 관한 법률
    expect(rankAiLawNames(sig(["식품위생법 시행령", "건강기능식품에 관한 법률", "식품 등의 표시ㆍ광고에 관한 법률", "주차장법", "식품위생법"]))[0]).toBe("식품위생법")
    // 별도 하위법령(…규칙)은 반 점이라 같은 자리면 법률이 앞선다
    expect(rankAiLawNames(sig(["공동주택 층간소음의 범위와 기준에 관한 규칙", "공동주택관리법", "공동주택관리법"]))[0]).toBe("공동주택관리법")
  })
})
