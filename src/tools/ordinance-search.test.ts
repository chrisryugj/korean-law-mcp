import { describe, it, expect, beforeEach } from "vitest"
import { searchOrdinance } from "./ordinance-search.js"
import { lawCache } from "../lib/cache.js"
import { normalizeLawSearchText } from "../lib/search-normalizer.js"
import type { LawApiClient } from "../lib/api-client.js"

const EMPTY = `<?xml version="1.0" encoding="UTF-8"?><OrdinSearch><totalCnt>0</totalCnt><page>1</page></OrdinSearch>`
const HIT = `<?xml version="1.0" encoding="UTF-8"?><OrdinSearch><totalCnt>1</totalCnt><page>1</page>` +
  `<law><자치법규일련번호>1800233</자치법규일련번호><자치법규명><![CDATA[강릉시 주차위반자동차 견인 등 소요비용산정 기준에 관한 조례]]></자치법규명>` +
  `<지자체기관명>강릉시</지자체기관명><공포일자>20200101</공포일자><시행일자>20200101</시행일자></law></OrdinSearch>`

/**
 * #117 실측 정정: 조번호를 버리는 것은 폴백이 아니라 **업스트림**이다.
 * `target=ordin`은 section=ordinNm(자치법규명)만 훑어서 "도로교통법 제148조의2"에도
 * 곧바로 158건을 돌려준다(폴백은 애초에 발동하지 않는다, 2026-08-17 실측).
 */
describe("searchOrdinance — 조문 번호 미반영 고지 (#117)", () => {
  it("질의에 조문 번호가 있으면 자치법규명 검색이 그것을 반영하지 못함을 밝힌다", async () => {
    const client = { searchOrdinance: async () => HIT } as unknown as LawApiClient
    const r = await searchOrdinance(client, { query: "도로교통법 제148조의2", display: 10 })
    const text = r.content[0].text
    expect(text).toMatch(/조문 번호/)
    expect(text).toMatch(/관련성|보장|반영/)
  })

  // #140: `제` 없는 조문 표기(44조, 3조의3)는 #103이 새로 지원한 형태다.
  // 경고 판정만 `제`를 요구하면 그 표기에서만 경고가 사라진다.
  it("`제` 없는 조문 표기에서도 고지한다", async () => {
    const client = { searchOrdinance: async () => HIT } as unknown as LawApiClient
    for (const q of ["도로교통법 44조", "도로교통법 3조의3", "민법 제103조"]) {
      const r = await searchOrdinance(client, { query: q, display: 10 })
      expect(r.content[0].text, q).toMatch(/조문 번호/)
    }
  })

  it("조문 번호가 없는 질의에는 고지를 붙이지 않는다", async () => {
    const client = { searchOrdinance: async () => HIT } as unknown as LawApiClient
    const r = await searchOrdinance(client, { query: "강릉시 견인 조례", display: 10 })
    expect(r.content[0].text).not.toMatch(/조문 번호/)
  })

  it("옵트인 전에는 본문을 열지 않는다 — 비용이 기본값이 되지 않게", async () => {
    let bodyCalls = 0
    const client = {
      searchOrdinance: async () => HIT,
      getOrdinance: async () => { bodyCalls++; return "{}" },
    } as unknown as LawApiClient
    await searchOrdinance(client, { query: "도로교통법 제148조의2", display: 10 })
    expect(bodyCalls).toBe(0)
  })
})

describe("searchOrdinance — 조문 관련성 본문 확인 (#124)", () => {
  // 본문은 lawCache에 태운다(같은 조례가 여러 질의에 반복 등장). 테스트끼리 캐시를
  // 물려주면 "조회 안 했다"와 "캐시에서 꺼냈다"가 구분되지 않는다.
  beforeEach(() => lawCache.clear())

  const TWO = `<?xml version="1.0" encoding="UTF-8"?><OrdinSearch><totalCnt>2</totalCnt><page>1</page>` +
    `<law><자치법규일련번호>111</자치법규일련번호><자치법규명><![CDATA[관련 조례]]></자치법규명><지자체기관명>A시</지자체기관명></law>` +
    `<law><자치법규일련번호>222</자치법규일련번호><자치법규명><![CDATA[무관 조례]]></자치법규명><지자체기관명>B시</지자체기관명></law>` +
    `</OrdinSearch>`

  function client(seen: string[]): LawApiClient {
    return {
      searchOrdinance: async () => TWO,
      getOrdinance: async (id: string) => {
        seen.push(id)
        return id === "111"
          ? JSON.stringify({ 조문: "「도로교통법」 제148조의2에 따른 견인 비용" })
          : JSON.stringify({ 조문: "주차장법 제6조에 따른 설치 기준" })
      },
    } as unknown as LawApiClient
  }

  it("본문이 해당 조문을 인용한 항목만 확인으로 승격한다", async () => {
    const seen: string[] = []
    const r = await searchOrdinance(client(seen), {
      query: "도로교통법 제148조의2", display: 10, verifyArticleRelevance: true,
    })
    const text = r.content[0].text
    expect(seen.sort()).toEqual(["111", "222"])
    expect(text).toMatch(/조문 관련성 확인: 1건/)
  })

  it("미확인 항목을 버리지 않는다 — 확인 못 한 것은 무관이 아니다", async () => {
    const r = await searchOrdinance(client([]), {
      query: "도로교통법 제148조의2", display: 10, verifyArticleRelevance: true,
    })
    const text = r.content[0].text
    expect(text).toContain("[222]")
    expect(text).toMatch(/미확인/)
  })

  it("상한을 넘는 후보는 조회하지 않고 미확인으로 남긴다", async () => {
    const seen: string[] = []
    const r = await searchOrdinance(client(seen), {
      query: "도로교통법 제148조의2", display: 10, verifyArticleRelevance: true, relevanceLimit: 1,
    })
    expect(seen).toEqual(["111"])
    expect(r.content[0].text).toMatch(/본문 미조회 1건/)
  })

  it("두 번째 질의는 캐시를 써서 업스트림을 다시 때리지 않는다", async () => {
    const seen: string[] = []
    const args = { query: "도로교통법 제148조의2", display: 10, verifyArticleRelevance: true }
    await searchOrdinance(client(seen), args)
    expect(seen.length).toBe(2)
    const r = await searchOrdinance(client(seen), args)
    expect(seen.length).toBe(2)                       // 추가 조회 없음
    expect(r.content[0].text).toMatch(/조문 관련성 확인: 1건/)  // 판정은 동일
  })

  it("조문 번호가 없으면 옵트인해도 본문을 열지 않는다", async () => {
    const seen: string[] = []
    await searchOrdinance(client(seen), {
      query: "강릉시 견인 조례", display: 10, verifyArticleRelevance: true,
    })
    expect(seen).toEqual([])
  })
})

describe("searchOrdinance — 확장 질의", () => {
  it("확장 질의로 결과를 냈으면 그 사실도 밝힌다", async () => {
    const seen: string[] = []
    const client = {
      searchOrdinance: async ({ query }: { query: string }) => {
        seen.push(query)
        return seen.length === 1 ? EMPTY : HIT
      },
    } as unknown as LawApiClient
    const r = await searchOrdinance(client, { query: "광진구 휴직 조례", display: 10 })
    expect(seen.length).toBeGreaterThan(1)
    expect(r.content[0].text).toMatch(/확장/)
  })
})

// 2026-09-23 리뷰 C3: normalizeLawSearchText(LexDiff 이식본)의 `\s*[-]\s*`·`\s*\.\s*` 가 공백 덩어리에서
// 제곱으로 백트래킹했다(10만 자 15.0초, fetch 전). 이식본은 고치지 않고 호출부에서 공백을 접는다.
// 아래 퍼즈가 "접어도 결과가 같다"는 전제를 고정한다. LexDiff 동기화로 전제가 깨지면 여기서 먼저 드러난다.
function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe("searchOrdinance: 공백 덩어리 질의 (리뷰 C3)", () => {
  it("normalizeLawSearchText 는 공백을 미리 접어도 결과가 같다 (고정 시드 퍼즈)", () => {
    const rnd = seeded(20260923)
    const nbsp = String.fromCharCode(0xa0), ideo = String.fromCharCode(0x3000), dash = String.fromCharCode(0x2014)
    const alphabet = [" ", "  ", "\t", "\n", nbsp, ideo, "-", dash, ".", "(", ")", "§", "=", "가", "법", "a", "B", "1"]
    for (let i = 0; i < 20_000; i++) {
      let s = ""
      const n = Math.floor(rnd() * 16)
      for (let j = 0; j < n; j++) s += alphabet[Math.floor(rnd() * alphabet.length)]
      expect(normalizeLawSearchText(s.replace(/\s+/g, " "))).toBe(normalizeLawSearchText(s))
    }
  })

  it("공백 10만 자 질의가 이벤트 루프를 멈추지 않는다", async () => {
    const client = { searchOrdinance: async () => EMPTY } as unknown as LawApiClient
    const t0 = performance.now()
    const r = await searchOrdinance(client, { query: "서울" + " ".repeat(100_000) + "주차 제12조", display: 20 })
    expect(performance.now() - t0).toBeLessThan(500)
    expect(r.isError).toBe(true)
  })
})
