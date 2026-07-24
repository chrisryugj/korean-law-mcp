import { describe, it, expect } from "vitest"
import { getLawAbbreviations } from "./utils.js"
import type { LawApiClient } from "../lib/api-client.js"

// 실제 lawSearch.do(target=lsAbrv) 응답 축약(2026-07 라이브 캡처 기준).
// 항목 태그가 <lsAbrv>가 아니라 <law>이고, 필드는 법령명한글/법령약칭명이다.
const LSABRV_XML = `<?xml version="1.0" encoding="UTF-8"?><LawSearch><target>lsAbrv</target><totalCnt>2686</totalCnt><page>1</page>
<law id="1"><법령일련번호>253527</법령일련번호><현행연혁코드>현행</현행연혁코드><법령명한글><![CDATA[10ㆍ27법난 피해자의 명예회복 등에 관한 법률]]></법령명한글><법령약칭명>10ㆍ27법난법</법령약칭명><법령ID>010719</법령ID><공포일자>20230808</공포일자><소관부처명>문화체육관광부</소관부처명></law>
<law id="2"><법령일련번호>253528</법령일련번호><현행연혁코드>현행</현행연혁코드><법령명한글><![CDATA[화학물질관리법]]></법령명한글><법령약칭명>화관법</법령약칭명><법령ID>000162</법령ID><공포일자>20240101</공포일자><소관부처명>환경부</소관부처명></law>
</LawSearch>`

const textOf = (r: { content: Array<{ text: string }> }) => r.content[0].text

describe("getLawAbbreviations — 죽은 파싱 부활", () => {
  // 종전 코드는 존재하지 않는 <lsAbrv> 태그를 찾다 0건 → 매 호출
  // "약칭 데이터가 없습니다"(isError)만 반환했다. 실제 항목 태그는 <law>.
  it("실제 응답 구조(<law> 항목)에서 약칭 목록을 파싱한다", async () => {
    const client = {
      fetchApi: async () => LSABRV_XML,
    } as unknown as LawApiClient

    const result = await getLawAbbreviations(client, {})
    expect(result.isError).toBeUndefined()
    const text = textOf(result)
    expect(text).toContain("화학물질관리법 → 약칭: 화관법 (ID: 000162)")
  })

  it("총계는 조회 건수(2)가 아니라 법제처 totalCnt(2686)", async () => {
    const client = {
      fetchApi: async () => LSABRV_XML,
    } as unknown as LawApiClient
    const text = textOf(await getLawAbbreviations(client, {}))
    expect(text).toContain("법령 약칭 목록 (총 2686건 중 2건 조회")
  })

  it("display=100을 API에 전달한다 (미전달 시 기본 20건 잘림)", async () => {
    const captured: Array<Record<string, string>> = []
    const client = {
      fetchApi: async (p: { extraParams: Record<string, string> }) => {
        captured.push(p.extraParams)
        return LSABRV_XML
      },
    } as unknown as LawApiClient
    await getLawAbbreviations(client, {})
    expect(captured[0].display).toBe("100")
  })
})
