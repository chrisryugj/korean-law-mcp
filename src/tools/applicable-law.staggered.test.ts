import { describe, it, expect, beforeEach } from "vitest"
import { applicableLaw } from "./applicable-law.js"
import { parseEffectiveSlices } from "../lib/historical-utils.js"
import { lawCache } from "../lib/cache.js"
import type { LawApiClient } from "../lib/api-client.js"

// ── 라이브 캡처 픽스처 (2026-07-19, OC만 test로 마스킹) ──────────────────────
// lawSearch.do?target=eflaw&query=소득세법&efYd=20100311~20100501 실응답.
// 법률 제9897호(2009.12.31. 일부개정)는 조항별 시행일 4개(분리시행) 중
// 2010.4.1. 시행분이 이 구간에 걸린다 — lsHistory에는 2010.1.1. 한 행만 있다.
const EFLAW_SLICE_XML = `<?xml version="1.0" encoding="UTF-8"?><LawSearch><target>eflaw</target><키워드>소득세법</키워드><section>lawNm</section><totalCnt>4</totalCnt><page>1</page><numOfRows>4</numOfRows><resultCode>00</resultCode><resultMsg>success</resultMsg><law id="1"><법령일련번호>131405</법령일련번호><현행연혁코드>연혁</현행연혁코드><법령명한글><![CDATA[소득세법]]></법령명한글><법령약칭명><![CDATA[]]></법령약칭명><법령ID>001565</법령ID><공포일자>20091231</공포일자><공포번호>09897</공포번호><제개정구분명>일부개정</제개정구분명><소관부처코드>1053000</소관부처코드><소관부처명>재정경제부</소관부처명><법령구분명>법률</법령구분명><공동부령정보></공동부령정보><시행일자>20100401</시행일자><자법타법여부></자법타법여부><법령상세링크>/DRF/lawService.do?OC=test&amp;target=eflaw&amp;MST=131405&amp;type=HTML&amp;mobileYn=&amp;efYd=20100401</법령상세링크></law><law id="2"><법령일련번호>104809</법령일련번호><현행연혁코드>연혁</현행연혁코드><법령명한글><![CDATA[소득세법 시행규칙]]></법령명한글><법령약칭명><![CDATA[]]></법령약칭명><법령ID>007507</법령ID><공포일자>20100430</공포일자><공포번호>00154</공포번호><제개정구분명>일부개정</제개정구분명><소관부처코드>1053000</소관부처코드><소관부처명>재정경제부</소관부처명><법령구분명>기획재정부령</법령구분명><공동부령정보></공동부령정보><시행일자>20100430</시행일자><자법타법여부></자법타법여부><법령상세링크>/DRF/lawService.do?OC=test&amp;target=eflaw&amp;MST=104809&amp;type=HTML&amp;mobileYn=&amp;efYd=20100430</법령상세링크></law><law id="3"><법령일련번호>102729</법령일련번호><현행연혁코드>연혁</현행연혁코드><법령명한글><![CDATA[소득세법 시행령]]></법령명한글><법령약칭명><![CDATA[]]></법령약칭명><법령ID>003956</법령ID><공포일자>20100218</공포일자><공포번호>22034</공포번호><제개정구분명>일부개정</제개정구분명><소관부처코드>1053000</소관부처코드><소관부처명>재정경제부</소관부처명><법령구분명>대통령령</법령구분명><공동부령정보></공동부령정보><시행일자>20100401</시행일자><자법타법여부></자법타법여부><법령상세링크>/DRF/lawService.do?OC=test&amp;target=eflaw&amp;MST=102729&amp;type=HTML&amp;mobileYn=&amp;efYd=20100401</법령상세링크></law><law id="4"><법령일련번호>103245</법령일련번호><현행연혁코드>연혁</현행연혁코드><법령명한글><![CDATA[소득세법 시행령]]></법령명한글><법령약칭명><![CDATA[]]></법령약칭명><법령ID>003956</법령ID><공포일자>20100315</공포일자><공포번호>22075</공포번호><제개정구분명>타법개정</제개정구분명><소관부처코드>1053000</소관부처코드><소관부처명>재정경제부</소관부처명><법령구분명>대통령령</법령구분명><공동부령정보></공동부령정보><시행일자>20100319</시행일자><자법타법여부></자법타법여부><법령상세링크>/DRF/lawService.do?OC=test&amp;target=eflaw&amp;MST=103245&amp;type=HTML&amp;mobileYn=&amp;efYd=20100319</법령상세링크></law></LawSearch>`

// lawService.do?target=law&MST=228817(중대재해법) 실응답에서 부칙만 발췌.
// 부칙단위가 배열이 아닌 단일 객체, 부칙내용이 중첩 배열인 실형상 그대로.
const JUNGDAEJAEHAE_ADDENDUM_JSON = `{"법령": {"부칙": {"부칙단위": {"부칙키": "2021012617907", "부칙공포일자": "20210126", "부칙내용": [["부칙 <제17907호,2021.1.26>", "제1조(시행일) ① 이 법은 공포 후 1년이 경과한 날부터 시행한다. 다만, 이 법 시행 당시 개인사업자 또는 상시 근로자가 50명 미만인 사업 또는 사업장(건설업의 경우에는 공사금액 50억원 미만의 공사)에 대해서는 공포 후 3년이 경과한 날부터 시행한다. ", "  ② 제1항에도 불구하고 제16조는 공포한 날부터 시행한다.", "제2조(다른 법률의 개정) 법원조직법 중 일부를 다음과 같이 개정한다.", "  제32조제1항제3호에 아목을 다음과 같이 신설한다.", "      아. 「중대재해 처벌 등에 관한 법률」 제6조제1항ㆍ제3항 및 제10조제1항에 해당하는 사건"]], "부칙공포번호": "17907"}}}}`

const EFLAW_EMPTY_XML = `<?xml version="1.0" encoding="UTF-8"?><LawSearch><target>eflaw</target><totalCnt>0</totalCnt><page>1</page><resultCode>00</resultCode><resultMsg>success</resultMsg></LawSearch>`

// ── 포맷 일치 스텁 헬퍼 ──────────────────────────────────────────────────────
const searchXml = (lawName: string, mst: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><LawSearch><totalCnt>1</totalCnt>` +
  `<law id="1"><법령일련번호>${mst}</법령일련번호><법령명한글><![CDATA[${lawName}]]></법령명한글><법령ID>000001</법령ID><법령구분명>법률</법령구분명></law>` +
  `</LawSearch>`

const histRow = (lawNm: string, mst: string, efYd: string, ancNo: string, ancYmd: string, rrCls: string) =>
  `<tr><td><a href="/lsInfoP.do?MST=${mst}&efYd=${efYd}">${lawNm}</a></td><td>제${ancNo}호</td><td>${ancYmd}</td><td>${rrCls}</td></tr>`

const histPage = (totalCount: number, rows: string[]) =>
  `<html><body><strong>${totalCount}</strong> 건<table>${rows.join("\n")}</table></body></html>`

type FetchApiParams = { endpoint: string; target: string; extraParams?: Record<string, string> }

describe("parseEffectiveSlices — eflaw 분리시행 슬라이스 파싱 (라이브 캡처)", () => {
  it("정확 명칭 일치(본법)만 남기고 시행령·규칙을 걸러낸다", () => {
    const slices = parseEffectiveSlices(EFLAW_SLICE_XML, "소득세법")
    expect(slices).toHaveLength(1)
    expect(slices[0]).toMatchObject({
      mst: "131405",
      efYd: "20100401",
      ancNo: "9897",       // "09897" 0패딩 제거
      ancYd: "20091231",
      rrCls: "일부개정",
    })
  })

  it("대상 법령이 없으면 빈 배열", () => {
    expect(parseEffectiveSlices(EFLAW_EMPTY_XML, "소득세법")).toEqual([])
  })
})

describe("applicableLaw — 분리시행(단계 시행일) 보정", () => {
  beforeEach(() => lawCache.clear())

  it("lsHistory가 놓친 후속 시행분(제9897호 2010.4.1.)으로 보정한다", async () => {
    // 회귀: lsHistory는 제9897호를 2010.1.1. 한 행으로만 노출 → 종전 코드는
    // 2010.5.1. 기준일에 [시행 2010.3.10.] 제9763호를 확신 출력했다 (오답).
    const client = {
      searchLaw: async () => searchXml("소득세법", "94269"),
      fetchApi: async (p: FetchApiParams) => {
        if (p.target === "lsHistory") {
          return histPage(2, [
            histRow("소득세법", "94269", "20100310", "9763", "2009.06.09", "타법개정"),
            histRow("소득세법", "98343", "20100101", "9924", "2010.01.01", "타법개정"),
          ])
        }
        if (p.target === "eflaw") return EFLAW_SLICE_XML
        if (p.target === "law") return `{"법령":{"부칙":{"부칙단위":[]}}}`
        throw new Error(`unexpected target: ${p.target}`)
      },
    } as unknown as LawApiClient

    const r = await applicableLaw(client, { lawName: "소득세법", date: "2010-05-01" })
    const text = r.content[0].text
    expect(text).toContain("[시행 2010.4.1.]")
    expect(text).toContain("(MST 131405)")
    expect(text).toContain("제9897호")
    expect(text).toContain("분리시행 보정")
    expect(text).not.toContain("[시행 2010.3.10.]")
  })

  it("슬라이스 조회가 실패해도 lsHistory 결과로 진행한다 (보수적)", async () => {
    const client = {
      searchLaw: async () => searchXml("소득세법", "94269"),
      fetchApi: async (p: FetchApiParams) => {
        if (p.target === "lsHistory") {
          return histPage(1, [histRow("소득세법", "94269", "20100310", "9763", "2009.06.09", "타법개정")])
        }
        if (p.target === "eflaw") throw new Error("eflaw down")
        if (p.target === "law") return `{"법령":{"부칙":{"부칙단위":[]}}}`
        throw new Error(`unexpected target: ${p.target}`)
      },
    } as unknown as LawApiClient

    const r = await applicableLaw(client, { lawName: "소득세법", date: "2010-05-01" })
    const text = r.content[0].text
    expect(text).toContain("[시행 2010.3.10.]")
    expect(text).not.toContain("분리시행 보정")
  })
})

describe("applicableLaw — 적용 버전 자신의 부칙 발췌 (laterVersions 없음)", () => {
  beforeEach(() => lawCache.clear())

  it("유일 버전(중대재해법)의 부칙 유예조항이 발췌된다", async () => {
    // 회귀: 종전 코드는 laterVersions.length > 0일 때만 부칙을 조회해,
    // 제정 이후 개정이 없는 법령은 자기 부칙(50명 미만 3년 유예)이 통째로 빠졌다.
    const LAW = "중대재해 처벌 등에 관한 법률"
    const client = {
      searchLaw: async () => searchXml(LAW, "228817"),
      fetchApi: async (p: FetchApiParams) => {
        if (p.target === "lsHistory") {
          return histPage(1, [histRow(LAW, "228817", "20220127", "17907", "2021.01.26", "제정")])
        }
        if (p.target === "eflaw") return EFLAW_EMPTY_XML
        if (p.target === "law") return JUNGDAEJAEHAE_ADDENDUM_JSON
        throw new Error(`unexpected target: ${p.target}`)
      },
    } as unknown as LawApiClient

    const r = await applicableLaw(client, { lawName: LAW, date: "2022-01-27" })
    const text = r.content[0].text
    expect(text).toContain("[시행 2022.1.27.]")
    expect(text).toContain("적용례·경과조치 발췌")
    expect(text).toContain("50명 미만")
  })
})

describe("applicableLaw — 조문 응답 정직성 (jo 검증)", () => {
  beforeEach(() => lawCache.clear())

  it("JO 파라미터가 무시된 열화 응답(엉뚱한 조문)이면 NOT_FOUND로 정직하게 알린다", async () => {
    // 회귀: extractJoText가 '첫 조문 단위'를 무조건 집어, 제44조를 물었는데
    // 제1조 본문을 제44조라며 확신 출력할 수 있었다.
    const client = {
      searchLaw: async () => searchXml("소득세법", "94269"),
      fetchApi: async (p: FetchApiParams) => {
        if (p.target === "lsHistory") {
          return histPage(1, [histRow("소득세법", "94269", "20100310", "9763", "2009.06.09", "타법개정")])
        }
        if (p.target === "eflaw") return EFLAW_EMPTY_XML
        if (p.target === "law") return `{"법령":{"부칙":{"부칙단위":[]}}}`
        throw new Error(`unexpected target: ${p.target}`)
      },
      getLawText: async () =>
        `{"법령":{"조문":{"조문단위":[{"조문여부":"조문","조문번호":"1","조문내용":"제1조(목적) 이 법은 …"}]}}}`,
    } as unknown as LawApiClient

    const r = await applicableLaw(client, { lawName: "소득세법", date: "2010-05-01", jo: "제44조" })
    const text = r.content[0].text
    expect(text).toContain("[NOT_FOUND] 해당 버전에서 제44조를 찾지 못했습니다")
    expect(text).not.toContain("제1조(목적)")
  })
})
