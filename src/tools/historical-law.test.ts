import { describe, it, expect } from "vitest"
import { getHistoricalLaw } from "./historical-law.js"
import type { LawApiClient } from "../lib/api-client.js"

// 실제 eflaw JSON 축약 — 법령명은 "법령명_한글" 키, 소관부처는 {content} 객체로 온다
// (라이브 스모크에서 "법령명: N/A" + "소관부처: [object Object]" 노출로 발견된 실형상)
const HIST_JSON = JSON.stringify({
  법령: {
    기본정보: {
      법령명_한글: "상법",
      시행일자: "20260910",
      공포일자: "20250909",
      공포번호: "21044",
      제개정구분명: "일부개정",
      소관부처: { content: "법무부", 소관부처코드: "1270000" },
    },
    조문: [
      { 조문번호: "1", 조문제목: "목적", 조문내용: ["제1조(목적)", "이 법은 상사에 관하여…"] },
    ],
  },
})

describe("getHistoricalLaw — JSON 객체 필드 안전 문자열화", () => {
  it("소관부처 객체·법령명_한글 키·조문내용 배열을 훼손 없이 출력", async () => {
    const client = {
      fetchApi: async () => HIST_JSON,
    } as unknown as LawApiClient

    const r = await getHistoricalLaw(client, { mst: "273629" })
    const t = r.content[0].text
    expect(t).toContain("법령명: 상법")          // 종전엔 N/A
    expect(t).toContain("소관부처: 법무부")       // 종전엔 [object Object]
    expect(t).toContain("이 법은 상사에")          // 배열 조문내용 평탄화
    expect(t).not.toContain("[object Object]")
  })
})
