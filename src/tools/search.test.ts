import { describe, it, expect } from "vitest"
import { searchLaw } from "./search.js"
import { hasRelatedHit } from "./search-hits.js"
import type { LawApiClient } from "../lib/api-client.js"

const hit = (name: string, abbr = "") => ({
  name, abbr, lawId: "0", mst: "0", promDate: "", effDate: "", statusCode: "현행", lawType: "법률",
})

// 법제처 API가 "AI법" 쿼리에 검색어를 무시하고 가나다순 전체 목록을 반환하던 사례:
// 무관한 목록을 확장쿼리 결과로 채택하면 안 됨
describe("hasRelatedHit", () => {
  it("법령명이 쿼리를 포함하면 true", () => {
    expect(hasRelatedHit([hit("화학물질관리법 시행령")], "화학물질관리법")).toBe(true)
  })

  it("쿼리가 법령명을 포함해도 true (조문 꼬리 붙은 확장쿼리)", () => {
    expect(hasRelatedHit([hit("화학물질관리법")], "화학물질관리법 제5조")).toBe(true)
  })

  it("약칭 매칭도 인정", () => {
    expect(hasRelatedHit([hit("산업안전보건법", "산안법")], "산안법")).toBe(true)
  })

  it("무관한 목록(쿼리 무시 응답)은 false", () => {
    const junk = [hit("가맹사업거래의 공정화에 관한 법률"), hit("긴급복지지원법"), hit("도시철도법")]
    expect(hasRelatedHit(junk, "AI법")).toBe(false)
  })
})

// ── display 하한 (#89) ────────────────────────────────
// 법제처는 LIKE 검색 + 가나다순이라 "민법"의 정확매칭이 "난민법…" 뒤에 온다.
// display를 업스트림에 그대로 넘기면 정확/부분 분리 전에 잘려 정확매칭이 유실된다.
const lawXml = (names: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><LawSearch>` +
  names.map((n, i) =>
    `<law id="${i}"><법령명한글><![CDATA[${n}]]></법령명한글><법령ID>${1000 + i}</법령ID>` +
    `<법령일련번호>${20000 + i}</법령일련번호><공포일자>20240101</공포일자><시행일자>20240101</시행일자>` +
    `<현행연혁코드>현행</현행연혁코드><법령구분명>법률</법령구분명></law>`).join("") +
  `</LawSearch>`

// 실측 순서: 난민법 → 난민법 시행령 → 난민법 시행규칙 → 민법 (민법이 4번째)
const KANA_ORDER = ["난민법", "난민법 시행령", "난민법 시행규칙", "민법", "민법 시행령"]

function displaySpyStub(names: string[]) {
  const seen: number[] = []
  const client = {
    searchLaw: async (_q: string, _key: string | undefined, display?: number) => {
      seen.push(Number(display))
      return lawXml(names.slice(0, Number(display)))
    },
    fetchApi: async () => `<?xml version="1.0" encoding="UTF-8"?><LawSearch></LawSearch>`,
  } as unknown as LawApiClient
  return { client, seen }
}

describe("search_law display 하한 (#89)", () => {
  it("display가 작아도 정확매칭이 살아남는다", async () => {
    const { client } = displaySpyStub(KANA_ORDER)
    const r = await searchLaw(client, { query: "민법", display: 3 })
    const text = r.content[0].text
    expect(text).toContain("📍 정확매칭")
    expect(text).not.toContain("⚠️ 정확매칭 없음")
  })

  it("업스트림에는 하한 이상으로 요청한다", async () => {
    const { client, seen } = displaySpyStub(KANA_ORDER)
    await searchLaw(client, { query: "민법 하한확인", display: 3 })
    expect(seen[0]).toBeGreaterThanOrEqual(50)
  })

  it("사용자가 요청한 display는 결과 항목 수로 지켜진다", async () => {
    const { client } = displaySpyStub(KANA_ORDER)
    const r = await searchLaw(client, { query: "민법 개수확인", display: 2 })
    const shown = (r.content[0].text.match(/^\d+\. /gm) || []).length
    expect(shown).toBeLessThanOrEqual(2)
  })

  it("display를 크게 주면 그대로 업스트림에 전달한다", async () => {
    const { client, seen } = displaySpyStub(KANA_ORDER)
    await searchLaw(client, { query: "민법 큰값", display: 100 })
    expect(seen[0]).toBe(100)
  })
})

// ── 옛 법령명 안내 (v4.15.0) ────────────────────────────
describe("searchLaw — 옛 법령명으로 찾으면 현행 명칭을 알린다", () => {
  const OLD = "화재예방, 소방시설 설치ㆍ유지 및 안전관리에 관한 법률"
  const NEW = "소방시설 설치 및 관리에 관한 법률"
  const row = (name: string, id: string, st: string) =>
    `<law id="1"><법령명한글><![CDATA[${name}]]></법령명한글><법령ID>${id}</법령ID><법령일련번호>236977</법령일련번호>` +
    `<공포일자>20211130</공포일자><시행일자>20241201</시행일자><현행연혁코드>${st}</현행연혁코드><법령구분명>법률</법령구분명></law>`
  const client = (seen: string[]) => ({
    searchLaw: async (q: string, _k?: string, _d?: number, target?: string, nw?: string) => {
      seen.push(`${target ?? "law"}:${nw ?? ""}:${q}`)
      if (target === "eflaw" && nw === "2") return `<LawSearch></LawSearch>`       // 시행예정 없음
      if (target === "eflaw") return `<LawSearch>${row(OLD, "009503", "연혁")}</LawSearch>`
      return `<LawSearch>${row(NEW, "009503", "현행")}</LawSearch>`
    },
    fetchApi: async () => `<LawSearch></LawSearch>`,
  }) as unknown as LawApiClient

  it("연혁 검색에서 같은 법령ID를 찾아 📛 안내를 붙인다", async () => {
    const seen: string[] = []
    const text = (await searchLaw(client(seen), { query: OLD, display: 50 })).content[0].text
    expect(text).toContain(`「${OLD}」은(는) 옛 법령명입니다`)
    expect(text).toContain(`현행은 「${NEW}」(법령ID 009503`)
    expect(text).not.toContain("정확매칭 없음")
  })

  it("법령명 꼴이 아닌 키워드 검색은 연혁을 더 묻지 않는다", async () => {
    const seen: string[] = []
    await searchLaw(client(seen), { query: "소방시설 설치", display: 50 })
    expect(seen.filter(s => s.startsWith("eflaw::"))).toEqual([])
  })
})
