import { describe, it, expect, beforeEach } from "vitest"
import { applicableLaw } from "./applicable-law.js"
import { lawCache } from "../lib/cache.js"
import type { LawApiClient } from "../lib/api-client.js"

// 법제처 LIKE 검색이 무관한 부분매칭만 돌려주는 상황 (「상법」이 조회 범위 밖이거나 부재).
// 종전엔 laws[0]=무관한 법으로 행위시법 판단 전체를 확신형으로 출력했다.
const UNRELATED_XML = `<?xml version="1.0" encoding="UTF-8"?><LawSearch><totalCnt>56</totalCnt>` +
  `<law id="1"><법령일련번호>3274</법령일련번호><법령명한글><![CDATA[1980년해직공무원의보상등에관한특별조치법]]></법령명한글><법령ID>001348</법령ID><법령구분명>법률</법령구분명></law>` +
  `</LawSearch>`

describe("applicableLaw — 무관 법령 가드", () => {
  beforeEach(() => lawCache.clear())

  it("검색 1위가 요청 법령과 무관하면 진행하지 않고 NOT_FOUND 안내", async () => {
    // 후속 단계(연혁 조회 등) 메서드를 일부러 넣지 않음 —
    // 가드가 조기 반환하지 않으면 이 스텁에서 즉시 터진다
    const client = {
      searchLaw: async () => UNRELATED_XML,
    } as unknown as LawApiClient

    const r = await applicableLaw(client, { lawName: "상법", date: "2023-05-10" })
    const text = r.content[0].text
    expect(r.isError).toBe(true)
    expect(text).toContain("[NOT_FOUND]")
    expect(text).toContain("정확히 찾지 못했습니다")
    // 무관한 법으로 행위시법 판단을 그리지 않았는지
    expect(text).not.toContain("행위시법 판단:")
  })
})
