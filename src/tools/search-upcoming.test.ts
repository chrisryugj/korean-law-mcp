/**
 * 시행예정 보조검색 회귀 (2026-09-23 리뷰 A2·A3·A4·B6)
 *
 * - A2: eflaw 검색은 nw=2(시행예정만)·display=100 으로 부른다. nw 없이 30건이면 연혁 행이 창을 채웠다.
 * - A3: search_law 는 주 검색과 시행예정 검색을 같이 출발시키고, 0건 폴백은 같은 약속을 재사용한다.
 * - A4: 보조검색 실패는 [](확인했고 없음)가 아니라 null(확인 못 함). 결과엔 실패 안내를 싣고 1분만 캐시한다.
 * - B6: search_law_bulk diff 는 확인 실패를 "본문 동일, 생략"으로 세지 않는다. 예산 소진은 조회 실패로 남긴다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { fetchUpcomingLaws } from "../lib/upcoming-laws.js"
import { searchLaw } from "./search.js"
import { searchLawBulk } from "./search-bulk.js"
import { lawCache } from "../lib/cache.js"
import { ExecutionLimitError } from "../lib/execution-limits.js"
import type { LawApiClient } from "../lib/api-client.js"

const lawXml = (name: string, lawId = "001766", mst = "279181") =>
  `<?xml version="1.0" encoding="UTF-8"?><LawSearch><law id="1"><법령명한글><![CDATA[${name}]]></법령명한글>` +
  `<법령ID>${lawId}</법령ID><법령일련번호>${mst}</법령일련번호><공포일자>20240101</공포일자><시행일자>20240101</시행일자>` +
  `<현행연혁코드>현행</현행연혁코드><법령구분명>법률</법령구분명></law></LawSearch>`

const EMPTY = `<?xml version="1.0" encoding="UTF-8"?><LawSearch><totalCnt>0</totalCnt></LawSearch>`

const UPCOMING = `<?xml version="1.0" encoding="UTF-8"?><LawSearch><law id="1">` +
  `<법령명한글><![CDATA[산업안전보건법]]></법령명한글><법령ID>001766</법령ID>` +
  `<법령일련번호>280100</법령일련번호><시행일자>20260918</시행일자><공포일자>20260318</공포일자>` +
  `<공포번호>20000</공포번호><제개정구분명>일부개정</제개정구분명><현행연혁코드>시행예정</현행연혁코드>` +
  `<법령구분명>법률</법령구분명></law></LawSearch>`

type Call = { query: string; display?: number; target: string; nw?: string }

function stub(opts: {
  current?: Record<string, string>
  eflaw?: (call: Call) => Promise<string> | string
  lawDelayMs?: number
  events?: string[]
} = {}) {
  const calls: Call[] = []
  const client = {
    async searchLaw(query: string, _k?: string, display?: number, target = "law", nw?: string) {
      const call = { query, display, target, nw }
      calls.push(call)
      if (target === "eflaw") {
        opts.events?.push("eflaw-start")
        return opts.eflaw ? await opts.eflaw(call) : EMPTY
      }
      opts.events?.push("law-start")
      if (opts.lawDelayMs) await new Promise(r => setTimeout(r, opts.lawDelayMs))
      opts.events?.push("law-end")
      return opts.current?.[query] ?? EMPTY
    },
    async fetchApi() { return EMPTY },
  }
  return { client: client as unknown as LawApiClient, calls }
}

beforeEach(() => lawCache.clear())
afterEach(() => vi.useRealTimers())

describe("fetchUpcomingLaws", () => {
  it("eflaw 를 nw=2·display=100 으로 부른다 (리뷰 A2)", async () => {
    const { client, calls } = stub({ eflaw: () => UPCOMING })
    const r = await fetchUpcomingLaws(client, "산업안전보건법")
    expect(r?.map(u => u.mst)).toEqual(["280100"])
    expect(calls).toEqual([{ query: "산업안전보건법", display: 100, target: "eflaw", nw: "2" }])
  })

  it("일시 장애는 null 로 돌려주고 캐시하지 않는다 (확인했고 없음과 구분)", async () => {
    let fail = true
    const { client, calls } = stub({ eflaw: () => { if (fail) throw new Error("법제처 서버 오류 (503)"); return UPCOMING } })
    expect(await fetchUpcomingLaws(client, "산업안전보건법")).toBeNull()
    fail = false
    expect((await fetchUpcomingLaws(client, "산업안전보건법"))?.length).toBe(1)
    expect(calls).toHaveLength(2)
  })

  it("예산 소진은 삼키지 않고 다시 던진다", async () => {
    const { client } = stub({ eflaw: () => { throw new ExecutionLimitError("Request upstream work budget exceeded") } })
    await expect(fetchUpcomingLaws(client, "산업안전보건법")).rejects.toBeInstanceOf(ExecutionLimitError)
  })
})

describe("search_law: 시행예정 보조검색", () => {
  it("주 검색과 같이 출발한다 (주 검색이 끝나기 전에 eflaw 가 이미 나가 있다, 리뷰 A3)", async () => {
    const events: string[] = []
    const { client } = stub({ current: { 산업안전보건법: lawXml("산업안전보건법") }, lawDelayMs: 20, events })
    await searchLaw(client, { query: "산업안전보건법", display: 50 })
    expect(events.indexOf("eflaw-start")).toBeLessThan(events.indexOf("law-end"))
  })

  it("보조검색 실패를 결과에 밝히고, 그 결과는 1분만 캐시한다 (리뷰 A4)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    let fail = true
    const { client, calls } = stub({
      current: { 산업안전보건법: lawXml("산업안전보건법") },
      eflaw: () => { if (fail) throw new Error("법제처 서버 오류 (503)"); return UPCOMING },
    })

    const first = (await searchLaw(client, { query: "산업안전보건법", display: 50 })).content[0].text
    expect(first).toContain("시행예정(공포 후 미시행) 개정 확인이 일시 장애로 실패")

    fail = false
    vi.setSystemTime(Date.now() + 61_000)
    const second = (await searchLaw(client, { query: "산업안전보건법", display: 50 })).content[0].text
    expect(second).toContain("개정 시행예정")
    expect(second).not.toContain("일시 장애로 실패")
    expect(calls.filter(c => c.target === "law")).toHaveLength(2)
  })

  it("정상 결과는 1시간 캐시를 유지한다", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const { client, calls } = stub({ current: { 산업안전보건법: lawXml("산업안전보건법") }, eflaw: () => UPCOMING })
    await searchLaw(client, { query: "산업안전보건법", display: 50 })
    vi.setSystemTime(Date.now() + 61_000)
    await searchLaw(client, { query: "산업안전보건법", display: 50 })
    expect(calls.filter(c => c.target === "law")).toHaveLength(1)
  })

  it("0건 폴백은 이미 출발한 시행예정 검색을 재사용한다 (같은 eflaw 를 두 번 치지 않는다)", async () => {
    const { client, calls } = stub({ eflaw: c => (c.nw === "2" ? UPCOMING : EMPTY) })
    const text = (await searchLaw(client, { query: "산업안전보건법", display: 50 })).content[0].text
    expect(text).toContain("공포 후 시행 대기 중인 법령")
    expect(calls.filter(c => c.target === "eflaw" && c.nw === "2")).toHaveLength(1)
  })

  it("0건 폴백에서 폐지 조회가 예산 소진으로 던져도 이미 받은 시행예정 결과를 준다", async () => {
    const { client } = stub({ eflaw: c => { if (c.nw === "2") return UPCOMING; throw new ExecutionLimitError("Request upstream work budget exceeded") } })
    const text = (await searchLaw(client, { query: "산업안전보건법", display: 50 })).content[0].text
    expect(text).toContain("공포 후 시행 대기 중인 법령")
  })

  it("0건인데 시행예정 확인까지 실패하면 '없음'에 실패 안내를 붙인다", async () => {
    const { client } = stub({ eflaw: c => { if (c.nw === "2") throw new Error("법제처 서버 오류 (503)"); return EMPTY } })
    const text = (await searchLaw(client, { query: "없는법이름", display: 50 })).content[0].text
    expect(text).toContain("일시 장애로 실패")
  })
})

describe("search_law_bulk: 시행예정 확인 실패 (리뷰 B6)", () => {
  const current = { 산업안전보건법: lawXml("산업안전보건법") }

  it("diff 모드에서 확인 실패를 '본문 동일, 생략'으로 세지 않는다", async () => {
    const { client } = stub({ current, eflaw: () => { throw new Error("법제처 서버 오류 (503)") } })
    const text = (await searchLawBulk(client, {
      queries: ["산업안전보건법"], previous: { "001766": "279181" }, includeUpcoming: true,
    })).content[0].text
    expect(text).toContain("시행예정 확인 실패, 재조회 필요")
    expect(text).toContain("본문 동일 0건은 생략")
  })

  it("예산 소진은 조회 실패 행으로 남는다 (시행예정 없음으로 둔갑하지 않는다)", async () => {
    const { client } = stub({ current, eflaw: () => { throw new ExecutionLimitError("Request upstream work budget exceeded") } })
    const text = (await searchLawBulk(client, {
      queries: ["산업안전보건법"], previous: { "001766": "279181" }, includeUpcoming: true,
    })).content[0].text
    expect(text).toContain("조회 실패 1건")
    expect(text).not.toContain("변경 없음")
  })
})
