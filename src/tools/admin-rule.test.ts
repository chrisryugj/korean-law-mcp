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

// ─── 부분 조회 (jo·chapter·keyword·page) + 캐시 + 제·개정이유 폴백 ───
// 외국환거래규정 실측 형상 축약: 조문내용이 "통짜 1개"로 오는 하이픈형 규칙
import { adminRuleXmlCache } from "../lib/admin-rule-views.js"
import { beforeEach } from "vitest"

const HYPHEN_BLOB = [
  "제1장 총칙",
  "제1-1조(목적) 이 규정은 「외국환거래법」에서 위임된 사항을 정함을 목적으로 한다.",
  "제2장 외국환업무취급기관 등",
  "제2-6조의2 (예금 및 신탁)",
  " ① 예금계정의 종류는 다음과 같다.",
  "제9장 직접투자 및 부동산 취득",
  "제9-5조(해외직접투자의 신고 등)",
  " ① 거주자가 해외직접투자를 하고자 하는 경우 신고하여야 한다.",
  "제9-9조(사후관리)",
  " ① 해외직접투자자는 연간사업실적보고서를 제출하여야 한다.",
].join("\n")

const FX_RULE_XML = `<?xml version="1.0" encoding="UTF-8"?><AdmRulService><행정규칙기본정보><행정규칙일련번호>2100000285140</행정규칙일련번호><행정규칙명><![CDATA[외국환거래규정]]></행정규칙명><행정규칙종류>고시</행정규칙종류><발령일자>20260916</발령일자><발령번호>2026-103</발령번호><조문형식여부>N</조문형식여부></행정규칙기본정보>
<조문내용><![CDATA[${HYPHEN_BLOB}]]></조문내용>
<부칙공포일자>20260916</부칙공포일자><부칙내용><![CDATA[부칙 <제2026-103호, 2026. 9. 16.> 이 규정은 고시한 날부터 시행한다.]]></부칙내용></AdmRulService>`

// 항목식 훈령 (조문 체계 없음)
const ITEMIZED_XML = `<?xml version="1.0" encoding="UTF-8"?><AdmRulService><행정규칙기본정보><행정규칙명><![CDATA[항목식 지침]]></행정규칙명><조문형식여부>N</조문형식여부></행정규칙기본정보>
<조문내용><![CDATA[1. 일반 원칙
  가. 성실히 수행한다.
2. 세부 지침]]></조문내용></AdmRulService>`

// 신구대조 없음 + 제개정이유 있음 (T2 폴백)
const OLDNEW_EMPTY_XML = `<?xml version="1.0" encoding="UTF-8"?><AdmRulOldAndNewService></AdmRulOldAndNewService>`
const FX_RULE_WITH_REASON_XML = FX_RULE_XML.replace("</AdmRulService>",
  `<제개정이유><제개정이유내용><![CDATA[◇ 개정이유]]><![CDATA[  원화 국제화 로드맵에 따라 해외원화업무취급기관 관련 사항을 정비함]]></제개정이유내용></제개정이유></AdmRulService>`)

beforeEach(() => adminRuleXmlCache.clear())

describe("get_admin_rule — 부분 조회 (T1)", () => {
  it("jo:'제9-5조' → 해당 조문 전체, 제1~2장 내용 미포함, 첫머리에 규칙명·공포일 (AC#1)", async () => {
    const r = await getAdminRule(detailStub(FX_RULE_XML), { id: "2100000285140", jo: "제9-5조" })
    const text = r.content[0].text
    expect(r.isError).toBeFalsy()
    expect(text.startsWith("행정규칙명: 외국환거래규정")).toBe(true)
    expect(text).toContain("공포일: 2026.09.16")
    expect(text).toContain("제9-5조(해외직접투자의 신고 등)")
    expect(text).toContain("신고하여야 한다")
    expect(text).not.toContain("제1-1조")
    expect(text).not.toContain("제2-6조의2")
    expect(text).not.toContain("잘렸습니다")
  })

  it("jo:'9-9' 정규화 (AC#2)", async () => {
    const r = await getAdminRule(detailStub(FX_RULE_XML), { id: "2100000285140", jo: "9-9" })
    expect(r.content[0].text).toContain("제9-9조(사후관리)")
  })

  it("jo:'제2-6조의2' — 조의N + 하이픈 병용 (AC#3)", async () => {
    const r = await getAdminRule(detailStub(FX_RULE_XML), { id: "2100000285140", jo: "제2-6조의2" })
    expect(r.content[0].text).toContain("제2-6조의2 (예금 및 신탁)")
  })

  it("chapter:'제9장' → 제9장 조문 전부, 다음 장 미포함 (AC#4)", async () => {
    const r = await getAdminRule(detailStub(FX_RULE_XML), { id: "2100000285140", chapter: "제9장" })
    const text = r.content[0].text
    expect(text).toContain("제9-5조")
    expect(text).toContain("제9-9조")
    expect(text).not.toContain("제1-1조")
  })

  it("keyword:'해외직접투자' → 관련 조문 목록 (AC#5)", async () => {
    const r = await getAdminRule(detailStub(FX_RULE_XML), { id: "2100000285140", keyword: "해외직접투자" })
    const text = r.content[0].text
    expect(text).toContain("제9-5조")
    expect(text).toContain("제9-9조")
    expect(text).not.toContain("제1-1조(목적)")
  })

  it("page: 청크가 겹치지 않고 total_pages를 표기한다 (AC#6)", async () => {
    const p1 = await getAdminRule(detailStub(FX_RULE_XML), { id: "2100000285140", page: 1 })
    expect(p1.content[0].text).toMatch(/페이지 1\/\d+/)
  })

  it("조문 체계 없는 규칙에 jo 요청 → graceful 안내, 에러 아님 (AC#7)", async () => {
    const r = await getAdminRule(detailStub(ITEMIZED_XML), { id: "2100000000001", jo: "제1조" })
    expect(r.isError).toBeFalsy()
    expect(r.content[0].text).toContain("조문 체계가 없습니다")
    expect(r.content[0].text).toContain("keyword 또는 page")
  })

  it("복수 파라미터 → jo만 적용하고 무시 목록을 명시한다", async () => {
    const r = await getAdminRule(detailStub(FX_RULE_XML), { id: "2100000285140", jo: "제9-5조", keyword: "예금", page: 3 })
    const text = r.content[0].text
    expect(text).toContain("'jo'만 적용")
    expect(text).toContain("제9-5조")
  })

  it("없는 조문은 NOT_FOUND + 수록 범위 안내 (추측 금지)", async () => {
    const r = await getAdminRule(detailStub(FX_RULE_XML), { id: "2100000285140", jo: "제99-1조" })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain("[NOT_FOUND]")
    expect(r.content[0].text).toContain("추측/생성하지 마세요")
  })

  it("전문 응답을 캐시해 연속 부분 조회 시 API를 재호출하지 않는다", async () => {
    let calls = 0
    const counting = { getAdminRule: async () => { calls++; return FX_RULE_XML } } as unknown as LawApiClient
    await getAdminRule(counting, { id: "2100000285140", jo: "제9-5조" })
    await getAdminRule(counting, { id: "2100000285140", keyword: "해외직접투자" })
    await getAdminRule(counting, { id: "2100000285140", page: 1 })
    expect(calls).toBe(1)
  })

  it("파라미터 없는 전문 조회는 종전 동작 그대로다 (AC#9 회귀)", async () => {
    const r = await getAdminRule(detailStub(DETAIL_XML), { id: "2100000271110" })
    expect(r.isError).toBeFalsy()
    expect(r.content[0].text).toContain("제64조(급여비용 감액산정의 원칙)")
  })
})

describe("compare_admin_rule_old_new — 제·개정이유 폴백 (T2)", () => {
  it("신구대조 없음 + 제개정이유 있음 → 발령번호·이유 반환, NOT_FOUND 단독으로 끝나지 않는다 (AC#8)", async () => {
    const stub = {
      fetchApi: async () => OLDNEW_EMPTY_XML,
      getAdminRule: async () => FX_RULE_WITH_REASON_XML,
    } as unknown as LawApiClient
    const r = await compareAdminRuleOldNew(stub, { id: "2100000285140" })
    const text = r.content[0].text
    expect(r.isError).toBeFalsy()
    expect(text).toContain("제·개정이유로 대체")
    expect(text).toContain("제2026-103호")
    expect(text).toContain("개정이유")
    expect(text).toContain("원화 국제화 로드맵")
  })

  it("신구대조도 제개정이유도 없으면 API 미제공 안내로 종료 (날조 금지)", async () => {
    const stub = {
      fetchApi: async () => OLDNEW_EMPTY_XML,
      getAdminRule: async () => `<?xml version="1.0" encoding="UTF-8"?><AdmRulService><행정규칙기본정보><행정규칙명><![CDATA[이유 없는 고시]]></행정규칙명></행정규칙기본정보><조문내용><![CDATA[제1조(목적)]]></조문내용></AdmRulService>`,
    } as unknown as LawApiClient
    const r = await compareAdminRuleOldNew(stub, { id: "2100000000002" })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain("제·개정이유도 API 미제공")
    expect(r.content[0].text).toContain("law.go.kr")
  })
})
