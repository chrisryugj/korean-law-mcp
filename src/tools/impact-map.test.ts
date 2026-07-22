import { describe, it, expect, beforeEach } from "vitest"
import { impactMap } from "./impact-map.js"
import { lawCache } from "../lib/cache.js"
import type { LawApiClient } from "../lib/api-client.js"

const UNRELATED_XML = `<?xml version="1.0" encoding="UTF-8"?><LawSearch><totalCnt>56</totalCnt>` +
  `<law id="1"><법령일련번호>3274</법령일련번호><법령명한글><![CDATA[1980년해직공무원의보상등에관한특별조치법]]></법령명한글><법령ID>001348</법령ID><법령구분명>법률</법령구분명></law>` +
  `</LawSearch>`

describe("impactMap — 무관 법령 가드", () => {
  beforeEach(() => lawCache.clear())

  it("검색 1위가 요청 법령과 무관하면 영향 지도를 그리지 않는다", async () => {
    // 가드가 조기 반환하지 않으면 병렬 하위검색이 이 스텁에 없는 메서드를 불러 터진다
    const client = {
      searchLaw: async () => UNRELATED_XML,
    } as unknown as LawApiClient

    const r = await impactMap(client, { lawName: "상법", jo: "제1조", includeOrdinances: true, includeMermaid: true })
    const text = r.content[0].text
    expect(r.isError).toBe(true)
    expect(text).toContain("[NOT_FOUND]")
    expect(text).not.toContain("Impact Map:")
  })
})
