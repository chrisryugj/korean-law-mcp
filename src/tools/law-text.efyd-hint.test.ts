import { describe, it, expect, beforeEach } from "vitest"
import { getLawText } from "./law-text.js"
import { lawCache } from "../lib/cache.js"
import type { LawApiClient } from "../lib/api-client.js"

// 연혁(과거) 버전은 MST 단독으로 조회되지 않고 efYd를 함께 줘야 한다.
// applicable_law는 "(MST 167694)"처럼 MST만 제시하므로, 그 값을 그대로
// get_law_text(mst=...)에 넘기면 반드시 NOT_FOUND가 난다.
// 이때 원인을 알려주지 않으면 호출자가 lawId 조합 등으로 헛발질을 반복한다.
describe("getLawText — 연혁 버전 조회 안내", () => {
  beforeEach(() => lawCache.clear())

  // 법제처가 해당 조합에 데이터를 주지 않는 상황 (법령 키 없음)
  const emptyClient = {
    getLawText: async () => JSON.stringify({}),
  } as unknown as LawApiClient

  it("mst만 지정해 실패하면 efYd 동반 지정을 복사 가능한 형태로 안내", async () => {
    const r = await getLawText(emptyClient, { mst: "167694" })
    const text = r.content[0].text

    expect(r.isError).toBe(true)
    expect(text).toContain("[NOT_FOUND]")
    expect(text).toContain("efYd")
    expect(text).toContain('get_law_text(mst="167694", efYd="YYYYMMDD")')
  })

  it("jo까지 지정했다면 안내 예시에도 jo를 유지", async () => {
    const r = await getLawText(emptyClient, { mst: "167694", jo: "제39조" })
    expect(r.content[0].text).toContain('get_law_text(mst="167694", efYd="YYYYMMDD", jo="제39조")')
  })

  it("efYd를 이미 지정했다면 efYd 안내를 덧붙이지 않음", async () => {
    const r = await getLawText(emptyClient, { mst: "167694", efYd: "20150729" })
    const text = r.content[0].text

    expect(r.isError).toBe(true)
    expect(text).toContain("[NOT_FOUND]")
    expect(text).not.toContain("efYd로 함께 지정")
  })
})
