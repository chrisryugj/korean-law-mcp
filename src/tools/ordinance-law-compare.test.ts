import { describe, expect, it, vi } from "vitest"
import type { LawApiClient } from "../lib/api-client.js"
import { compareOrdinanceWithLaw } from "./ordinance-law-compare.js"

describe("compare_ordinance_with_law", () => {
  it("조례 조문 아래 그 조가 인용한 근거법 항을 오늘 문구로 붙인다", async () => {
    const client = {
      getOrdinance: vi.fn(async () => JSON.stringify({ LawService: { 자치법규기본정보: { 자치법규명: "서울특별시 광진구 주차장 설치 및 관리 조례" }, 조문: { 조: [
        { 조제목: "목적", 조내용: "제1조(목적) 이 조례는 「주차장법」에서 위임한 사항을 정한다." },
        { 조제목: "사용료", 조내용: "제15조(사용료) ③ 법 제12조제6항에 따라 사용료를 감면한다." },
      ] } } })),
      searchLaw: vi.fn(async () => `<LawSearch><law><법령명한글>주차장법</법령명한글><법령ID>001234</법령ID><법령일련번호>300</법령일련번호><시행일자>20260227</시행일자></law></LawSearch>`),
      getLawText: vi.fn(async () => JSON.stringify({ 법령: { 조문: { 조문단위: [{ 조문여부: "조문", 조문번호: "12", 조문내용: "제12조(노외주차장의 설치)", 항: [{ 항번호: "①", 항내용: "① 설치한다." }, { 항번호: "⑥", 항내용: "⑥ 사용료는 조례로 정한다." }] }] } } })),
    } as unknown as LawApiClient
    const t = (await compareOrdinanceWithLaw(client, { ordinSeq: "1", jo: "15" })).content[0].text
    expect(t).toContain("━ 조례 제15조")
    expect(t).toContain("↔ 주차장법 제12조제6항")
    expect(t).toContain("⑥ 사용료는 조례로 정한다.")
    expect(t).not.toContain("① 설치한다.")
  })
})
