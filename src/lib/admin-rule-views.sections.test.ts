import { describe, it, expect } from "vitest"
import { buildPartialBody } from "./admin-rule-views.js"
import { splitSections } from "./admin-rule-keyword.js"

// 화재안전기술기준(NFTC 103) 본문 형식 — 조문(제N조) 없이 "2.7.3" 절 번호 줄 (2026-09-28 실측 축약)
const NFTC = [
  "2. 기술기준",
  "",
  "2.7 헤드",
  "",
  "2.7.1 스프링클러헤드는 특정소방대상물의 천장ㆍ반자ㆍ덕트ㆍ선반 기타 이와 유사한 부분에 설치해야 한다.",
  "",
  "2.7.3 스프링클러헤드까지의 수평거리는 2.1 m 이하로 해야 한다. 다만, 다음의 장소는 그렇지 않다.",
  "",
  "2.7.3.1 무대부에 있어서는 1.7 m 이하",
  "",
  "2.7.4 폐쇄형스프링클러헤드는 표시온도의 것으로 설치해야 한다.",
  "",
  "2.8 송수구",
  "",
  "2.8.1 송수구는 소방차가 쉽게 접근할 수 있는 위치에 설치할 것",
].join("\n")

describe("조문 체계 없는 행정규칙 — 절 번호 폴백 (NFTC)", () => {
  it("splitSections: 절 번호 줄에서 끊는다", () => {
    const nums = splitSections(NFTC).map(s => s.num)
    expect(nums).toEqual(["2", "2.7", "2.7.1", "2.7.3", "2.7.3.1", "2.7.4", "2.8", "2.8.1"])
  })

  it("jo='2.7.3' → 그 절과 하위 절만", () => {
    const { text } = buildPartialBody(NFTC, NFTC, { jo: "2.7.3" })
    expect(text).toContain("2.1 m 이하")
    expect(text).toContain("2.7.3.1 무대부")
    expect(text).not.toContain("2.7.4")
    expect(text).not.toContain("송수구")
  })

  it("keyword 는 막다른 안내 대신 절 단위로 찾아 준다 (종전: 'keyword 를 사용하세요')", () => {
    const { text } = buildPartialBody(NFTC, NFTC, { keyword: "수평거리" })
    expect(text).not.toContain("조문 체계가 없습니다")
    expect(text).toContain("'수평거리' 포함 1곳: 2.7.3")
    expect(text).toContain("2.1 m 이하")
  })

  it("없는 절은 NOT_FOUND", () => {
    expect(buildPartialBody(NFTC, NFTC, { jo: "9.9.9" }).text).toContain("[NOT_FOUND]")
  })

  it("번호 줄이 없는 항목식 훈령은 빈 줄 문단으로 찾는다", () => {
    const body = "가. 목적\n이 지침은 민원 처리에 관한 사항을 정한다.\n\n나. 처리기한\n민원은 7일 이내에 처리한다."
    const { text } = buildPartialBody(body, body, { keyword: "처리기한" })
    expect(text).toContain("7일 이내")
    expect(text).not.toContain("목적")
  })
})
