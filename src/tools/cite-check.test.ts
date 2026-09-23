import { describe, it, expect } from "vitest"
import { citeCheck } from "./cite-check.js"
import { extractHolding } from "../lib/precedent-body.js"
import type { LawApiClient } from "../lib/api-client.js"

const TARGET_SEARCH_XML = `<?xml version="1.0" encoding="UTF-8"?><PrecSearch><totalCnt>1</totalCnt><page>1</page>` +
  `<prec><판례일련번호>204201</판례일련번호><사건명><![CDATA[손해배상(기)]]></사건명>` +
  `<사건번호>2013다61381</사건번호><법원명>대법원</법원명><선고일자>20181030</선고일자>` +
  `<판결유형>전원합의체 판결</판결유형></prec></PrecSearch>`

const CITING_SEARCH_XML = `<?xml version="1.0" encoding="UTF-8"?><PrecSearch><totalCnt>0</totalCnt><page>1</page></PrecSearch>`

const HOLDING = "[1] 일본 정부의 한반도에 대한 불법적인 식민지배 및 침략전쟁의 수행과 직결된 일본 기업의 " +
  "반인도적인 불법행위를 전제로 하는 강제동원 피해자의 일본 기업에 대한 위자료청구권이 청구권협정의 " +
  "적용대상에 포함되는지 여부(소극)"

const TARGET_DETAIL_JSON = JSON.stringify({
  PrecService: {
    사건번호: "2013다61381",
    사건명: "손해배상(기)",
    판시사항: HOLDING,
    판결요지: "판결요지 본문",
    참조판례: "",
    판례내용: "본문 전문 — 이 문장은 응답에 통째로 실리면 안 된다.",
  },
})

function stubClient(): LawApiClient {
  return {
    fetchApi: async (params: { endpoint: string; target: string; extraParams?: Record<string, string> }) => {
      if (params.endpoint === "lawService.do") return TARGET_DETAIL_JSON
      if (params.extraParams?.nb) return TARGET_SEARCH_XML
      return CITING_SEARCH_XML
    },
  } as unknown as LawApiClient
}

describe("citeCheck — 판시사항 노출 (#95)", () => {
  it("대상 판례의 판시사항을 응답에 포함한다", async () => {
    const r = await citeCheck(stubClient(), { caseNumber: "2013다61381", display: 20, deepScan: false })
    const text = r.content[0].text
    expect(text).toContain("판시사항")
    expect(text).toContain("강제동원")
  })

  it("판시사항만 발췌하고 전문(판례내용)은 붙이지 않는다", async () => {
    const r = await citeCheck(stubClient(), { caseNumber: "2013다61381", display: 20, deepScan: false })
    const text = r.content[0].text
    expect(text).not.toContain("본문 전문")
  })
})

// #150: nb=는 전방 일치라 "2013다6138" 입력에 "2013다61381"이 특정되고, includes 판정이
// 그 차이를 삼켜 다른 판례의 생사가 입력 사건번호의 것으로 읽혔다. 부분 입력 관용(특정
// 로직)은 기능으로 유지하되, 입력과 다른 판례가 특정된 사실을 경고로 병기한다.
describe("citeCheck — 대상 특정이 입력과 다르면 경고 (#150)", () => {
  it("전방 일치로 이웃 판례가 특정되면 경고 한 줄을 병기한다", async () => {
    const r = await citeCheck(stubClient(), { caseNumber: "2013다6138", display: 20, deepScan: false })
    const text = r.content[0].text
    expect(text).toContain("입력 사건번호와 다른 판례가 특정됨")
    expect(text).toContain("2013다6138 → 2013다61381")
  })

  it("정확 일치 특정에는 경고를 붙이지 않는다", async () => {
    const r = await citeCheck(stubClient(), { caseNumber: "2013다61381", display: 20, deepScan: false })
    expect(r.content[0].text).not.toContain("다른 판례가 특정됨")
  })
})

describe("extractHolding — 응답 필드 shape 변동 (CLAUDE.md 규칙 6)", () => {
  it("배열·객체로 와도 사람이 읽을 문장을 낸다", () => {
    expect(extractHolding({ 판시사항: ["[1] 조약의 해석 방법", "[2] 위자료청구권"] })?.text)
      .toBe("[1] 조약의 해석 방법 [2] 위자료청구권")
    expect(extractHolding({ 판시사항: { "#text": "조약의 해석 방법" } })?.text)
      .toBe("조약의 해석 방법")
  })

  it("판시사항이 비면 판결요지로 내려간다", () => {
    expect(extractHolding({ 판시사항: "", 판결요지: "요지 본문" }))
      .toEqual({ label: "판결요지", text: "요지 본문" })
  })

  it("둘 다 없으면 undefined — 없는 판시사항을 지어내지 않는다", () => {
    expect(extractHolding({})).toBeUndefined()
    expect(extractHolding(null)).toBeUndefined()
  })

  it("긴 판시사항은 잘라서 전문 유입을 막는다", () => {
    const long = extractHolding({ 판시사항: "가".repeat(400) })!
    expect(long.text.length).toBeLessThanOrEqual(241)
    expect(long.text.endsWith("…")).toBe(true)
  })
})

// 2026-09-23 리뷰 B#11: 후속 판례 본문 조회가 실패하면 스캔 결과에서 조용히 빠졌고, 전합 후속이
// 없으면 판정이 ✅ "계속 인용되는 것으로 추정"으로 나갔다.
describe("citeCheck: 정밀 스캔 실패를 '변경 신호 없음'으로 둔갑시키지 않는다 (B#11)", () => {
  const CITING_TWO_XML = `<?xml version="1.0" encoding="UTF-8"?><PrecSearch><totalCnt>2</totalCnt><page>1</page>` +
    `<prec><판례일련번호>300001</판례일련번호><사건명><![CDATA[손해배상]]></사건명><사건번호>2020다11111</사건번호>` +
    `<법원명>대법원</법원명><선고일자>20210101</선고일자><판결유형>판결</판결유형></prec>` +
    `<prec><판례일련번호>300002</판례일련번호><사건명><![CDATA[손해배상]]></사건명><사건번호>2021다22222</사건번호>` +
    `<법원명>대법원</법원명><선고일자>20220101</선고일자><판결유형>판결</판결유형></prec></PrecSearch>`
  const CITING_DETAIL_JSON = JSON.stringify({
    PrecService: { 사건번호: "2020다11111", 판례내용: "원심판결 이유를 살펴본다. 대법원 2013다61381 판결 참조." },
  })

  function client(opts: { citingDetail: "ok" | "fail"; targetDetail?: "ok" | "fail" }): LawApiClient {
    return {
      fetchApi: async (params: { endpoint: string; extraParams?: Record<string, string> }) => {
        if (params.endpoint === "lawService.do") {
          const isTarget = params.extraParams?.ID === "204201"
          const mode = isTarget ? (opts.targetDetail ?? "ok") : opts.citingDetail
          if (mode === "fail") throw new Error("법제처 서버 오류 (500) - fetchApi(prec)")
          return isTarget ? TARGET_DETAIL_JSON : CITING_DETAIL_JSON
        }
        if (params.extraParams?.nb) return TARGET_SEARCH_XML
        return CITING_TWO_XML
      },
    } as unknown as LawApiClient
  }

  it("후속 판례 본문을 못 받으면 ✅ 대신 '미확정'으로 판정하고 실패 건을 밝힌다", async () => {
    const r = await citeCheck(client({ citingDetail: "fail" }), { caseNumber: "2013다61381", display: 20, deepScan: true })
    const text = r.content[0].text
    expect(text).not.toContain("✅")
    expect(text).toContain("본문 확인 불가: 변경·폐기 여부 미확정")
    expect(text).toContain("2021다22222: 본문 확인 불가 (조회 실패 또는 본문 미제공, 스캔 못 함)")
  })

  it("본문을 받아 스캔했으면 종전대로 ✅ 추정 판정이다", async () => {
    const r = await citeCheck(client({ citingDetail: "ok" }), { caseNumber: "2013다61381", display: 20, deepScan: true })
    expect(r.content[0].text).toContain("✅ 후속 인용 2건")
  })

  it("대상 판례 본문을 못 받으면 판시사항이 조용히 빠지지 않고 실패를 밝힌다", async () => {
    const r = await citeCheck(client({ citingDetail: "ok", targetDetail: "fail" }), { caseNumber: "2013다61381", display: 20, deepScan: true })
    expect(r.content[0].text).toContain("⚠ 대상 판례 본문 조회 실패")
  })
})
