/**
 * 법령 본문 캐시 수명·자리 회귀 (2026-09-23 리뷰 A8)
 *
 * - lawId 만 준 "현행" 조회는 개정 시행일을 넘기면 다른 본문이 현행이 된다 → 1시간.
 *   MST·efYd 는 버전을 못박으므로 하루를 유지한다.
 * - 파싱된 법령 전문(batch)은 전역 lawCache 가 아니라 건수가 작은 전용 캐시에 둔다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getLawText } from "./law-text.js"
import { getBatchArticles } from "./batch-articles.js"
import { lawCache } from "../lib/cache.js"
import type { LawApiClient } from "../lib/api-client.js"

const BODY = JSON.stringify({
  법령: {
    기본정보: { 법령명_한글: "테스트법" },
    조문: { 조문단위: [{ 조문여부: "조문", 조문번호: "1", 조문내용: "제1조(목적) 이 법은 테스트한다." }] },
  },
})

function stub() {
  const calls: object[] = []
  const client = { getLawText: async (p: object) => { calls.push(p); return BODY } } as unknown as LawApiClient
  return { client, calls }
}

beforeEach(() => {
  lawCache.clear()
  vi.useFakeTimers({ toFake: ["Date"] })
})
afterEach(() => vi.useRealTimers())

describe("get_law_text 캐시 수명", () => {
  it("lawId 현행 조회는 1시간 뒤 다시 가져온다", async () => {
    const { client, calls } = stub()
    await getLawText(client, { lawId: "001706", jo: "제1조" })
    vi.setSystemTime(Date.now() + 61 * 60 * 1000)
    await getLawText(client, { lawId: "001706", jo: "제1조" })
    expect(calls).toHaveLength(2)
  })

  it("MST 조회는 하루 동안 캐시를 쓴다", async () => {
    const { client, calls } = stub()
    await getLawText(client, { mst: "284415", jo: "제1조" })
    vi.setSystemTime(Date.now() + 61 * 60 * 1000)
    await getLawText(client, { mst: "284415", jo: "제1조" })
    expect(calls).toHaveLength(1)
  })
})

describe("get_batch_articles 전문 캐시 자리", () => {
  it("파싱된 전문을 전역 lawCache 에 넣지 않는다", async () => {
    const { client } = stub()
    const before = lawCache.size()
    await getBatchArticles(client, { mst: "284415", articles: ["제1조"] })
    expect(lawCache.size()).toBe(before)
  })
})

// mst 와 lawId 는 다른 번호 체계다. 같은 값("001706")이 mst 로는 사방사업법, lawId 로는 민법이라
// 한 키 공간을 쓰면 앞 조회가 뒤 조회의 답이 된다(실측). HTTP 모드에선 캐시가 프로세스 공용이라 남의 응답까지 오염된다.
describe("캐시 키: mst 와 lawId 를 섞지 않는다", () => {
  it("get_law_text: mst=X 뒤의 lawId=X 는 새로 가져온다", async () => {
    const { client, calls } = stub()
    await getLawText(client, { mst: "001706", jo: "제1조" })
    await getLawText(client, { lawId: "001706", jo: "제1조" })
    expect(calls).toHaveLength(2)
  })

  it("get_batch_articles: mst=X 뒤의 lawId=X 는 새로 가져온다", async () => {
    const { client, calls } = stub()
    await getBatchArticles(client, { mst: "001706", articles: ["제1조"] })
    await getBatchArticles(client, { lawId: "001706", articles: ["제1조"] })
    expect(calls).toHaveLength(2)
  })
})
