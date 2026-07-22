import { describe, it, expect, beforeEach } from "vitest"
import { findLaws, resolvedLawMatches, looseMatchLawName } from "./law-search.js"
import { lawCache } from "./cache.js"
import type { LawApiClient } from "./api-client.js"

// 가나다순으로 「상법」이 24번째에 오는 목록 — 법제처처럼 앞 display건만 잘라 반환.
// 조회량이 작으면 「상법」이 아예 도착하지 못하는 상황을 재현한다.
const NAMES = [
  ...Array.from({ length: 23 }, (_, i) => `가상${String(i + 1).padStart(2, "0")}보상법`),
  "상법",
  "통상법각론", // 뒤쪽 잡음
]

const lawXml = (names: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><LawSearch><totalCnt>${names.length}</totalCnt>` +
  names.map((n, i) =>
    `<law id="${i + 1}"><법령일련번호>${9000 + i}</법령일련번호><법령명한글><![CDATA[${n}]]></법령명한글><법령ID>${1000 + i}</법령ID><법령구분명>법률</법령구분명></law>`
  ).join("") + `</LawSearch>`

function slicingClient(names: string[]) {
  const displays: Array<number | undefined> = []
  const client = {
    searchLaw: async (_q: string, _k?: string, display?: number) => {
      displays.push(display)
      return lawXml(names.slice(0, Math.min(display ?? 20, 100)))
    },
  } as unknown as LawApiClient
  return { client, displays }
}

describe("findLaws — 조회량 기본값", () => {
  beforeEach(() => lawCache.clear())

  it("기본 searchDisplay는 API 상한 100", async () => {
    const { client, displays } = slicingClient(NAMES)
    await findLaws(client, "상법")
    expect(displays[0]).toBe(100)
  })

  // 회귀: 기본 20이던 시절, 가나다순 24번째인 「상법」이 조회에 도달하지 못해
  // applicable_law/impact_map이 무관한 법을 laws[0]으로 잡던 결함
  it("가나다순 뒤쪽의 정확 매칭이 기본값에서 1위로 도착한다", async () => {
    const { client } = slicingClient(NAMES)
    const laws = await findLaws(client, "상법", undefined, 3)
    expect(laws.length).toBeGreaterThan(0)
    expect(laws[0].lawName).toBe("상법")
  })
})

describe("resolvedLawMatches — laws[0] 맹신 방지 가드", () => {
  it("정확/접두 일치 통과", () => {
    expect(resolvedLawMatches("상법", "상법")).toBe(true)
    expect(resolvedLawMatches("화학물질관리법", "화학물질관리법 시행령")).toBe(true)
  })

  it("별칭 입력은 canonical 해소 후 대조 (화관법→화학물질관리법)", () => {
    expect(resolvedLawMatches("화관법", "화학물질관리법")).toBe(true)
  })

  // 「상법」을 물었는데 LIKE 1위가 무관한 법일 때 — 이걸 통과시키면
  // 행위시법 판단·영향 지도가 엉뚱한 법으로 그려진다
  it("무관한 부분매칭은 거부", () => {
    expect(resolvedLawMatches("상법", "1980년해직공무원의보상등에관한특별조치법")).toBe(false)
    expect(resolvedLawMatches("민법", "난민법")).toBe(false)
  })
})

describe("looseMatchLawName (lib 승격 후 동작 유지)", () => {
  it("공백 무시·접두 허용", () => {
    expect(looseMatchLawName("자본시장과 금융투자업에 관한 법률", "자본시장과금융투자업에관한법률")).toBe(true)
    expect(looseMatchLawName("상법", "보상법")).toBe(false)
  })
})
