/**
 * verify_citations 요청 예산 회귀 (2026-09-23 리뷰 B#3)
 *
 * 같은 법령을 여러 번 인용한 문서에서 인용마다 법령 검색을 따로 하고(캐시는 검색이 끝나야 채워진다),
 * 전건을 한꺼번에 띄워 요청 예산 48회를 나란히 태우다가 전부가 함께 실패했다.
 * 버그가 LawApiClient 아래(시도 단위 예산 청구)에서 드러나므로 fetch 를 흉내 낸다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { verifyCitations } from "./verify-citations.js"
import { LawApiClient } from "../lib/api-client.js"
import { lawCache } from "../lib/cache.js"
import { requestContext } from "../lib/session-state.js"
import { RequestExecutionBudget, DEFAULT_EXECUTION_LIMITS } from "../lib/execution-limits.js"

const CIVIL_LAW_XML = `<?xml version="1.0" encoding="UTF-8"?><LawSearch><totalCnt>1</totalCnt>` +
  `<law id="1"><법령일련번호>284415</법령일련번호><법령명한글><![CDATA[민법]]></법령명한글>` +
  `<법령ID>001706</법령ID><법령구분명>법률</법령구분명></law></LawSearch>`

const EMPTY_PREC = `<?xml version="1.0" encoding="UTF-8"?><PrecSearch><totalCnt>0</totalCnt></PrecSearch>`

/** 제1조~제1118조 중 missing 에 든 조문만 없는 민법 */
function lawJson(jo: string | null, missing: Set<number>): string {
  const unit = (n: number) => ({ 조문여부: "조문", 조문번호: String(n), 조문가지번호: "0", 조문제목: `제목${n}`, 조문내용: `제${n}조 본문` })
  if (jo === null) return JSON.stringify({ 법령: { 조문: { 조문단위: [unit(1), unit(1118)] } } })
  const n = parseInt(jo.slice(0, 4), 10)
  return JSON.stringify({ 법령: { 조문: { 조문단위: missing.has(n) ? [unit(1)] : [unit(n)] } } })
}

interface FetchLog { searches: number; lookups: number; fullFetches: number; maxInflight: number }

function installFetch(missing = new Set<number>()): FetchLog {
  const log: FetchLog = { searches: 0, lookups: 0, fullFetches: 0, maxInflight: 0 }
  let inflight = 0
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = new URL(String(input))
    const target = url.searchParams.get("target")
    inflight++
    log.maxInflight = Math.max(log.maxInflight, inflight)
    try {
      // 다른 작업자가 끼어들 틈을 준다 (실제 대기 없음)
      await new Promise(resolve => setImmediate(resolve))
      if (url.pathname.endsWith("lawSearch.do") && target === "law") {
        log.searches++
        return new Response(CIVIL_LAW_XML)
      }
      if (url.pathname.endsWith("lawService.do")) {
        // eflaw·law 모두 본문을 준다: 조회 경로(B1)와 무관하게 조회 1회 = 시도 1회로 고정한다
        const jo = url.searchParams.get("JO")
        if (jo) log.lookups++
        else log.fullFetches++
        return new Response(lawJson(jo, missing))
      }
      return new Response(EMPTY_PREC)
    } finally {
      inflight--
    }
  })
  return log
}

async function runVerify(text: string, maxCitations: number) {
  const budget = new RequestExecutionBudget(DEFAULT_EXECUTION_LIMITS)
  const res = await requestContext.run({ budget }, () =>
    verifyCitations(new LawApiClient({ apiKey: "test" }), { text, maxCitations }))
  return { text: res.content[0].text, attempts: budget.snapshot().upstreamRequests }
}

const citeText = (count: number) =>
  Array.from({ length: count }, (_, i) => `민법 제${750 + i}조`).join(", ") + "에 따른다."

describe("verify_citations 요청 예산 (B#3)", () => {
  beforeEach(() => lawCache.clear())
  afterEach(() => vi.unstubAllGlobals())

  it("같은 법령 인용 15건(기본 상한)은 법령 검색 1회로 전건 검증한다", async () => {
    const log = installFetch()
    const { text, attempts } = await runVerify(citeText(15), 15)
    expect(log.searches).toBe(1)        // 종전: 인용마다 1회 = 15회
    expect(log.lookups).toBe(15)
    expect(attempts).toBe(16)
    expect(text).toContain("✓ 15 실존")
    expect(text).toContain("[VERIFIED]")
  })

  it("스키마 상한 30건도 예산 안에서 전건 검증한다 (종전: 검색 30 + 조회 30 = 60회로 12건 실패)", async () => {
    const log = installFetch()
    const { text, attempts } = await runVerify(citeText(30), 30)
    expect(attempts).toBe(31)
    expect(log.searches).toBe(1)
    expect(text).toContain("✓ 30 실존")
    expect(text).not.toContain("budget exceeded")
  })

  it("동시에 도는 조문 조회는 상한(8)을 넘지 않는다", async () => {
    const log = installFetch()
    await runVerify(citeText(12), 12)
    expect(log.maxInflight).toBeLessThanOrEqual(8)
  })

  it("같은 법령의 없는 조문이 여럿이어도 범위 힌트용 전문은 한 번만 받는다", async () => {
    const log = installFetch(new Set([760, 761]))
    const { text } = await runVerify("민법 제760조와 민법 제761조, 민법 제750조", 15)
    expect(log.fullFetches).toBe(1)
    expect(text.match(/\[NOT_FOUND\] 해당 조문 없음 \(존재 범위: 제1조~제1118조\)/g)).toHaveLength(2)
    expect(text).toContain("[HALLUCINATION_DETECTED]")
  })
})
