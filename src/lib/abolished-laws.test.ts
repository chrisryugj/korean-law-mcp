import { describe, it, expect } from "vitest"
import {
  parseAbolishedLawsXml,
  buildAbolishedLawNotes,
  parseAdmrulHistoryXml,
  extractAbolitionReason,
  extractSuccessorNames,
  detectAbolishedAdminRule,
} from "./abolished-laws.js"
import { searchAdminRule } from "../tools/admin-rule.js"
import type { LawApiClient } from "./api-client.js"

// 실측 축약: eflaw 검색은 폐지 법령의 전체 연혁을 반환한다 (사법시험법 사례).
// 현행이 살아있는 법령은 최신 이력이 폐지가 아니므로 자연 탈락해야 한다.
const EFLAW_XML = `<?xml version="1.0" encoding="UTF-8"?><LawSearch><target>eflaw</target><totalCnt>5</totalCnt>
<law id="1"><법령명한글><![CDATA[사법시험법]]></법령명한글><법령ID>009198</법령ID><법령일련번호>53674</법령일련번호><시행일자>20060324</시행일자><제개정구분명>일부개정</제개정구분명><현행연혁코드>연혁</현행연혁코드><법령구분명>법률</법령구분명></law>
<law id="2"><법령명한글><![CDATA[사법시험법]]></법령명한글><법령ID>009198</법령ID><법령일련번호>93874</법령일련번호><시행일자>20171231</시행일자><제개정구분명>타법폐지</제개정구분명><현행연혁코드>연혁</현행연혁코드><법령구분명>법률</법령구분명></law>
<law id="3"><법령명한글><![CDATA[사법시험법 시행규칙]]></법령명한글><법령ID>009257</법령ID><법령일련번호>203608</법령일련번호><시행일자>20180529</시행일자><제개정구분명>폐지</제개정구분명><현행연혁코드>연혁</현행연혁코드><법령구분명>법무부령</법령구분명></law>
<law id="4"><법령명한글><![CDATA[변호사시험법]]></법령명한글><법령ID>010225</법령ID><법령일련번호>250001</법령일련번호><시행일자>20250101</시행일자><제개정구분명>일부개정</제개정구분명><현행연혁코드>현행</현행연혁코드><법령구분명>법률</법령구분명></law>
<law id="5"><법령명한글><![CDATA[민사소송법]]></법령명한글><법령ID>001265</법령ID><법령일련번호>93875</법령일련번호><시행일자>20171231</시행일자><제개정구분명>타법폐지</제개정구분명><현행연혁코드>연혁</현행연혁코드><법령구분명>법률</법령구분명></law>
</LawSearch>`

// 실측 축약: nw=2 행정규칙 연혁 검색 (월별납부제도 운영에 관한 고시, 행정규칙ID 37446 고정)
const ADMRUL_HIST_XML = `<?xml version="1.0" encoding="UTF-8"?><AdmRulSearch><target>admrul</target><totalCnt>3</totalCnt>
<admrul id="1"><행정규칙일련번호>2000000023548</행정규칙일련번호><행정규칙명><![CDATA[월별납부제도 운영에 관한 고시]]></행정규칙명><행정규칙종류>고시</행정규칙종류><발령일자>20130506</발령일자><소관부처명>관세청</소관부처명><현행연혁구분>연혁</현행연혁구분><제개정구분명>전부개정</제개정구분명><행정규칙ID>37446</행정규칙ID></admrul>
<admrul id="2"><행정규칙일련번호>2100000238672</행정규칙일련번호><행정규칙명><![CDATA[월별납부제도 운영에 관한 고시]]></행정규칙명><행정규칙종류>고시</행정규칙종류><발령일자>20240402</발령일자><소관부처명>관세청</소관부처명><현행연혁구분>연혁</현행연혁구분><제개정구분명>일부개정</제개정구분명><행정규칙ID>37446</행정규칙ID></admrul>
<admrul id="3"><행정규칙일련번호>2100000250654</행정규칙일련번호><행정규칙명><![CDATA[월별납부제도 운영에 관한 고시]]></행정규칙명><행정규칙종류>고시</행정규칙종류><발령일자>20241211</발령일자><소관부처명>관세청</소관부처명><현행연혁구분>연혁</현행연혁구분><제개정구분명>폐지</제개정구분명><행정규칙ID>37446</행정규칙ID></admrul>
</AdmRulSearch>`

// 실측 축약: 폐지 레코드 본문 — 제개정이유에 통·폐합 후속 고시가 명시된다
const ABOLITION_BODY_XML = `<?xml version="1.0" encoding="UTF-8"?><AdmRulService><행정규칙기본정보><행정규칙명><![CDATA[월별납부제도 운영에 관한 고시]]></행정규칙명></행정규칙기본정보>
<조문내용><![CDATA[「월별납부제도 운영에 관한 고시(관세청 고시 제2024-13호, 2024.4.2)」를 폐지한다.]]></조문내용>
<제개정이유><제개정이유내용>
<![CDATA[◇ 폐지사유]]>
<![CDATA[]]>
<![CDATA[  ○ 관세분야 행정규칙 통ㆍ폐합 가이드라인(규제혁신팀-613호)에 따라 유사 분야 7개 훈령*을 「징수업무 처리에 관한 고시」로 통ㆍ폐합하여 접근성 제고]]>
<![CDATA[    * 「관세 등에 대한 담보제도 운영에 관한 고시」(관세청고시 제2023-69호), 「월별납부제도 운영에 관한 고시」(관세청고시 제2024-13호)]]>
</제개정이유내용></제개정이유></AdmRulService>`

// 제명변경: 구명칭 검색이 0건이지만 같은 행정규칙ID의 현행본이 신명칭으로 존재
const RENAME_HIST_XML = `<?xml version="1.0" encoding="UTF-8"?><AdmRulSearch><totalCnt>2</totalCnt>
<admrul id="1"><행정규칙일련번호>2100000100001</행정규칙일련번호><행정규칙명><![CDATA[수입물품 검사에 관한 고시]]></행정규칙명><행정규칙종류>고시</행정규칙종류><발령일자>20200101</발령일자><소관부처명>관세청</소관부처명><현행연혁구분>연혁</현행연혁구분><제개정구분명>일부개정</제개정구분명><행정규칙ID>55555</행정규칙ID></admrul>
<admrul id="2"><행정규칙일련번호>2100000100002</행정규칙일련번호><행정규칙명><![CDATA[수입물품 안전관리에 관한 고시]]></행정규칙명><행정규칙종류>고시</행정규칙종류><발령일자>20230101</발령일자><소관부처명>관세청</소관부처명><현행연혁구분>현행</현행연혁구분><제개정구분명>일부개정</제개정구분명><행정규칙ID>55555</행정규칙ID></admrul>
</AdmRulSearch>`

const EMPTY_ADMRUL_XML = `<?xml version="1.0" encoding="UTF-8"?><AdmRulSearch><target>admrul</target><totalCnt>0</totalCnt><resultCode>00</resultCode></AdmRulSearch>`

/** 현행(nw 없음)은 0건, 연혁(nw=2)은 histXml을 주는 스텁 */
const histStub = (histXml: string, bodyXml?: string) => ({
  searchAdminRule: async (p: { nw?: string }) => (p.nw === "2" ? histXml : EMPTY_ADMRUL_XML),
  getAdminRule: async () => {
    if (!bodyXml) throw new Error("본문 없음")
    return bodyXml
  },
}) as unknown as LawApiClient

describe("폐지 법령 감지 (eflaw)", () => {
  it("법령ID별 최신 이력이 폐지·타법폐지인 법령만 추출한다", () => {
    const out = parseAbolishedLawsXml(EFLAW_XML, "사법시험법")
    expect(out.map((a) => a.name)).toEqual(["사법시험법", "사법시험법 시행규칙"])
    const main = out.find((a) => a.name === "사법시험법")!
    // 최신 이력(타법폐지 20171231)이 선택돼야 한다 — 중간 연혁(20060324) 아님
    expect(main.mst).toBe("93874")
    expect(main.revisionType).toBe("타법폐지")
  })

  it("쿼리와 무관한 폐지 법령(민사소송법)은 제외한다", () => {
    const out = parseAbolishedLawsXml(EFLAW_XML, "사법시험법")
    expect(out.some((a) => a.name === "민사소송법")).toBe(false)
  })

  it("안내문에 폐지 사실·MST·efYd 조회 힌트·인용 금지 경고를 포함한다", () => {
    const out = parseAbolishedLawsXml(EFLAW_XML, "사법시험법")
    const note = buildAbolishedLawNotes("사법시험법", out)
    expect(note).toContain("[폐지]")
    expect(note).toContain("타법폐지, 최종 시행 2017-12-31")
    expect(note).toContain('get_law_text(mst="93874", efYd="20171231")')
    expect(note).toContain("현행 기준으로 인용하지 마세요")
  })
})

describe("폐지 행정규칙 감지 (nw=2)", () => {
  it("연혁 XML을 필드별로 파싱한다", () => {
    const hits = parseAdmrulHistoryXml(ADMRUL_HIST_XML)
    expect(hits).toHaveLength(3)
    expect(hits[2]).toMatchObject({ seq: "2100000250654", revisionType: "폐지", ruleId: "37446" })
  })

  it("폐지사유 CDATA를 줄 단위로 복원한다", () => {
    const reason = extractAbolitionReason(ABOLITION_BODY_XML)
    expect(reason).toContain("◇ 폐지사유")
    expect(reason).toContain("통ㆍ폐합하여 접근성 제고")
  })

  it("후속 규정명을 추출하고 자기 자신은 제외한다", () => {
    const reason = extractAbolitionReason(ABOLITION_BODY_XML)
    const successors = extractSuccessorNames(reason, ["월별납부제도 운영에 관한 고시"])
    expect(successors).toEqual(["징수업무 처리에 관한 고시"])
  })

  it("end-to-end: 폐지 안내에 폐지일·직전 버전·폐지사유·후속 규정이 담긴다", async () => {
    const note = await detectAbolishedAdminRule(histStub(ADMRUL_HIST_XML, ABOLITION_BODY_XML), "월별납부제도 운영에 관한 고시")
    expect(note).not.toBeNull()
    expect(note).toContain("2024-12-11 폐지")
    expect(note).toContain('execute_tool(tool_name="get_admin_rule", params={id:"2100000238672"})') // 폐지 직전 버전
    expect(note).toContain("징수업무 처리에 관한 고시")
    expect(note).toContain("폐지된 행정규칙을 현행 기준으로 인용하지 마세요")
  })

  it("본문 조회가 실패해도 폐지 사실 안내는 유지된다", async () => {
    const note = await detectAbolishedAdminRule(histStub(ADMRUL_HIST_XML), "월별납부제도 운영")
    expect(note).toContain("2024-12-11 폐지")
    expect(note).toContain("후속 규정 자동 추출 실패")
  })

  it("제명변경: 현행본이 신명칭으로 살아있으면 신명칭으로 안내한다", async () => {
    const note = await detectAbolishedAdminRule(histStub(RENAME_HIST_XML), "수입물품 검사에 관한 고시")
    expect(note).toContain("[제명변경]")
    expect(note).toContain("수입물품 안전관리에 관한 고시")
    expect(note).toContain('execute_tool(tool_name="get_admin_rule", params={id:"2100000100002"})')
  })

  it("연혁도 0건이면 null — 상위의 noResultHint로 폴백한다", async () => {
    const note = await detectAbolishedAdminRule(histStub(EMPTY_ADMRUL_XML), "존재하지않는고시명12345")
    expect(note).toBeNull()
  })
})

describe("search_admin_rule 통합 — 현행 0건 → 폐지 안내", () => {
  it("도구 응답이 noResultHint 대신 폐지 안내를 반환한다", async () => {
    const r = await searchAdminRule(histStub(ADMRUL_HIST_XML, ABOLITION_BODY_XML), { query: "월별납부제도", display: 20 })
    expect(r.isError).toBeFalsy()
    const text = r.content[0].text
    expect(text).toContain("[폐지]")
    expect(text).toContain("징수업무 처리에 관한 고시")
  })
})
