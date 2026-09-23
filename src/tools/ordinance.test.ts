import { describe, it, expect } from "vitest"
import { getOrdinance, GetOrdinanceSchema } from "./ordinance.js"
import type { LawApiClient } from "../lib/api-client.js"

// 2026-09-23 리뷰 D11: 실측 자치법규 본문(target=ordin, MST=1589887) 축약. 자치법규기본정보는 원문 그대로다.
// 공포일자는 최신 공포본(일부개정)의 날짜인데 "제정일"로 찍혀 제정일을 잘못 알렸다.
const ORDIN_JSON = JSON.stringify({
  LawService: {
    자치법규기본정보: {
      자치법규명: "서울특별시 강남구 민영주차장 설치자금 융자 및 보조금 시행규칙",
      지자체기관명: "서울특별시 강남구",
      시행일자: "20210416",
      제개정정보: "일부개정",
      담당부서명: "교통행정과 주차시설팀",
      공포일자: "20210416",
    },
    조문: {
      조: [
        { 조문번호: ["000100", "000100"], 조제목: "목적", 조내용: "제1조(목적) 이 규칙은 …" },
        { 조문번호: ["000200", "000200"], 조제목: "심의위원회 구성", 조내용: "제2조(심의위원회 구성) …" },
      ],
    },
  },
})

describe("getOrdinance: 공포일자를 제정일로 표기하지 않는다 (D11)", () => {
  it("공포일과 제개정 구분을 함께 싣는다", async () => {
    const client = { getOrdinance: async () => ORDIN_JSON } as unknown as LawApiClient
    const r = await getOrdinance(client, GetOrdinanceSchema.parse({ ordinSeq: "1589887" }))
    const t = r.content[0].text
    expect(t).toContain("공포일: 20210416")
    expect(t).toContain("제개정: 일부개정")
    expect(t).not.toContain("제정일:")
  })
})
