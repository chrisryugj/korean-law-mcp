import { describe, it, expect } from "vitest"
import { pickVersion, runTimeTravelScenario } from "./time-travel.js"
import type { LawApiClient } from "../../lib/api-client.js"

const v = (mst: string, efYd: string) => ({ mst, efYd, lawNm: "테스트법", ancNo: "1", ancYd: "", rrCls: "일부개정" })

describe("pickVersion — 시행일 빈 값 NaN 오염", () => {
  // 회귀: 필터는 efYd=""를 0으로 폴백해 통과시키는데 정렬은 parseInt("")=NaN을
  // 그대로 써서 비교자가 NaN을 반환 — 정렬이 비결정적이 되어 "해당 시점 시행 버전"이
  // 아닌 버전이 뽑힐 수 있었다.
  it("빈 efYd가 섞여도 기준일 이하 최대 시행일 버전을 뽑는다", () => {
    const versions = [v("A", "20200101"), v("B", ""), v("C", "20230101"), v("D", "20220601")]
    expect(pickVersion(versions, "20240101")?.mst).toBe("C")
  })

  it("빈 efYd만 있으면 그것이라도 반환 (기존 동작 유지)", () => {
    expect(pickVersion([v("B", "")], "20240101")?.mst).toBe("B")
  })

  it("기준일 이전 버전이 없으면 undefined", () => {
    expect(pickVersion([v("C", "20230101")], "20200101")).toBeUndefined()
  })
})

describe("time_travel — 폐지 후 동명 재제정 (종전: 계보 시작 1997.3.13. 전 시점은 '시점 매칭 실패')", () => {
  // 근로기준법 신법 법령ID 001872 는 1997.3.13. 제정부터다. 구법(법령ID 다름)은 이름 일치 lsHistory 에만 있다 (감사 실측 축약)
  const lawRow = (mst: string, efYd: string, rr: string) =>
    `<law id="x"><법령일련번호>${mst}</법령일련번호><법령명한글><![CDATA[근로기준법]]></법령명한글><법령ID>001872</법령ID>` +
    `<공포일자>${efYd}</공포일자><공포번호>1</공포번호><제개정구분명>${rr}</제개정구분명><시행일자>${efYd}</시행일자></law>`
  const tr = (mst: string, efYd: string, rr: string) =>
    `<tr><td><a href="/x?MST=${mst}&amp;efYd=${efYd}" >근로기준법</a></td><td>${rr}</td><td>제 1호</td><td>1990.1.13</td></tr>`
  const body = (text: string) => JSON.stringify({ 법령: { 조문: { 조문단위: [{ 조문여부: "조문", 조문번호: "1", 조문제목: "목적", 조문내용: text }] } } })
  const apiClient = {
    fetchApi: async (p: { target: string, extraParams?: Record<string, string> }) => {
      const ep = p.extraParams || {}
      if (ep.LID) return `<LawSearch><totalCnt>2</totalCnt>${lawRow("283457", "20260820", "타법개정")}${lawRow("53681", "19970313", "제정")}</LawSearch>`
      if (p.target === "lsHistory") return `<html><strong>2</strong> 건<table>${tr("4974", "19970313", "폐지")}${tr("4972", "19900714", "타법개정")}</table></html>`
      return body(ep.MST === "4972" ? "제1조(목적) 구법" : "제1조(목적) 신법")
    },
  } as unknown as LawApiClient

  it("이른 시점은 동명 구법 버전, 사이의 재제정을 조문 체계 변경으로 알린다", async () => {
    const result = await runTimeTravelScenario({
      apiClient,
      query: "근로기준법",
      law: { lawName: "근로기준법", lawId: "001872", mst: "283457", lawType: "법률" },
      extras: { fromDate: "19950501", toDate: "20000101" },
    })
    const text = result.sections.map(s => s.content).join("\n")
    expect(text).toContain("시점 A: 1990.07.14 시행 | MST 4972")
    expect(text).toContain("두 시점 사이 폐지 후 재제정(시행 1997.03.13")
    expect(text).not.toContain("시점 매칭 실패")
  })
})
