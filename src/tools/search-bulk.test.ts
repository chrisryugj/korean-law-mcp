/**
 * search_law_bulk — 등록부 감시용 대량 조회·diff (#157)
 *
 * 업스트림은 mock. eflaw(시행예정) 보조검색은 target 인자로 갈린다.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { searchLawBulk, SearchLawBulkSchema } from "./search-bulk.js"
import { lawCache } from "../lib/cache.js"
import type { LawApiClient } from "../lib/api-client.js"

const hit = (name: string, lawId: string, mst: string, effDate: string) =>
  `<law id="1"><법령명한글><![CDATA[${name}]]></법령명한글><법령ID>${lawId}</법령ID>` +
  `<법령일련번호>${mst}</법령일련번호><시행일자>${effDate}</시행일자>` +
  `<현행연혁코드>현행</현행연혁코드><법령구분명>법률</법령구분명></law>`

const search = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><LawSearch><totalCnt>1</totalCnt>${body}</LawSearch>`

const EMPTY = `<?xml version="1.0" encoding="UTF-8"?><LawSearch><totalCnt>0</totalCnt></LawSearch>`

const UPCOMING = `<?xml version="1.0" encoding="UTF-8"?><LawSearch><law id="1">` +
  `<법령명한글><![CDATA[산업안전보건법]]></법령명한글><법령ID>001766</법령ID>` +
  `<법령일련번호>280100</법령일련번호><시행일자>20260918</시행일자><공포일자>20260318</공포일자>` +
  `<공포번호>20000</공포번호><제개정구분명>일부개정</제개정구분명><현행연혁코드>시행예정</현행연혁코드>` +
  `<법령구분명>법률</법령구분명></law></LawSearch>`

const CURRENT: Record<string, string> = {
  "산업안전보건법": search(hit("산업안전보건법", "001766", "279181", "20260612")),
  "물환경보전법": search(hit("물환경보전법", "002233", "270000", "20250101")),
  "없는법": EMPTY,
}

function stub(opts: { upcomingFor?: string } = {}): LawApiClient & { calls: string[] } {
  const calls: string[] = []
  const client = {
    calls,
    async searchLaw(query: string, _k?: string, _d?: number, target: string = "law") {
      calls.push(`${target}:${query}`)
      if (target === "eflaw") return query === opts.upcomingFor ? UPCOMING : EMPTY
      return CURRENT[query] ?? EMPTY
    },
  }
  return client as unknown as LawApiClient & { calls: string[] }
}

beforeEach(() => lawCache.clear())

describe("search_law_bulk (#157)", () => {
  it("건당 한 줄로 법령ID·MST·시행일만 돌려준다", async () => {
    const r = await searchLawBulk(stub(), {
      queries: ["산업안전보건법", "물환경보전법"], includeUpcoming: false,
    })
    const text = r.content[0].text
    expect(text).toContain("ID 001766 | MST 279181 | 시행 2026-06-12")
    expect(text).toContain("ID 002233 | MST 270000 | 시행 2025-01-01")
    // search_law 가 싣던 부분매칭 목록·다음단계 안내는 감시 용도에 불필요하다
    expect(text).not.toContain("📂 부분매칭")
    expect(text).not.toContain("💡 다음: get_law_text")
  })

  it("includeUpcoming=false 면 eflaw 보조검색을 호출하지 않는다", async () => {
    const c = stub()
    await searchLawBulk(c, { queries: ["산업안전보건법"], includeUpcoming: false })
    expect(c.calls).toEqual(["law:산업안전보건법"])
  })

  it("시행예정 개정은 같은 법령ID의 것만 병기한다", async () => {
    const r = await searchLawBulk(stub({ upcomingFor: "산업안전보건법" }), {
      queries: ["산업안전보건법"], includeUpcoming: true,
    })
    expect(r.content[0].text).toContain("🔜 일부개정 시행예정 2026-09-18 (MST 280100")
  })

  it("diff 모드: MST가 달라진 것만 돌려주고 동일한 건 건수만 보고한다", async () => {
    const r = await searchLawBulk(stub(), {
      queries: ["산업안전보건법", "물환경보전법"],
      previous: { "001766": "270000", "002233": "270000" },
      includeUpcoming: false,
    })
    const text = r.content[0].text
    expect(text).toContain("△ 산업안전보건법 | ID 001766 | MST 270000 → 279181")
    expect(text).not.toContain("△ 물환경보전법")
    expect(text).toContain("본문 동일 1건은 생략")
  })

  it("diff 모드: MST가 같아도 시행예정이 있으면 침묵하지 않는다", async () => {
    const r = await searchLawBulk(stub({ upcomingFor: "산업안전보건법" }), {
      queries: ["산업안전보건법"],
      previous: { "001766": "279181" },
      includeUpcoming: true,
    })
    const text = r.content[0].text
    expect(text).toContain("본문 동일(MST 279181) — 시행예정 있음")
    expect(text).toContain("2026-09-18")
  })

  it("previous 에 없던 법령은 신규로 구분한다", async () => {
    const r = await searchLawBulk(stub(), {
      queries: ["물환경보전법"], previous: { "001766": "279181" }, includeUpcoming: false,
    })
    expect(r.content[0].text).toContain("＋ 물환경보전법")
  })

  it("검색 0건은 실패로 뭉뚱그리지 않고 쿼리명을 밝힌다", async () => {
    const r = await searchLawBulk(stub(), { queries: ["없는법"], includeUpcoming: false })
    expect(r.content[0].text).toContain("검색 0건 1건: 「없는법」")
  })

  it("다음 감시에 그대로 넣을 스냅샷을 함께 준다", async () => {
    const r = await searchLawBulk(stub(), {
      queries: ["산업안전보건법", "물환경보전법"], includeUpcoming: false,
    })
    const text = r.content[0].text
    const m = text.match(/\{[^\n]*\}/)
    expect(m).not.toBeNull()
    expect(JSON.parse(m![0])).toEqual({ "001766": "279181", "002233": "270000" })
  })

  it("한 건이 터져도 나머지 결과를 버리지 않는다", async () => {
    const c = {
      async searchLaw(query: string, _k?: string, _d?: number, target: string = "law") {
        if (target === "eflaw") return EMPTY
        if (query === "폭탄법") throw new Error("upstream 500")
        return CURRENT[query] ?? EMPTY
      },
    } as unknown as LawApiClient
    const r = await searchLawBulk(c, { queries: ["폭탄법", "산업안전보건법"], includeUpcoming: false })
    const text = r.content[0].text
    expect(text).toContain("산업안전보건법")
    expect(text).toContain("조회 실패 1건: 「폭탄법」")
  })

  it("스키마: 상한을 넘는 배열은 거절한다", () => {
    const many = Array.from({ length: 41 }, (_, i) => `법령${i}`)
    expect(SearchLawBulkSchema.safeParse({ queries: many }).success).toBe(false)
    expect(SearchLawBulkSchema.safeParse({ queries: ["민법"] }).success).toBe(true)
  })
})
