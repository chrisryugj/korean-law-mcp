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
import { RequestExecutionBudget, DEFAULT_EXECUTION_LIMITS, ExecutionLimitError } from "../lib/execution-limits.js"

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

async function runVerify(text: string, maxCitations: number, maxUpstreamRequests = DEFAULT_EXECUTION_LIMITS.maxUpstreamRequests) {
  const budget = new RequestExecutionBudget({ ...DEFAULT_EXECUTION_LIMITS, maxUpstreamRequests })
  const res = await requestContext.run({ budget }, () =>
    verifyCitations(new LawApiClient({ apiKey: "test" }), { text, maxCitations }))
  return { text: res.content[0].text, attempts: budget.snapshot().upstreamRequests, isError: res.isError }
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

// ── 예산 소진은 그 인용만의 실패다 (2026-10-01 감사 재현) ──────────────────────
const OLD = "소방시설 설치ㆍ유지 및 안전관리에 관한 법률"
const NEW = "소방시설 설치 및 관리에 관한 법률"
const lawRow = (mst: string, efYd: string, name: string, id: string, rr: string, st = "연혁") =>
  `<law id="x"><법령일련번호>${mst}</법령일련번호><현행연혁코드>${st}</현행연혁코드><법령명한글><![CDATA[${name}]]></법령명한글>` +
  `<법령ID>${id}</법령ID><공포일자>${efYd}</공포일자><공포번호>1</공포번호><제개정구분명>${rr}</제개정구분명><시행일자>${efYd}</시행일자></law>`
const lawList = (rows: string[]) => `<LawSearch><totalCnt>${rows.length}</totalCnt>${rows.join("")}</LawSearch>`

/** 현행 검색은 민법만, 연혁 검색은 옛 법령명(제명 변경)만 잡힌다. 나머지 법령명은 전부 0건 = 지어낸 법령 */
function installNamedFetch(): void {
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = new URL(String(input))
    const target = url.searchParams.get("target")
    const query = url.searchParams.get("query")
    await new Promise(resolve => setImmediate(resolve))
    if (url.pathname.endsWith("lawSearch.do") && target === "law") {
      return new Response(query === "민법" ? CIVIL_LAW_XML : lawList([]))
    }
    if (url.pathname.endsWith("lawSearch.do") && target === "eflaw") {
      if (url.searchParams.get("LID") === "009503") {
        return new Response(lawList([lawRow("236977", "20241201", NEW, "009503", "전부개정", "현행"), lawRow("166244", "20150701", OLD, "009503", "일부개정")]))
      }
      return new Response(lawList(query === OLD ? [lawRow("166244", "20150701", OLD, "009503", "일부개정")] : []))
    }
    if (url.pathname.endsWith("lawService.do")) {
      return new Response(url.searchParams.get("efYd")
        ? JSON.stringify({ 법령: { 조문: { 조문단위: [{ 조문여부: "조문", 조문번호: "9", 조문제목: "소방시설의 유지·관리" }] } } })
        : lawJson(url.searchParams.get("JO"), new Set()))
    }
    return new Response(EMPTY_PREC)
  })
}

describe("verify_citations: 예산 소진은 그 인용만의 실패다 (2026-10-01 감사 재현)", () => {
  beforeEach(() => lawCache.clear())
  afterEach(() => vi.unstubAllGlobals())

  it("옛 법령명 인용의 조문 조회가 예산에 걸려도 이미 검증한 인용은 남고 그 항목만 실패로 적는다", async () => {
    installNamedFetch()
    // 예산 10: 민법 검색·조회 3회 + 옛 법령명 특정(후보 검색 3·연혁 3·계보 1) 7회 → 옛 이름 시절 조문 조회가 11번째
    const { text, isError } = await runVerify(`민법 제750조와 민법 제751조, 「화재예방, ${OLD}」 제9조에 따라`, 15, 10)
    expect(text).not.toContain("[EXTERNAL_API_ERROR]")   // 종전: 응답 전체가 이 오류 하나(✓2 소실)
    expect(isError).toBeFalsy()
    expect(text).toContain("✓ 2 실존")
    expect(text).toMatch(/\[RENAMED\].*조문 조회 실패.*budget exceeded/)
  })

  it("요청 취소는 항목 실패로 덮지 않고 올린다", async () => {
    const client = {
      searchLaw: async (_q: string, _k?: string, _d?: number, target?: string) =>
        lawList(target === "eflaw" ? [lawRow("166244", "20150701", OLD, "009503", "일부개정")] : []),
      fetchApi: async (p: { extraParams?: Record<string, string> }) => p.extraParams?.LID === "009503"
        ? lawList([lawRow("236977", "20241201", NEW, "009503", "전부개정", "현행"), lawRow("166244", "20150701", OLD, "009503", "일부개정")])
        : EMPTY_PREC,
      getLawText: async () => { throw new Error("The operation was aborted") },
    } as unknown as LawApiClient
    const res = await requestContext.run({ signal: AbortSignal.abort() }, () =>
      verifyCitations(client, { text: `${OLD} 제9조에 따라`, maxCitations: 5 }))
    expect(res.isError).toBe(true)
    expect(res.content[0].text).not.toContain("[RENAMED]")
  })

  it("폐지 법령(연혁) 확인이 예산에 걸리면 '법령 없음'으로 단정하지 않는다", async () => {
    const client = {
      searchLaw: async (_q: string, _k?: string, _d?: number, target?: string) => {
        if (target === "eflaw") throw new ExecutionLimitError("Request upstream work budget exceeded (max 48 attempts).")
        return lawList([])
      },
      fetchApi: async () => EMPTY_PREC,
    } as unknown as LawApiClient
    const res = await verifyCitations(client, { text: "가상토지 보전 및 관리에 관한 특별법 제3조", maxCitations: 5 })
    const text = res.content[0].text
    expect(text).not.toContain("[NOT_FOUND]")             // 종전: 연혁 확인 실패를 '없음'으로 삼켜 ✗ 환각 판정
    expect(text).not.toContain("[HALLUCINATION_DETECTED]")
    expect(text).toMatch(/⚠ 가상토지 보전 및 관리에 관한 특별법 제3조 — .*budget exceeded/)
  })
})
