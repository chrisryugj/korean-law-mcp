import { describe, expect, it, vi } from "vitest"
import type { LawApiClient } from "../lib/api-client.js"
import { getDelegatedOrdinances } from "./delegated-ordinances.js"

const law = JSON.stringify({ 법령: { 기본정보: { 법령명_한글: "주차장법" }, 조문: { 조문단위: [
  { 조문여부: "조문", 조문번호: "12", 조문제목: "노외주차장의 설치", 조문내용: "제12조(노외주차장의 설치)", 항: [{ 항내용: "① 설치 기준은 국토교통부령으로 정한다." }, { 항내용: "⑥ 사용료는 해당 지방자치단체의 조례로 정한다." }] },
  { 조문여부: "조문", 조문번호: "19", 조문제목: "부설주차장", 조문내용: "제19조(부설주차장) 설치하여야 한다." },
] } } })
const lnk = `<lnkOrdJoSearch><totalCnt>2</totalCnt><law><법령조문>제12조</법령조문><자치법규명>서울특별시 광진구 주차장 설치 및 관리 조례</자치법규명></law><law><법령조문>제12조</법령조문><자치법규명>부산광역시 주차장 조례</자치법규명></law></lnkOrdJoSearch>`

describe("get_delegated_ordinances", () => {
  it("조례 위임 문구가 든 항만 뽑고, 연결 조례를 지자체로 거른다", async () => {
    const client = {
      getLawText: vi.fn(async () => law),
      fetchApi: vi.fn(async () => lnk),
    } as unknown as LawApiClient
    const t = (await getDelegatedOrdinances(client, { lawId: "001234", region: "광진구" })).content[0].text
    expect(t).toContain("조례로 정하도록 위임한 조 1개")
    expect(t).toContain("⑥ 사용료는 해당 지방자치단체의 조례로 정한다.")
    expect(t).not.toContain("국토교통부령으로")
    expect(t).toContain("광진구 주차장")
    expect(t).not.toContain("부산광역시")
  })
})
