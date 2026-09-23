/**
 * 체인 데드라인 통합 — 실제 체인이 부분 결과를 조립하는가 (#131)
 *
 * 업스트림은 전부 mock 이다. 느린 응답은 setTimeout 으로 흉내내고, 데드라인은
 * 환경변수로 짧게 줄여 발동시킨다. 시계는 가짜 타이머로 돌린다. 실제로 기다리면
 * 파일 하나가 25초를 먹었다 (2026-09-23 리뷰에서 전환).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  chainActionBasis, chainFullResearch, chainDisputePrep,
  chainLawSystem, chainProcedureDetail, chainOrdinanceCompare, chainAmendmentTrack,
} from "./chains.js"
import { lawCache } from "../lib/cache.js"
import type { LawApiClient } from "../lib/api-client.js"
import type { ToolResponse } from "../lib/types.js"

const lawXml = (name: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><LawSearch><totalCnt>1</totalCnt><law id="1">` +
  `<법령일련번호>9001</법령일련번호><법령명한글><![CDATA[${name}]]></법령명한글>` +
  `<법령ID>1001</법령ID><법령구분명>법률</법령구분명></law></LawSearch>`

const empty = `<?xml version="1.0" encoding="UTF-8"?><LawSearch><totalCnt>0</totalCnt></LawSearch>`

/** 어떤 파서가 읽어도 0건이 되는 무근(root 불일치) 응답 */
const emptyAny = `<?xml version="1.0" encoding="UTF-8"?><Empty><totalCnt>0</totalCnt></Empty>`

const interpXml =
  `<?xml version="1.0" encoding="UTF-8"?><Expc><totalCnt>1</totalCnt><expc id="1">` +
  `<법령해석례일련번호>8001</법령해석례일련번호><안건명>테스트 안건</안건명>` +
  `<안건번호>24-0001</안건번호><회신일자>20240101</회신일자><회신기관명>법제처</회신기관명></expc></Expc>`

const appealXml =
  `<?xml version="1.0" encoding="UTF-8"?><Decc><totalCnt>1</totalCnt><decc id="1">` +
  `<행정심판재결례일련번호>7001</행정심판재결례일련번호><사건명>취소 재결 사건</사건명>` +
  `<사건번호>2024-001</사건번호><의결일자>20240301</의결일자><재결청>중앙행정심판위원회</재결청></decc></Decc>`

const precXml =
  `<?xml version="1.0" encoding="UTF-8"?><PrecSearch><totalCnt>1</totalCnt><page>1</page>` +
  `<prec><판례일련번호>245007</판례일련번호><사건명><![CDATA[음주운전 면허취소 처분 취소]]></사건명>` +
  `<사건번호>2023두302036</사건번호><법원명>대법원</법원명><선고일자>20240208</선고일자><판결유형>판결</판결유형></prec>` +
  `</PrecSearch>`

const after = <T,>(ms: number, value: T): Promise<T> =>
  new Promise(resolve => setTimeout(() => resolve(value), ms))

const hang = <T,>(): Promise<T> => new Promise<T>(() => {})

/** 법령 검색만 즉시 답하고 나머지 조회는 영원히 매달리는 업스트림 */
function stallingClient(): LawApiClient {
  return {
    async searchLaw() { return lawXml("도로교통법") },
    async fetchApi({ target }: { target?: string }) {
      if (target === "law" || target === "lawSearch") return lawXml("도로교통법")
      // 나머지(3단비교·판례·해석례·별표…)는 응답하지 않는다
      return hang<string>()
    },
  } as unknown as LawApiClient
}

/** 데드라인(5초)까지 가짜 시계를 돌리고 결과를 받는다 */
async function runPastDeadline(work: Promise<ToolResponse>, ms = 5000): Promise<ToolResponse> {
  await vi.advanceTimersByTimeAsync(ms)
  return work
}

const ORIGINAL = process.env.MCP_CHAIN_DEADLINE_MS
beforeEach(() => {
  vi.useFakeTimers()
  lawCache.clear()
})
afterEach(() => {
  vi.useRealTimers()
  if (ORIGINAL === undefined) delete process.env.MCP_CHAIN_DEADLINE_MS
  else process.env.MCP_CHAIN_DEADLINE_MS = ORIGINAL
  lawCache.clear()
})

describe("#131 데드라인 발동 시 부분 결과", () => {
  it("응답하지 않는 갈래를 침묵으로 버리지 않고 마커로 남긴다", async () => {
    process.env.MCP_CHAIN_DEADLINE_MS = "5000"
    const res = await runPastDeadline(chainActionBasis(stallingClient(), { query: "음주운전 과태료 기준 얼마" }))
    const text = res.content[0]?.text ?? ""

    // 기반 법령은 잡혔으므로 머리글은 나온다
    expect(text).toContain("처분 근거 확인")
    // 못 받은 섹션은 침묵이 아니라 마커 + 대체 조회 안내
    expect(text).toContain("시간 한도로 이 섹션은 수집하지 못했습니다")
    expect(text).toContain("get_three_tier")
    // 부분 결과는 유효한 답이다 — 오류로 표시하지 않는다
    expect(res.isError).toBeFalsy()
  })

  it("데드라인 값이 잘못되면 조용히 넘어가지 않는다", async () => {
    process.env.MCP_CHAIN_DEADLINE_MS = "abc"
    const res = await chainActionBasis(stallingClient(), { query: "음주운전 과태료 기준 얼마" })
    expect(res.isError).toBe(true)
    expect(res.content[0]?.text ?? "").toContain("MCP_CHAIN_DEADLINE_MS")
  })

  it("full_research도 데드라인 env 오류를 형식화해 반환한다 (생 throw 금지, #150)", async () => {
    process.env.MCP_CHAIN_DEADLINE_MS = "abc"
    const res = await chainFullResearch(stallingClient(), { query: "민법 손해" })
    expect(res.isError).toBe(true)
    expect(res.content[0]?.text ?? "").toContain("MCP_CHAIN_DEADLINE_MS")
  })
})

describe("#150 데드라인이 체인 프리픽스(기반 탐색)까지 묶는다", () => {
  it("action_basis: 기반 법령 검색이 매달려도 시간 한도 안에 부분 반환한다", async () => {
    process.env.MCP_CHAIN_DEADLINE_MS = "5000"
    // 법령 검색부터 응답하지 않는 업스트림 — 종전에는 데드라인이 이 구간 밖이라 무한 대기였다
    const client = {
      async searchLaw() { return hang<string>() },
      async fetchApi() { return hang<string>() },
    } as unknown as LawApiClient

    const started = Date.now()
    const res = await runPastDeadline(chainActionBasis(client, { query: "여권 재발급 기한" }))
    const text = res.content[0]?.text ?? ""

    expect(Date.now() - started).toBeLessThan(15_000)
    expect(text).toContain("처분 근거 확인")
    expect(text).toContain("시간 한도")
    // 만료를 "검색 결과 없음"으로 둔갑시키지 않는다
    expect(text).not.toContain("[NOT_FOUND]")
    expect(res.isError).toBeFalsy()
  })

  it("full_research: 프리픽스가 늦게 끝나도 요청 안 한 갈래에 가짜 타임아웃 마커를 달지 않는다", async () => {
    process.env.MCP_CHAIN_DEADLINE_MS = "5000"
    // AI 검색만 데드라인(5초) 너머(6.5초)에 응답 — 별표·시나리오는 요청 자체가 없는 질의다
    const client = {
      async searchLaw() { return lawXml("도로교통법") },
      async getLawText() { throw new Error("본문 조회 생략(mock)") },
      async fetchApi({ target }: { target?: string }) {
        if (target === "aiSearch") return after(6_500, emptyAny)
        return emptyAny
      },
    } as unknown as LawApiClient

    const res = await runPastDeadline(chainFullResearch(client, { query: "도로교통법 원동기 규정" }))
    const text = res.content[0]?.text ?? ""

    expect(text).toContain("종합 리서치")
    expect(text).toContain("시간 한도")
    // 요청하지 않은 섹션(별표 없음·시나리오 null)에 "시간 한도로 수집 실패" 마커 금지
    expect(text).not.toMatch(/▶ 별표\/서식\n⏱/)
    expect(text).not.toContain("시나리오(null)")
    expect(res.isError).toBeFalsy()
  })

  it("dispute_prep: 판례 검색이 매달려도 행정심판 수신분은 싣고 마커로 부분 반환한다", async () => {
    process.env.MCP_CHAIN_DEADLINE_MS = "5000"
    const client = {
      async fetchApi({ endpoint, target }: { endpoint?: string; target?: string }) {
        if (target === "prec") return hang<string>()                     // 판례 검색 매달림
        if (endpoint === "lawService.do") return hang<string>()          // 상세조회 매달림
        if (target === "decc") return appealXml                           // 행심 검색은 즉시
        return emptyAny
      },
    } as unknown as LawApiClient

    const res = await runPastDeadline(chainDisputePrep(client, { query: "건축허가 취소 재결" }))
    const text = res.content[0]?.text ?? ""

    expect(text).toContain("쟁송 대비")
    expect(text).toMatch(/▶ 대법원 판례\n⏱/)      // 매달린 갈래는 마커
    expect(text).toContain("[7001]")               // 받은 행심 검색은 그대로 싣는다
    expect(text).toMatch(/▶ 행정심판례 상세\n⏱/)  // 상세 단계만 만료 마커
    expect(res.isError).toBeFalsy()
  })
})

describe("#150 action_basis 근거 갈래는 단계별로 나눠 수신분을 보존한다", () => {
  it("상세조회가 매달려도 받은 검색 3종은 폐기하지 않는다", async () => {
    process.env.MCP_CHAIN_DEADLINE_MS = "5000"
    const client = {
      async searchLaw() { return lawXml("도로교통법") },
      async getThreeTier() { return hang<string>() },
      async fetchApi({ endpoint, target }: { endpoint?: string; target?: string }) {
        if (endpoint === "lawService.do") return hang<string>() // 상세조회만 매달림
        if (target === "expc") return interpXml
        return emptyAny
      },
    } as unknown as LawApiClient

    const res = await runPastDeadline(chainActionBasis(client, { query: "도로교통법 원동기 규정" }))
    const text = res.content[0]?.text ?? ""

    expect(text).toContain("[8001]")                       // 해석례 검색 수신분이 실린다
    expect(text).toMatch(/▶ 법령 해석례 상세\n⏱/)          // 미완 상세만 마커
    expect(text).not.toContain("법령 해석례·판례·행정심판례") // 갈래 통짜 마커로 뭉뚱그리지 않는다
    // 요청 안 한 별표·시나리오에 가짜 마커 금지
    expect(text).not.toMatch(/▶ 별표 \(과태료\/기준표\)\n⏱/)
    expect(text).not.toContain("시나리오(null)")
    expect(res.isError).toBeFalsy()
  })
})

describe("2026-09-23 리뷰 B#4·B#8 full_research: Step 1 이후 갈래는 동시에, 받은 것은 버리지 않는다", () => {
  it("판례 단계가 만료돼도 Step 1 에 받은 해석례를 싣고, '받은 전부'라고 거짓 고지하지 않는다", async () => {
    process.env.MCP_CHAIN_DEADLINE_MS = "5000"
    const client = {
      async searchLaw() { return lawXml("도로교통법") },
      async getLawText() { throw new Error("본문 조회 생략(mock)") },
      async fetchApi({ endpoint, target }: { endpoint?: string; target?: string }) {
        if (target === "prec") return hang<string>()                    // 판례 사다리 매달림
        if (target === "expc" && endpoint === "lawSearch.do") return interpXml
        if (endpoint === "lawService.do") return hang<string>()
        return emptyAny
      },
    } as unknown as LawApiClient

    const res = await runPastDeadline(chainFullResearch(client, { query: "도로교통법 음주운전" }))
    const text = res.content[0]?.text ?? ""

    expect(text).toContain("[8001]")                  // 종전: 판례 만료와 함께 버려졌다
    expect(text).toMatch(/▶ 관련 판례\n⏱/)
    expect(text).not.toContain("위까지가 시간 안에 받은 전부입니다")
    expect(res.isError).toBeFalsy()
  })

  it("본문 조회가 매달려도 판례 갈래는 따로 끝나 실린다 (종전: 본문 뒤 순차라 함께 만료)", async () => {
    process.env.MCP_CHAIN_DEADLINE_MS = "5000"
    const client = {
      async searchLaw() { return lawXml("도로교통법") },
      async getLawText() { return hang<string>() },                     // 본문만 매달림
      async fetchApi({ endpoint, target }: { endpoint?: string; target?: string }) {
        if (target === "prec" && endpoint === "lawSearch.do") return precXml
        if (target === "prec") throw new Error("상세 생략(mock)")          // 판례 상세는 즉시 실패
        return emptyAny
      },
    } as unknown as LawApiClient

    const res = await runPastDeadline(chainFullResearch(client, { query: "도로교통법 음주운전" }))
    const text = res.content[0]?.text ?? ""

    expect(text).toMatch(/▶ 도로교통법 본문\n⏱/)
    expect(text).toContain("[245007]")               // 판례 검색 결과가 실린다
    expect(res.isError).toBeFalsy()
  })
})

describe("2026-09-23 리뷰 B#7 law_system·procedure_detail·ordinance_compare·amendment_track 데드라인", () => {
  it("law_system: 3단비교가 매달려도 시간 한도 안에 마커로 부분 반환한다", async () => {
    process.env.MCP_CHAIN_DEADLINE_MS = "5000"
    const client = {
      async searchLaw() { return lawXml("관세법") },
      async getThreeTier() { return hang<string>() },
    } as unknown as LawApiClient

    const res = await runPastDeadline(chainLawSystem(client, { query: "관세법" }))
    const text = res.content[0]?.text ?? ""
    expect(text).toContain("법체계 확인: 관세법")
    expect(text).toMatch(/▶ 3단 비교 \(법률·시행령·시행규칙\)\n⏱/)
    // 요청하지 않은 조문·별표 갈래에 가짜 마커 금지
    expect(text).not.toMatch(/▶ 핵심 조문\n⏱/)
    expect(text).not.toMatch(/▶ 별표\/서식\n⏱/)
    expect(res.isError).toBeFalsy()
  })

  it("law_system: 기반 법령 검색이 매달리면 NOT_FOUND 가 아니라 만료로 돌려준다", async () => {
    process.env.MCP_CHAIN_DEADLINE_MS = "5000"
    const client = {
      async searchLaw() { return hang<string>() },
      async fetchApi() { return hang<string>() },
    } as unknown as LawApiClient
    const res = await runPastDeadline(chainLawSystem(client, { query: "관세법" }))
    const text = res.content[0]?.text ?? ""
    expect(text).toContain("시간 한도")
    expect(text).not.toContain("[NOT_FOUND]")
    expect(res.isError).toBeFalsy()
  })

  it("law_system: 독립 갈래가 동시에 돈다 (각 1초면 합계 1초, 종전 순차는 3초)", async () => {
    const client = {
      async searchLaw() { return lawXml("관세법") },
      async getThreeTier() { return after(1000, "{}") },
      async getLawText() { return after(1000, "{}") },
      async getArticleHistory() { return after(1000, emptyAny) },
      async fetchApi() { return after(1000, emptyAny) },
    } as unknown as LawApiClient

    let settled = false
    const work = chainLawSystem(client, { query: "관세법", articles: ["제1조"], scenario: "delegation" })
      .then(r => { settled = true; return r })
    await vi.advanceTimersByTimeAsync(1000)
    expect(settled).toBe(true)
    const text = (await work).content[0].text
    expect(text).toContain("3단 비교")
    expect(text).toContain("핵심 조문")
  })

  it("procedure_detail: 3단비교·별표가 매달려도 시간 한도 안에 마커로 부분 반환한다", async () => {
    process.env.MCP_CHAIN_DEADLINE_MS = "5000"
    const client = {
      async searchLaw() { return lawXml("여권법") },
      async getThreeTier() { return hang<string>() },
      async getAnnexes() { return hang<string>() },
      async fetchApi({ target }: { target?: string }) {
        if (target === "aiSearch") return emptyAny
        return hang<string>()
      },
    } as unknown as LawApiClient

    const res = await runPastDeadline(chainProcedureDetail(client, { query: "여권법 발급 절차" }))
    const text = res.content[0]?.text ?? ""
    expect(text).toContain("법령: 여권법")
    expect(text).toMatch(/▶ 법령 체계 \(절차 근거\)\n⏱/)
    expect(text).toMatch(/▶ 여권법 별표\/서식\n⏱/)
    expect(text).toContain("AI 검색 보완 정보")      // 받은 갈래는 싣는다
    expect(res.isError).toBeFalsy()
  })

  it("ordinance_compare: 조례 전문 조회가 매달려도 검색 결과는 싣고 전문만 마커로 남긴다", async () => {
    process.env.MCP_CHAIN_DEADLINE_MS = "5000"
    const ordinXml = `<?xml version="1.0" encoding="UTF-8"?><OrdinSearch><totalCnt>1</totalCnt><page>1</page>` +
      `<law><자치법규일련번호>1279715</자치법규일련번호><자치법규명><![CDATA[서울특별시 주차장 조례]]></자치법규명>` +
      `<지자체기관명>서울특별시</지자체기관명><공포일자>20200101</공포일자><시행일자>20200101</시행일자></law></OrdinSearch>`
    const client = {
      async searchLaw() { return empty },
      async searchOrdinance() { return ordinXml },
      async getOrdinance() { return hang<string>() },
    } as unknown as LawApiClient

    const res = await runPastDeadline(chainOrdinanceCompare(client, { query: "서울시 주차장 조례" }))
    const text = res.content[0]?.text ?? ""
    expect(text).toContain("[1279715]")
    expect(text).toMatch(/▶ 조례 전문 \(상위 1건\)\n⏱/)
    expect(res.isError).toBeFalsy()
  })

  it("amendment_track: 신구대조가 매달려도 시간 한도 안에 마커로 부분 반환한다", async () => {
    process.env.MCP_CHAIN_DEADLINE_MS = "5000"
    const client = {
      async compareOldNew() { return hang<string>() },
    } as unknown as LawApiClient

    const res = await runPastDeadline(chainAmendmentTrack(client, { query: "관세법", mst: "9001", lawId: "1001", includeHistory: false }))
    const text = res.content[0]?.text ?? ""
    expect(text).toContain("개정 추적: 관세법")
    expect(text).toMatch(/▶ 신구대조표 \(최근 개정\)\n⏱/)
    expect(text).toContain("[조문별 개정 이력 생략]")
    expect(res.isError).toBeFalsy()
  })
})
