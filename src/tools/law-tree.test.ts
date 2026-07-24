import { describe, it, expect } from "vitest"
import { parseThreeTierText, GetLawTreeSchema } from "./law-tree.js"

// get_three_tier(관세법) 실측 출력 축약 (2026-07 라이브 캡처).
// 종전 스크래퍼는 존재하지 않는 "법률명:"·"법률 조항"·"시행령 조항" 헤더를 찾아
// 유효 입력에도 빈 트리를 반환했다.
const THREE_TIER_TEXT = `법령명: 관세법

---
제4조 제4조(내국세등의 부과ㆍ징수)
---

[시행령] 관세법 시행령 제1조의2 (체납된 내국세등의 세무서장 징수)
①  「관세법」(이하 "법"이라 한다) 제4조제2항에 따라 …
   (위임 내용 862자 중 일부만 표시)

---
제5조
---

[시행령] 관세법 시행령 제1조의3 (관세법 해석에 관한 질의회신의 절차와 방법)
①  재정경제부장관 및 관세청장은 …

[시행규칙] 관세법 시행규칙 제2조 (기한의 계산)
① 법 제8조제3항에서 …
`

describe("parseThreeTierText — 실측 형식 스크래핑", () => {
  it("법령명·법률/시행령/시행규칙 조문을 추출한다 (종전엔 전부 빈 배열)", () => {
    const r = parseThreeTierText(THREE_TIER_TEXT)
    expect(r.lawName).toBe("관세법")
    expect(r.law).toEqual(["제4조", "제5조"])
    expect(r.decree).toEqual(["제1조의2", "제1조의3"])
    expect(r.rule).toEqual(["제2조"])
  })
})

describe("GetLawTreeSchema — 빈 입력 가드", () => {
  // 종전엔 빈 입력이 API까지 가서 13초 뒤 "Unexpected end of JSON input"으로 죽었다
  it("mst/lawId 둘 다 없으면 스키마에서 거부", () => {
    expect(GetLawTreeSchema.safeParse({}).success).toBe(false)
    expect(GetLawTreeSchema.safeParse({ mst: "280363" }).success).toBe(true)
  })
})
