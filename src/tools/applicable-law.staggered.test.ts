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
    expect(text).toContain("[시행 2010.04.01]")
    expect(text).toContain("(MST 131405)")
    expect(text).toContain("제9897호")
    expect(text).toContain("분리시행 보정")
    expect(text).not.toContain("[시행 2010.03.10]")
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
    expect(text).toContain("[시행 2010.03.10]")
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
    expect(text).toContain("[시행 2022.01.27]")
    expect(text).toContain("적용례·경과조치 발췌")
    expect(text).toContain("50명 미만")
  })

  // 표기 통일: applicable_law만 "2022.1.27."(무패딩·후행점)을 썼고 나머지 도구는
  // formatDateDot의 "2022.01.27"을 쓴다. 같은 날짜가 도구마다 달리 보이면
  // 사용자가 그대로 재인용할 때 표기가 흔들린다.
  it("날짜 표기가 코드베이스 표준(YYYY.MM.DD)을 따른다", async () => {
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
    expect(text).toContain("행위시법 판단: 중대재해 처벌 등에 관한 법률 @ 2022.01.27")
    expect(text).toContain("부칙 <제17907호, 2021.01.26>")
    // 한 자리 월·일에 0을 붙이지 않던 옛 표기가 남아 있으면 안 된다
    expect(text).not.toMatch(/\d{4}\.\d\./)
  })
})

describe("applicableLaw — 분리시행 슬라이스 보존 + 시행 예정 개정 경고", () => {
  beforeEach(() => lawCache.clear())

  // 회귀 (2026-08-19 형사소송법 실측): ① 같은 MST가 분리시행으로 두 행(이미 시행분 +
  // 미래 시행분)일 때 MST 단독 dedup이 이미 시행분을 지워 "현행"이 직전 공포본으로
  // 밀렸다. ② 시행 예정 대개정(제21857호, 2026.10.2.)의 존재를 응답 어디서도 알리지
  // 않아 현행 인용만 보고 답하면 개정을 통째로 놓쳤다. 픽스처 날짜는 실행 시점
  // 비의존이 되도록 미래분을 2099년으로 치환한 동형 구조.
  it("이미 시행된 슬라이스가 현행으로 잡히고, 시행 예정 개정이 경고된다", async () => {
    const client = {
      searchLaw: async () => searchXml("형사소송법", "281865"),
      fetchApi: async (p: FetchApiParams) => {
        if (p.target === "lsHistory") {
          return histPage(4, [
            histRow("형사소송법", "281865", "20991231", "21241", "2025.12.30", "일부개정"),  // 미래 슬라이스 (같은 MST)
            histRow("형사소송법", "288579", "20990102", "21857", "2026.08.04", "일부개정"),  // 시행 예정 개정
            histRow("형사소송법", "281865", "20260701", "21241", "2025.12.30", "일부개정"),  // 이미 시행된 슬라이스
            histRow("형사소송법", "280441", "20260624", "21100", "2025.12.23", "일부개정"),
          ])
        }
        if (p.target === "eflaw") return EFLAW_EMPTY_XML
        if (p.target === "law") return `{"법령":{"부칙":{"부칙단위":[]}}}`
        throw new Error(`unexpected target: ${p.target}`)
      },
    } as unknown as LawApiClient

    const r = await applicableLaw(client, { lawName: "형사소송법", date: "2026-08-19" })
    const text = r.content[0].text
    // ① 현행 = 이미 시행된 슬라이스 (MST 단독 dedup였으면 20260624판으로 밀림)
    expect(text).toContain("[시행 2026.07.01]")
    expect(text).toContain("(MST 281865)")
    expect(text).not.toContain("[시행 2026.06.24]")
    // ② 시행 예정 개정 경고 + 후속 조회 유도
    expect(text).toContain("시행 예정 개정")
    expect(text).toContain("제21857호")
    expect(text).toContain('get_law_text(mst="288579")')
  })

  it("시행 예정 개정이 없으면 경고를 내지 않는다", async () => {
    const client = {
      searchLaw: async () => searchXml("형사소송법", "281865"),
      fetchApi: async (p: FetchApiParams) => {
        if (p.target === "lsHistory") {
          return histPage(1, [histRow("형사소송법", "281865", "20260701", "21241", "2025.12.30", "일부개정")])
        }
        if (p.target === "eflaw") return EFLAW_EMPTY_XML
        if (p.target === "law") return `{"법령":{"부칙":{"부칙단위":[]}}}`
        throw new Error(`unexpected target: ${p.target}`)
      },
    } as unknown as LawApiClient

    const r = await applicableLaw(client, { lawName: "형사소송법", date: "2026-08-19" })
    expect(r.content[0].text).not.toContain("시행 예정 개정")
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

// 2026-09-23 리뷰 B#11: 슬라이스 조회의 catch 가 예산 소진까지 삼켜, 분리시행 보정을 건너뛴 옛 공포본을
// "기준일 시행 버전"으로 확신 출력했다. 예산 소진·취소는 오류로 올린다(그 밖의 실패는 종전대로 보정 생략).
describe("applicableLaw: 예산 소진을 '보정 없음'으로 삼키지 않는다 (B#11)", () => {
  beforeEach(() => lawCache.clear())

  it("분리시행 슬라이스 조회가 예산 소진이면 보정 전 버전을 확신 출력하지 않는다", async () => {
    const { ExecutionLimitError } = await import("../lib/execution-limits.js")
    const client = {
      searchLaw: async () => searchXml("소득세법", "94269"),
      fetchApi: async (p: FetchApiParams) => {
        if (p.target === "lsHistory") {
          return histPage(2, [
            histRow("소득세법", "94269", "20100310", "9763", "2009.06.09", "타법개정"),
            histRow("소득세법", "98343", "20100101", "9924", "2010.01.01", "타법개정"),
          ])
        }
        if (p.target === "eflaw") throw new ExecutionLimitError("Request upstream work budget exceeded (max 48 attempts).")
        if (p.target === "law") return `{"법령":{"부칙":{"부칙단위":[]}}}`
        throw new Error(`unexpected target: ${p.target}`)
      },
    } as unknown as LawApiClient

    const r = await applicableLaw(client, { lawName: "소득세법", date: "2010-05-01" })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).not.toContain("[시행 2010.03.10]")
  })
})
