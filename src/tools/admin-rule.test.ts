import { describe, it, expect } from "vitest"
import { searchAdminRule, getAdminRule, compareAdminRuleOldNew } from "./admin-rule.js"
import { extractDetailIds } from "./search-detail-chain.js"
import type { LawApiClient } from "../lib/api-client.js"

// 실측 응답 축약 (#72).
// lawService.do?target=admrul&ID= 가 받는 값은 '행정규칙일련번호'(13자리)다.
// 종전 체인은 '행정규칙ID'(4~5자리)를 넘겨 전문 조회가 항상 NOT_FOUND 였다.
const SEARCH_XML = `<?xml version="1.0" encoding="UTF-8"?><AdmRulSearch><target>admrul</target><totalCnt>1</totalCnt>
<admrul id="1"><행정규칙일련번호>2100000271110</행정규칙일련번호><행정규칙명><![CDATA[장기요양급여 제공기준 및 급여비용 산정방법 등에 관한 고시]]></행정규칙명><행정규칙종류>고시</행정규칙종류><발령일자>20251230</발령일자><소관부처명>보건복지부</소관부처명><행정규칙ID>36934</행정규칙ID></admrul>
</AdmRulSearch>`

const DETAIL_XML = `<?xml version="1.0" encoding="UTF-8"?><AdmRulService><행정규칙기본정보><행정규칙일련번호>2100000271110</행정규칙일련번호><행정규칙명><![CDATA[장기요양급여 제공기준 및 급여비용 산정방법 등에 관한 고시]]></행정규칙명><행정규칙종류>고시</행정규칙종류><조문형식여부>Y</조문형식여부><행정규칙ID>36934</행정규칙ID></행정규칙기본정보>
<조문내용><![CDATA[제1조(목적) 이 고시는 「노인장기요양보험법」 제13조제3항에 따라 …]]></조문내용>
<조문내용><![CDATA[제64조(급여비용 감액산정의 원칙) …]]></조문내용></AdmRulService>`

// 행정규칙ID(36934)를 넘겼을 때 법제처가 주는 실제 응답
const WRONG_ID_XML = `<?xml version="1.0" encoding="utf-8"?><Law>일치하는 행정규칙이 없습니다.  행정규칙명을 확인하여 주십시오.</Law>`

// 조문 없이 첨부파일로만 제공되는 행정규칙
const ATTACH_ONLY_XML = `<?xml version="1.0" encoding="UTF-8"?><AdmRulService><행정규칙기본정보><행정규칙명><![CDATA[별표만 있는 고시]]></행정규칙명><조문형식여부>N</조문형식여부></행정규칙기본정보></AdmRulService>`

// 신구법 검색 응답은 <oldAndNew> 항목에 신구법* 필드로 온다 (admrul 아님)
const OLDNEW_SEARCH_XML = `<?xml version="1.0" encoding="UTF-8"?><OldAndNewLawSearch><target>admrulOldAndNew</target><totalCnt>1</totalCnt>
<oldAndNew id="1"><신구법일련번호>2100000279208</신구법일련번호><신구법명><![CDATA[장기요양급여비용 청구 및 심사·지급업무 처리기준]]></신구법명><신구법ID>26273</신구법ID><발령일자>20260514</발령일자><소관부처명>보건복지부</소관부처명></oldAndNew>
</OldAndNewLawSearch>`

// 신구법 본문은 <구조문목록>/<신조문목록> 안의 <조문>이며, 개정 부분이 <P>로 감싸여 온다
const OLDNEW_DETAIL_XML = `<?xml version="1.0" encoding="UTF-8"?><AdmRulOldAndNewService>
<구조문_기본정보><행정규칙명><![CDATA[장기요양급여비용 청구 및 심사·지급업무 처리기준]]></행정규칙명><시행일자>20250416</시행일자></구조문_기본정보>
<신조문_기본정보><행정규칙명><![CDATA[장기요양급여비용 청구 및 심사·지급업무 처리기준]]></행정규칙명><시행일자>20260514</시행일자></신조문_기본정보>
<구조문목록><조문 no="1"><![CDATA[제1조(목적) 이 <P>기준은</P> 「노인장기요양보험법」 제38조에 따라 …]]></조문><조문 no="2"><![CDATA[<P><신  설></P>]]></조문></구조문목록>
<신조문목록><조문 no="1"><![CDATA[제1조(목적) 이 <P>고시는</P> 「노인장기요양보험법」 제38조에 따라 …]]></조문><조문 no="2"><![CDATA[<P>제1조의2(정의) …</P>]]></조문></신조문목록>
</AdmRulOldAndNewService>`

const searchStub = (xml: string) => ({ searchAdminRule: async () => xml }) as unknown as LawApiClient
const detailStub = (xml: string) => ({ getAdminRule: async () => xml }) as unknown as LawApiClient
const fetchStub = (xml: string) => ({ fetchApi: async () => xml }) as unknown as LawApiClient

describe("search_admin_rule → get_admin_rule 체인 식별자 (#72)", () => {
  it("검색 출력에서 체인이 뽑는 값은 13자리 행정규칙일련번호", async () => {
    const r = await searchAdminRule(searchStub(SEARCH_XML), { query: "장기요양급여 산정방법 고시", display: 20 })
    expect(extractDetailIds("search_admin_rule", r.content[0].text)).toEqual(["2100000271110"])
  })

  it("행정규칙ID를 넘긴 빈 응답은 식별자 오류로 안내한다", async () => {
    const r = await getAdminRule(detailStub(WRONG_ID_XML), { id: "36934" })
    expect(r.isError).toBe(true)
    const text = r.content[0].text
    expect(text).toContain("행정규칙일련번호")
    // 원인이 식별자인데 법제처 제한으로 뭉뚱그리면 추적이 막힌다
    expect(text).not.toContain("법제처 API 제한")
  })

  it("조문형식여부=N은 첨부파일 전용으로 안내한다", async () => {
    const r = await getAdminRule(detailStub(ATTACH_ONLY_XML), { id: "2100000000000" })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain("조문형식여부=N")
  })

  it("일련번호로 조회하면 조문 본문이 나온다", async () => {
    const r = await getAdminRule(detailStub(DETAIL_XML), { id: "2100000271110" })
    expect(r.isError).toBeFalsy()
    expect(r.content[0].text).toContain("제64조(급여비용 감액산정의 원칙)")
  })
})

describe("compare_admin_rule_old_new — 실형상 파싱", () => {
  it("검색: oldAndNew 항목에서 신구법일련번호를 노출한다", async () => {
    const r = await compareAdminRuleOldNew(fetchStub(OLDNEW_SEARCH_XML), { query: "장기요양급여" })
    const text = r.content[0].text
    expect(text).toContain("장기요양급여비용 청구 및 심사·지급업무 처리기준")
    expect(text).toContain("신구법일련번호: 2100000279208")
  })

  it("본문: 구/신 조문목록을 대조하고 개정 부분을 【 】로 남긴다", async () => {
    const r = await compareAdminRuleOldNew(fetchStub(OLDNEW_DETAIL_XML), { id: "2100000279208" })
    expect(r.isError).toBeFalsy()
    const text = r.content[0].text
    expect(text).toContain("시행일: 20250416 → 20260514")
    expect(text).toContain("[개정 전] 제1조(목적) 이 【기준은】")
    expect(text).toContain("[개정 후] 제1조(목적) 이 【고시는】")
  })

  it("본문: <신  설> 같은 꺾쇠 표기를 태그로 오인해 지우지 않는다", async () => {
    const r = await compareAdminRuleOldNew(fetchStub(OLDNEW_DETAIL_XML), { id: "2100000279208" })
    expect(r.content[0].text).toContain("[개정 전] 【<신  설>】")
  })
})

// 실측 축약 (#159): 조문내용이 <img> 태그뿐이라 "비어 있음" 분기에 걸리지 않고,
// 첨부파일(원문 hwpx/pdf)이 있는데도 안내되지 않던 응답
const IMAGE_ONLY_XML = `<?xml version="1.0" encoding="UTF-8"?><AdmRulService><행정규칙기본정보><행정규칙일련번호>2100000248042</행정규칙일련번호><행정규칙명><![CDATA[(낙동강유역환경청) 수질오염물질의 배출허용기준 중 별도배출허용기준]]></행정규칙명><행정규칙종류>고시</행정규칙종류><조문형식여부>N</조문형식여부></행정규칙기본정보>
<조문내용><![CDATA[(단위: ㎎/ℓ)
<img id="144740515">
</img>
<img id="144740517">
</img>]]></조문내용>
<첨부파일><첨부파일명><![CDATA[별도배출허용기준 지정·고시.pdf]]></첨부파일명><첨부파일링크>http://law.go.kr/flDownload.do?flSeq=144740485
</첨부파일링크></첨부파일></AdmRulService>`

describe("get_admin_rule — 이미지-only 별표 경고 (#159)", () => {
  it("본문이 <img>뿐이면 경고·원문 URL·첨부파일을 앞세운다", async () => {
    const r = await getAdminRule(detailStub(IMAGE_ONLY_XML), { id: "2100000248042" })
    expect(r.isError).toBeFalsy()
    const text = r.content[0].text
    expect(text).toContain("이미지로만 제공되어 텍스트 추출 불가")
    expect(text).toContain("admRulSeq=2100000248042")
    // 첨부파일 링크는 API가 이미 주고 있었는데 "본문이 비어 있지 않다"는 이유로 묻혀 있었다
    expect(text).toContain("flSeq=144740485")
    // 경고가 본문보다 앞 — truncate에 잘려 사라지면 안 된다
    expect(text.indexOf("텍스트 추출 불가")).toBeLessThan(text.indexOf("<img"))
  })

  it("정상 조문에는 경고를 붙이지 않는다", async () => {
    const r = await getAdminRule(detailStub(DETAIL_XML), { id: "2100000271110" })
    expect(r.content[0].text).not.toContain("이미지로만 제공되어")
  })
})
