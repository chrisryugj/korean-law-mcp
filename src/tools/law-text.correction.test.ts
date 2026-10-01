/**
 * get_law_text 기준일 보정 경로 회귀 (2026-10-01 감사)
 *
 * - 재시도 사다리: 확인 1회(efYdMayMiss)는 사용자가 준 efYd 에만. lawId 현행 조회·계보로 고른 실재 시행일 재조회는 일시 장애를 버틴다.
 * - 보정은 "그 시행일 버전이 없다"(미스)일 때만. 503·타임아웃까지 보정하면 시도와 시간이 두 배가 됐다(무응답 90초).
 * - 보정한 버전에서 조문을 못 받으면 그 사실을 그대로 — "그날 시행 버전을 못 찾았다"로 바꾸지 않는다.
 * - 폐지된 법령은 폐지라고, 오늘 현행인 버전은 현행이라고, 미시행 버전은 시행예정이라고 밝힌다.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { getLawText } from "./law-text.js"
import { lawCache } from "../lib/cache.js"
import { UpstreamRecordMissingError } from "../lib/upstream-miss.js"
import type { LawApiClient } from "../lib/api-client.js"

type Row = { mst: string, efYd: string, rr?: string }
const row = (r: Row) =>
  `<law id="x"><법령일련번호>${r.mst}</법령일련번호><법령명한글><![CDATA[테스트법]]></법령명한글><법령ID>001638</법령ID>` +
  `<공포일자>${r.efYd}</공포일자><공포번호>1${r.mst}</공포번호><제개정구분명>${r.rr ?? "일부개정"}</제개정구분명><시행일자>${r.efYd}</시행일자></law>`
const lineageXml = (rows: Row[]) => `<LawSearch><totalCnt>${rows.length}</totalCnt>${rows.map(row).join("")}</LawSearch>`
const body = (efYd: string, articles: string[] = ["1"]) => JSON.stringify({
  법령: {
    기본정보: { 법령명_한글: "테스트법", 법령ID: "001638", 시행일자: efYd, 공포일자: efYd },
    조문: { 조문단위: articles.map(n => ({ 조문여부: "조문", 조문번호: n, 조문내용: `제${n}조(조문) ${efYd} 본문` })) },
  },
})

/** 시행일 내림차순. 300 이 현행(2025), 200·100 은 과거본 */
const BASE: Row[] = [{ mst: "300", efYd: "20250101" }, { mst: "200", efYd: "20200101" }, { mst: "100", efYd: "20100101", rr: "제정" }]

type P = { mst?: string, lawId?: string, jo?: string, efYd?: string, efYdMayMiss?: boolean }
function stub(rows: Row[] = BASE, override?: (p: P) => string | undefined, history = "") {
  const calls: Array<P & { target?: string }> = []
  const real = new Set([...rows.map(r => `${r.mst}@${r.efYd}`), ...[...history.matchAll(/MST=(\d+)&amp;[^"]*efYd=(\d+)/g)].map(m => `${m[1]}@${m[2]}`)])
  const api = {
    getLawText: async (p: P) => {
      calls.push({ ...p })
      const o = override?.(p)
      if (o !== undefined) return o
      if (p.mst && p.jo === "000100" && !p.efYd) return body(rows[0].efYd)
      if (!p.efYd) return body(rows[0].efYd)
      // JO 를 주면 그 조문만 온다. 제9조는 어느 버전에도 없는 조문으로 둔다
      if (p.mst && real.has(`${p.mst}@${p.efYd}`)) return body(p.efYd, p.jo === "000900" ? [] : [String(parseInt(p.jo?.slice(0, 4) || "1", 10))])
      // 없는 시행일: JO 가 붙으면 HTML 미스, 아니면 빈 봉투 (법제처 실측 모양)
      if (p.jo) throw new UpstreamRecordMissingError("https://x/lawService.do?OC=***", "html")
      return "{}"
    },
    fetchApi: async (p: { target: string, extraParams?: Record<string, string> }) => {
      calls.push({ target: `${p.target}:${p.extraParams?.LID ?? ""}` })
      if (p.target === "eflaw" && p.extraParams?.LID) return lineageXml(rows)
      if (p.target === "lsHistory") return history
      throw new Error(`unexpected ${p.target}`)
    },
  } as unknown as LawApiClient
  return { api, calls }
}

const text = (r: { content: Array<{ text: string }> }) => r.content.map(c => c.text).join("\n")
const lineageCalls = (calls: Array<{ target?: string }>) => calls.filter(c => c.target?.startsWith("eflaw:")).length
const headCalls = (calls: P[]) => calls.filter(c => c.jo === "000100" && !c.efYd).length

beforeEach(() => lawCache.clear())

describe("재시도 사다리는 사용자가 준 efYd 에만 줄인다", () => {
  it("lawId 현행 조회(efYd 없음)는 확인 1회로 줄이지 않는다", async () => {
    const { api, calls } = stub()
    await getLawText(api, { lawId: "001638", jo: "제1조" })
    expect(calls[0].efYdMayMiss).toBeFalsy()
  })

  it("계보로 고른 실재 시행일 재조회도 사다리로 버틴다", async () => {
    const { api, calls } = stub()
    const r = await getLawText(api, { lawId: "001638", efYd: "20220101", jo: "제1조" })
    expect(r.isError).toBeFalsy()
    const requery = calls.find(c => c.mst === "200" && c.efYd === "20200101")
    expect(requery?.efYdMayMiss).toBeFalsy()
  })
})

describe("보정은 미스일 때만", () => {
  it("503·타임아웃 같은 일반 장애는 계보를 타지 않고 그대로 올린다", async () => {
    const { api, calls } = stub(BASE, () => { throw new Error("HTTP 503") })
    const r = await getLawText(api, { lawId: "001638", efYd: "20220101", jo: "제1조" })
    expect(r.isError).toBe(true)
    expect(lineageCalls(calls)).toBe(0)
  })

  it("입력이 이미 실재 시행일이면 확인 1회 미스를 사다리로 한 번 더 조회한다 (순간 장애 내성)", async () => {
    let first = true
    const { api, calls } = stub(BASE, p => {
      if (p.mst === "200" && p.efYd === "20200101" && first) { first = false; throw new UpstreamRecordMissingError("u", "html") }
      return undefined
    })
    const r = await getLawText(api, { mst: "200", efYd: "20200101", jo: "제1조" })
    expect(r.isError).toBeFalsy()
    expect(text(r)).toContain("20200101 본문")
    expect(calls.filter(c => c.mst === "200" && c.efYd === "20200101").at(-1)?.efYdMayMiss).toBeFalsy()
  })
})

describe("보정 결과를 정직하게", () => {
  it("보정한 버전에 그 조문이 없으면 그 사실을 싣고, '시행 버전을 못 찾았다'로 바꾸지 않는다", async () => {
    const { api } = stub()
    const r = await getLawText(api, { lawId: "001638", efYd: "20220101", jo: "제9조" })
    const t = text(r)
    expect(r.isError).toBe(true)
    expect(t).toContain("시행 2020.01.01")
    expect(t).toContain("조문 내용을 찾을 수 없습니다")
    expect(t).not.toContain("시행 중이던 버전을 찾지 못했습니다")
  })

  it("기준일에 이미 폐지된 법령은 폐지라고 밝힌다", async () => {
    const rows: Row[] = [{ mst: "999", efYd: "20230101", rr: "타법폐지" }, ...BASE.slice(1)]
    const { api } = stub(rows)
    const r = await getLawText(api, { lawId: "001638", efYd: "20240101", jo: "제1조" })
    expect(r.isError).toBe(true)
    expect(text(r)).toContain("폐지")
    expect(text(r)).toContain("2023.01.01")
  })

  it("보정한 버전이 오늘 현행이면 '현행이 아닐 수 있음' 경고를 붙이지 않는다", async () => {
    const { api } = stub()
    const t = text(await getLawText(api, { lawId: "001638", efYd: "20260101", jo: "제1조" }))
    expect(t).toContain("시행 2025.01.01")
    expect(t).not.toContain("현행 법령이 아닐 수 있음")
    expect(t).toContain("현행")
  })

  it("같은 버전을 먼저 직접 조회해 캐시돼 있어도, 보정 조회의 현행 표기는 그대로다", async () => {
    const { api } = stub()
    await getLawText(api, { mst: "300", efYd: "20250101", jo: "제1조" })   // 일반 표기("현행 아닐 수 있음")로 캐시
    const t = text(await getLawText(api, { lawId: "001638", efYd: "20260101", jo: "제1조" }))
    expect(t).toContain("현행 버전")
    expect(t).not.toContain("현행 법령이 아닐 수 있음")
  })

  it("보정한 버전이 아직 시행 전이면 시행예정본이라고 밝힌다", async () => {
    const rows: Row[] = [{ mst: "400", efYd: "20990601" }, ...BASE]
    const { api } = stub(rows)
    const t = text(await getLawText(api, { lawId: "001638", efYd: "20991231", jo: "제1조" }))
    expect(t).toContain("시행 2099.06.01")
    expect(t).toContain("시행예정")
  })

  it("입력 MST 가 아닌 다른 공포본의 시행일이면 MST 를 바꿨다고 밝힌다", async () => {
    const { api } = stub()
    const t = text(await getLawText(api, { mst: "300", efYd: "20200101", jo: "제1조" }))
    expect(t).toContain("MST 200")
    expect(t).not.toContain("lawId 로는 조회되지 않아")
  })
})

describe("같은 기준일로 여러 조문을 볼 때 법령ID·계보를 다시 받지 않는다", () => {
  it("mst+기준일 조문 두 개 → 법령ID 조회 1회, 계보 1회", async () => {
    const { api, calls } = stub()
    await getLawText(api, { mst: "300", efYd: "20220101", jo: "제1조" })
    await getLawText(api, { mst: "300", efYd: "20220101", jo: "제2조" })
    expect(headCalls(calls)).toBe(1)
    expect(lineageCalls(calls)).toBe(1)
  })
})

// 폐지 후 같은 이름으로 재제정된 법령(근로기준법 1997.3.13.)은 계보(신법)가 기준일보다 늦게 시작한다 — 동명 구법 연혁으로 이어 간다
describe("기준일이 계보 시작(재제정) 전이면 동명 구법 버전으로", () => {
  it("lawId + 1995 기준일 → 법령ID가 다른 구법의 그날 시행 버전", async () => {
    const tr = (mst: string, efYd: string, rr: string) =>
      `<tr><td class="ce">1</td><td><a href="/DRF/lawService.do?OC=x&amp;target=lsHistory&amp;MST=${mst}&amp;type=HTML&amp;mobileYn=&amp;efYd=${efYd}" >테스트법</a></td>` +
      `<td class="ce">부처</td><td class="ce">${rr}</td><td class="ce">법률</td><td class="ce">제 1호</td><td class="ce">${efYd.slice(0, 4)}.1.1</td><td class="ce">${efYd}</td><td class="ce">연혁</td></tr>`
    const history = `<html><strong>2</strong> 건<table>${tr("50", "20000101", "일부개정")}${tr("40", "19900101", "제정")}</table></html>`
    const { api, calls } = stub(BASE, undefined, history)
    const r = await getLawText(api, { lawId: "001638", efYd: "20050101", jo: "제1조" })
    expect(lineageCalls(calls)).toBe(1)   // 받아 둔 계보에 구법만 덧붙인다 — 계보를 다시 받지 않는다
    const t = text(r)
    expect(r.isError).toBeFalsy()
    expect(t).toContain("시행 2000.01.01")
    expect(t).toContain("동명 구법")
    expect(t).toContain("20000101 본문")
  })
})
