import { describe, it, expect } from "vitest"
import { getArticleHistory, ArticleHistorySchema } from "./article-history.js"
import type { LawApiClient } from "../lib/api-client.js"

// 2026-09-23 리뷰 D5: 실측 lsJoHstInf(관세법 ID=001556, JO=003800) 응답 항목 원문(OC만 치환).
// JO=제38조로 보내면 같은 법령 버전 목록이 오지만 <조문정보>가 전부 비어 거짓 NOT_FOUND가 났다.
const JO_CODE_XML =
  `<?xml version="1.0" encoding="UTF-8"?><LawSearch><target>lsJoHstInf</target><totalCnt>107</totalCnt>` +
  `<law id="1"><법령정보><법령일련번호>5011</법령일련번호><법령명한글><![CDATA[관세법]]></법령명한글><법령ID>001556</법령ID>` +
  `<공포일자>19491123</공포일자><공포번호>00067</공포번호><제개정구분명>제정</제개정구분명><소관부처코드><![CDATA[1053000]]></소관부처코드>` +
  `<소관부처명><![CDATA[재정경제부]]></소관부처명><법령구분명>법률</법령구분명><시행일자>19491123</시행일자></법령정보>` +
  `<조문정보><jo num="1"><조문번호>003800</조문번호><변경사유>제정</변경사유>` +
  `<조문링크>/DRF/lawService.do?OC=test&amp;target=eflaw&amp;MST=5011&amp;JO=003800&amp;efYd=19491123&amp;type=HTML</조문링크>` +
  `<조문변경이력상세링크>/DRF/lawService.do?OC=test&amp;target=lsJoHstInf&amp;ID=001556&amp;JO=003800&amp;type=XML</조문변경이력상세링크>` +
  `<조문개정일>19491123</조문개정일><조문시행일>19491123</조문시행일></jo></조문정보></law>` +
  `<law id="2"><법령정보><법령일련번호>5012</법령일련번호><법령명한글><![CDATA[관세법]]></법령명한글><법령ID>001556</법령ID>` +
  `<공포일자>19511206</공포일자><공포번호>00229</공포번호><제개정구분명>일부개정</제개정구분명><소관부처코드><![CDATA[1053000]]></소관부처코드>` +
  `<소관부처명><![CDATA[재정경제부]]></소관부처명><법령구분명>법률</법령구분명><시행일자>19511227</시행일자></법령정보><조문정보></조문정보></law>` +
  `</LawSearch>`

function recordingClient() {
  const sent: Array<string | undefined> = []
  const client = {
    getArticleHistory: async (p: { jo?: string }) => { sent.push(p.jo); return JO_CODE_XML },
  } as unknown as LawApiClient
  return { client, sent }
}

const run = (client: LawApiClient, jo: string) =>
  getArticleHistory(client, ArticleHistorySchema.parse({ lawId: "001556", jo }))

describe("getArticleHistory: jo는 6자리 JO 코드로 보낸다 (D5)", () => {
  it("스키마 예시 형식 '제38조'를 003800으로 바꿔 보내고 실제 이력을 싣는다", async () => {
    const { client, sent } = recordingClient()
    const r = await run(client, "제38조")
    expect(sent).toEqual(["003800"])
    expect(r.isError).toBeFalsy()
    expect(r.content[0].text).toContain("관세법 제38조")
    expect(r.content[0].text).toContain("변경사유: 제정")
  })

  it("가지 조문도 변환한다 (제10조의2 → 001002)", async () => {
    const { client, sent } = recordingClient()
    await run(client, "제10조의2")
    expect(sent).toEqual(["001002"])
  })

  it("이미 6자리 코드면 그대로 둔다 (buildJO에 넣으면 380000이 된다)", async () => {
    const { client, sent } = recordingClient()
    await run(client, "003800")
    expect(sent).toEqual(["003800"])
  })
})
