/**
 * amendment_track — 조문별 개정 이력 opt-in (#158)
 *
 * 이력 섹션은 제정 시점부터 조문×개정 전건을 나열해 5만 자 상한을 혼자 소진한다
 * (산업안전보건법 1981~ = 4.9만 자 → 2.4만 자 절단, 실측). 신구대조표가 잘려나가는
 * 것을 막기 위해 기본을 끄고, 껐다는 사실과 켜는 법을 응답에 남긴다.
 */
import { describe, it, expect } from "vitest"
import { chainAmendmentTrack, chainAmendmentTrackSchema } from "./chains.js"
import type { LawApiClient } from "../lib/api-client.js"

const OLDNEW_XML = `<?xml version="1.0" encoding="UTF-8"?><LawOldAndNew><법령명한글><![CDATA[관세법]]></법령명한글>
<조문단위><조문내용><![CDATA[제1조(목적) …]]></조문내용></조문단위></LawOldAndNew>`

const HISTORY_XML = `<?xml version="1.0" encoding="UTF-8"?><LawArticleHistory><법령명><![CDATA[관세법]]></법령명>
<조문내용><![CDATA[제1조 개정 이력 …]]></조문내용></LawArticleHistory>`

function stub() {
  const calls: string[] = []
  const client = {
    calls,
    async compareOldNew() { calls.push("compareOldNew"); return OLDNEW_XML },
    async getArticleHistory() { calls.push("getArticleHistory"); return HISTORY_XML },
  }
  return client as unknown as LawApiClient & { calls: string[] }
}

describe("chain_amendment_track — includeHistory opt-in (#158)", () => {
  it("기본은 이력을 부르지 않고, 껐다는 사실과 켜는 법을 남긴다", async () => {
    const c = stub()
    const r = await chainAmendmentTrack(c, { query: "관세법", mst: "9001", lawId: "1001", includeHistory: false })
    expect(c.calls).not.toContain("getArticleHistory")
    const text = r.content[0].text
    expect(text).toContain("[조문별 개정 이력 생략]")
    expect(text).toContain("includeHistory=true")
    // 침묵하면 사용자는 이 서버가 이력을 못 준다고 믿는다 — 대체 경로도 함께
    expect(text).toContain('get_article_history(lawId="1001")')
  })

  it("includeHistory=true 면 종전대로 이력을 싣는다", async () => {
    const c = stub()
    const r = await chainAmendmentTrack(c, { query: "관세법", mst: "9001", lawId: "1001", includeHistory: true })
    expect(c.calls).toContain("getArticleHistory")
    expect(r.content[0].text).not.toContain("[조문별 개정 이력 생략]")
  })

  it("스키마 기본값은 false", () => {
    const parsed = chainAmendmentTrackSchema.parse({ query: "관세법" })
    expect(parsed.includeHistory).toBe(false)
  })
})
