import { describe, it, expect } from "vitest"
import { parseUpcomingXml, buildUpcomingNotes } from "./upcoming-laws.js"

// 실제 eflaw 응답 축약 (2026-07 데이터기반행정법 제명변경 사례)
const EFLAW_XML = `<?xml version="1.0" encoding="UTF-8"?><LawSearch><target>eflaw</target>
<law id="1"><법령일련번호>251025</법령일련번호><현행연혁코드>현행</현행연혁코드><법령명한글><![CDATA[데이터기반행정 활성화에 관한 법률]]></법령명한글><법령ID>013792</법령ID><공포일자>20230516</공포일자><공포번호>19408</공포번호><제개정구분명>타법개정</제개정구분명><법령구분명>법률</법령구분명><시행일자>20231117</시행일자></law>
<law id="2"><법령일련번호>283735</법령일련번호><현행연혁코드>시행예정</현행연혁코드><법령명한글><![CDATA[인공지능 및 데이터 기반 행정 활성화에 관한 법률]]></법령명한글><법령ID>013792</법령ID><공포일자>20260227</공포일자><공포번호>21392</공포번호><제개정구분명>일부개정</제개정구분명><법령구분명>법률</법령구분명><시행일자>20270228</시행일자></law>
<law id="3"><법령일련번호>283735</법령일련번호><현행연혁코드>시행예정</현행연혁코드><법령명한글><![CDATA[인공지능 및 데이터 기반 행정 활성화에 관한 법률]]></법령명한글><법령ID>013792</법령ID><공포일자>20260227</공포일자><공포번호>21392</공포번호><제개정구분명>일부개정</제개정구분명><법령구분명>법률</법령구분명><시행일자>20260828</시행일자></law>
</LawSearch>`

describe("parseUpcomingXml", () => {
  it("시행예정만 추출하고 동일 MST의 복수 시행일을 병합한다", () => {
    const out = parseUpcomingXml(EFLAW_XML)
    expect(out).toHaveLength(1)
    expect(out[0].mst).toBe("283735")
    expect(out[0].name).toBe("인공지능 및 데이터 기반 행정 활성화에 관한 법률")
    expect(out[0].effDates).toEqual(["20260828", "20270228"])
    expect(out[0].revisionType).toBe("일부개정")
  })

  it("시행예정이 없으면 빈 배열", () => {
    expect(parseUpcomingXml(EFLAW_XML.replace(/시행예정/g, "연혁"))).toEqual([])
  })
})

describe("buildUpcomingNotes", () => {
  const upcoming = parseUpcomingXml(EFLAW_XML)

  it("법령ID가 같고 이름이 다르면 제명변경 예정으로 표기", () => {
    const notes = buildUpcomingNotes(
      [{ name: "데이터기반행정 활성화에 관한 법률", lawId: "013792" }],
      upcoming
    )
    expect(notes).toContain("제명변경 예정")
    expect(notes).toContain("「데이터기반행정 활성화에 관한 법률」 → 「인공지능 및 데이터 기반 행정 활성화에 관한 법률」")
    expect(notes).toContain("2026-08-28")
    expect(notes).toContain('get_law_text(mst="283735", efYd="20260828")')
  })

  it("법령ID가 같고 이름도 같으면 개정 시행예정으로 표기", () => {
    const notes = buildUpcomingNotes(
      [{ name: "인공지능 및 데이터 기반 행정 활성화에 관한 법률", lawId: "013792" }],
      upcoming
    )
    expect(notes).toContain("개정 시행예정")
    expect(notes).not.toContain("제명변경")
  })

  it("결과에 없는 법령ID는 미시행 신규 법령으로 표기", () => {
    const notes = buildUpcomingNotes([], upcoming)
    expect(notes).toContain("아직 미시행이라 현행 검색에는 없음")
  })

  it("시행예정 없으면 빈 문자열", () => {
    expect(buildUpcomingNotes([], [])).toBe("")
  })
})
