import { describe, expect, it, vi } from "vitest"
import type { LawApiClient } from "../lib/api-client.js"
import { lawCache } from "../lib/cache.js"
import { getUpcomingChanges } from "./upcoming-changes.js"

const law = (ef: string, a2: string[], extra = false) => JSON.stringify({ 법령: { 기본정보: { 법령명_한글: "도로교통법", 시행일자: ef }, 조문: { 조문단위: [
  { 조문여부: "조문", 조문번호: "2", 조문제목: "정의", 조문내용: "제2조(정의)", 항: [{ 항내용: "이 법에서 사용하는 용어의 뜻은 다음과 같다.", 호: a2.map(t => ({ 호내용: t })) }] },
  { 조문여부: "조문", 조문번호: "5", 조문제목: "신호", 조문내용: "제5조(신호) 따라야 한다. <개정 2020.1.1>" },
  ...(extra ? [{ 조문여부: "조문", 조문번호: "137", 조문가지번호: "2", 조문제목: "새 조", 조문내용: "제137조의2(새 조) 새 문구" }] : []),
] } } })

describe("get_upcoming_changes", () => {
  it("가장 이른 시행예정본과 오늘 판을 줄 단위로 맞대고, 날짜 표시만 바뀐 조는 뺀다", async () => {
    lawCache.clear()
    const client = {
      searchLaw: vi.fn(async (_q: string, _k: unknown, _d: unknown, target?: string) => target === "eflaw"
        ? `<LawSearch><law><법령명한글>도로교통법</법령명한글><법령ID>001638</법령ID><법령일련번호>999</법령일련번호><시행일자>20261203</시행일자><공포일자>20260601</공포일자><현행연혁코드>시행예정</현행연혁코드><제개정구분명>일부개정</제개정구분명></law></LawSearch>`
        : `<LawSearch><totalCnt>1</totalCnt><law><법령명한글>도로교통법</법령명한글><법령ID>001638</법령ID><법령일련번호>900</법령일련번호></law></LawSearch>`),
      getLawText: vi.fn(async (p: { mst?: string }) => p.mst === "999"
        ? law("20261203", ["1. 도로", "23. 운전 (개정 문구)"], true).replace("<개정 2020.1.1>", "<개정 2026.6.1>")
        : law("20260101", ["1. 도로", "23. 운전"])),
    } as unknown as LawApiClient
    const t = (await getUpcomingChanges(client, { lawName: "도로교통법" })).content[0].text
    expect(t).toContain("시행 2026.12.03")
    expect(t).toContain("- 23. 운전\n+ 23. 운전 (개정 문구)")
    expect(t).toContain("제137조의2(새 조) 신설")
    expect(t).not.toContain("제5조(신호)")
  })
})
