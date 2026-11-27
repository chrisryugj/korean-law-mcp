import { describe, it, expect, vi, afterEach } from "vitest"
import { parseArticleEffDates, flattenReason, renderLawInfo, getLawInfo } from "./law-info.js"
import type { LawApiClient } from "../lib/api-client.js"

/** 법제처 lawService target=law JSON 의 기본정보(근로기준법 MST 285279, 2026-11-28 실응답 발췌) */
const LAW = {
  기본정보: {
    법령명_한글: "근로기준법", 법령ID: "001872", 법종구분: { content: "법률" }, 소관부처: { content: "고용노동부" },
    전화번호: "044-202-7973", 공포일자: "20260407", 공포번호: "21533", 제개정구분: "일부개정", 시행일자: "20261008",
    조문시행일자문자열: "20261208:제13조,제101조20270101:제44조의4,제116조제1항제2호",
    연락부서: { 부서단위: [
      { 부서명: "근로기준정책과 - 임금", 부서연락처: "044-202-7548" },
      { 부서명: "근로기준정책과 - 해고, 취업규칙, 기타", 부서연락처: "044-202-7534" },
    ] },
  },
  제개정이유: { 제개정이유내용: [["[일부개정]", "◇ 개정이유 및 주요내용", "  임금체불 관련 법정형을 상향하려는 것임.", "<법체저 제공>"]] },
}

describe("get_law_info", () => {
  it("조문시행일자문자열은 날짜 사이 구분자 없이 이어 붙어 온다", () => {
    expect(parseArticleEffDates(LAW.기본정보.조문시행일자문자열)).toEqual([
      ["2026-12-08", "제13조, 제101조"],
      ["2027-01-01", "제44조의4, 제116조제1항제2호"],
    ])
    expect(parseArticleEffDates("")).toEqual([])
  })

  it("제개정이유는 중첩 배열을 펴고 법제처 제공 꼬리(오타 포함)는 뺀다", () => {
    expect(flattenReason(LAW.제개정이유.제개정이유내용)).toEqual(["[일부개정]", "◇ 개정이유 및 주요내용", "임금체불 관련 법정형을 상향하려는 것임."])
  })

  it("카드에 소관부처·대표 전화·업무별 담당부서·조문별 시행일·제개정이유·시행예정을 싣는다", () => {
    const t = renderLawInfo(LAW, "🔜 시행예정 한 줄\n", "285279")
    expect(t).toContain("법령 기본정보: 근로기준법 (법률, 법령ID 001872, MST 285279)")
    expect(t).toContain("소관부처: 고용노동부 · 대표 전화 044-202-7973")
    expect(t).toContain("공포: 2026-04-07 제21533호 (일부개정) · 시행: 2026-10-08")
    expect(t).toContain("- 근로기준정책과 - 임금: 044-202-7548")
    expect(t).toContain("- 2027-01-01: 제44조의4, 제116조제1항제2호")
    expect(t).toContain("임금체불 관련 법정형을 상향하려는 것임.")
    expect(t).not.toContain("제공>")
    expect(t).toContain("🔜 시행예정 한 줄")
  })

  it("부서가 하나면 단일 객체로 온다", () => {
    const one = { ...LAW, 기본정보: { ...LAW.기본정보, 연락부서: { 부서단위: { 부서명: "노동정책과", 부서연락처: "044-1" } } } }
    expect(renderLawInfo(one, "", "")).toContain("- 노동정책과: 044-1")
  })

  it("mst 로 부르면 그 MST 본문을 받아 카드를 낸다(시행예정 확인 실패는 침묵하지 않음)", async () => {
    const client = {
      getLawText: vi.fn(async () => JSON.stringify({ 법령: LAW })),
      searchLaw: vi.fn(async () => { throw new Error("down") }),
    } as unknown as LawApiClient
    const r = await getLawInfo(client, { mst: "285279", includeReason: true })
    expect((client.getLawText as any).mock.calls[0][0]).toMatchObject({ mst: "285279", jo: undefined })
    expect(r.isError).toBeUndefined()
    expect(r.content[0].text).toContain("담당부서(업무별):")
    expect(r.content[0].text).toContain("시행예정")
  })
})
