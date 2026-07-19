/**
 * 연혁 조회 유틸 — time_travel 시나리오에서 raw 데이터 필요
 * (tools/historical-law.ts는 포맷팅된 텍스트만 반환하므로 별도 추출)
 */
import type { LawApiClient } from "./api-client.js"
import { extractTag } from "./xml-parser.js"

export interface HistoricalVersion {
  mst: string
  efYd: string  // 시행일자 (YYYYMMDD)
  ancNo: string
  ancYd: string
  lawNm: string
  rrCls: string
}

export interface HistoricalFetchResult {
  versions: HistoricalVersion[]
  totalCount: number   // 법제처 응답 "총 N건"
  fetchedPages: number
}

const ROW_PATTERN = /<tr[^>]*>[\s\S]*?<\/tr>/gi

function parseHistoryRows(html: string, normalizedTarget: string, targetHasDecree: boolean): HistoricalVersion[] {
  const out: HistoricalVersion[] = []
  const rows = html.match(ROW_PATTERN) || []
  for (const row of rows) {
    const linkMatch = row.match(/MST=(\d+)[^"]*efYd=(\d*)/)
    if (!linkMatch) continue
    const mst = linkMatch[1]
    const efYd = linkMatch[2] || ""

    const lawNmMatch = row.match(/<a[^>]+>([^<]+)<\/a>/)
    const lawNm = lawNmMatch?.[1]?.trim() || ""
    if (!lawNm) continue

    const lawHasDecree = lawNm.includes("시행령") || lawNm.includes("시행규칙")
    if (!targetHasDecree && lawHasDecree) continue

    const normalizedLaw = lawNm.replace(/\s/g, "")
    if (normalizedLaw !== normalizedTarget) continue

    const ancNoMatch = row.match(/제\s*(\d+)\s*호/)
    const ancNo = ancNoMatch?.[1] || ""

    const dateCells = row.match(/<td[^>]*>(\d{4}[.\-]?\d{2}[.\-]?\d{2})<\/td>/g) || []
    let ancYd = ""
    if (dateCells[0]) {
      const dm = dateCells[0].match(/(\d{4})[.\-]?(\d{2})[.\-]?(\d{2})/)
      if (dm) ancYd = `${dm[1]}${dm[2]}${dm[3]}`
    }

    const rrClsMatch = row.match(/(제정|일부개정|전부개정|폐지|타법개정|타법폐지|일괄개정|일괄폐지)/)
    const rrCls = rrClsMatch?.[1] || ""

    out.push({ mst, efYd, ancNo, ancYd, lawNm, rrCls })
  }
  return out
}

function parseTotalCount(html: string): number {
  const m = html.match(/<strong>(\d+)<\/strong>\s*건/)
  return m ? parseInt(m[1], 10) : 0
}

/**
 * lsHistory API 호출 → HTML 파싱 → 시행일 내림차순
 * 자주 개정되는 법령(소득세법 시행령 등 200+ 건)도 페이징으로 전체 회수.
 */
export async function fetchHistoricalVersionsFull(
  apiClient: LawApiClient,
  lawName: string,
  apiKey?: string,
  pageSize = 500
): Promise<HistoricalFetchResult> {
  const normalizedTarget = lawName.replace(/\s/g, "")
  const targetHasDecree = lawName.includes("시행령") || lawName.includes("시행규칙")

  const allVersions: HistoricalVersion[] = []
  let totalCount = 0
  let fetchedPages = 0
  let page = 1

  while (page <= 20) {  // 안전 상한: 페이지당 500 × 20 = 10,000개
    const html = await apiClient.fetchApi({
      endpoint: "lawSearch.do",
      target: "lsHistory",
      type: "HTML",
      extraParams: {
        query: lawName,
        display: String(pageSize),
        sort: "efdes",
        page: String(page),
      },
      apiKey,
    })

    if (page === 1) totalCount = parseTotalCount(html)
    const pageRows = parseHistoryRows(html, normalizedTarget, targetHasDecree)
    fetchedPages = page

    if (pageRows.length === 0) break
    allVersions.push(...pageRows)

    // 첫 페이지에 totalCount 다 들어왔으면 종료
    if (totalCount > 0 && allVersions.length >= totalCount) break
    // pageSize보다 적게 왔으면 끝
    if (pageRows.length < pageSize) break
    page++
  }

  // 중복 제거 (MST 기준 — 페이징 경계 안전망)
  const seen = new Set<string>()
  const unique = allVersions.filter(v => {
    if (seen.has(v.mst)) return false
    seen.add(v.mst)
    return true
  })

  // 시행일 내림차순. 동일 시행일에 복수 공포본(세법류 매년 1.1. 시행에 흔함)이 있으면
  // 나중 공포본이 앞선 공포본을 반영·개정한 통합본이므로 공포일·공포번호 내림차순 tie-break.
  // (tie-break 없이는 페이지 수집 순서라는 우연에 따라 아무 MST나 잡힌다.)
  unique.sort((a, b) =>
    parseInt(b.efYd || "0", 10) - parseInt(a.efYd || "0", 10) ||
    parseInt(b.ancYd || "0", 10) - parseInt(a.ancYd || "0", 10) ||
    parseInt(b.ancNo || "0", 10) - parseInt(a.ancNo || "0", 10))
  return { versions: unique, totalCount, fetchedPages }
}

/** eflaw 검색의 시행 슬라이스 한 건 (HistoricalVersion과 동일 형상) */
export type EffectiveSlice = HistoricalVersion

const SLICE_LAW_RE = /<law[^>]*>([\s\S]*?)<\/law>/g

/**
 * eflaw(시행일 기준) 검색 XML → 대상 법령의 시행 슬라이스 목록 (시행일·공포일·공포번호 내림차순).
 * lsHistory는 공포단위 1행이라 한 공포본의 조항별 분리시행(단계 시행일)이 보이지 않는다 —
 * 예: 소득세법 법률 제9897호는 시행일이 4개(2009.12.31./2010.1.1./2010.4.1./2010.7.1.)인데
 * lsHistory엔 2010.1.1. 한 행뿐. eflaw는 슬라이스마다 한 행씩 반환한다.
 */
export function parseEffectiveSlices(xmlText: string, lawName: string): EffectiveSlice[] {
  const normalizedTarget = lawName.replace(/\s/g, "")
  const out: EffectiveSlice[] = []
  let m
  while ((m = SLICE_LAW_RE.exec(xmlText)) !== null) {
    const c = m[1]
    const lawNm = extractTag(c, "법령명한글")
    if (!lawNm || lawNm.replace(/\s/g, "") !== normalizedTarget) continue
    const efYd = extractTag(c, "시행일자")
    const mst = extractTag(c, "법령일련번호")
    if (!/^\d{8}$/.test(efYd) || !mst) continue
    const ancNoRaw = extractTag(c, "공포번호")
    out.push({
      mst,
      efYd,
      // eflaw 공포번호는 0패딩("09897") — lsHistory 표기와 맞춰 정수화
      ancNo: ancNoRaw ? String(parseInt(ancNoRaw, 10)) : "",
      ancYd: extractTag(c, "공포일자"),
      lawNm,
      rrCls: extractTag(c, "제개정구분명"),
    })
  }
  out.sort((a, b) =>
    parseInt(b.efYd || "0", 10) - parseInt(a.efYd || "0", 10) ||
    parseInt(b.ancYd || "0", 10) - parseInt(a.ancYd || "0", 10) ||
    parseInt(b.ancNo || "0", 10) - parseInt(a.ancNo || "0", 10))
  return out
}

/**
 * fromYmd~toYmd 구간에 시행일이 있는 대상 법령의 슬라이스 조회 (eflaw efYd 범위 검색).
 * applicable_law의 분리시행 보정용 — 실패는 호출부에서 보수적으로 무시한다.
 */
export async function fetchEffectiveSlices(
  apiClient: LawApiClient,
  lawName: string,
  fromYmd: string,
  toYmd: string,
  apiKey?: string
): Promise<EffectiveSlice[]> {
  const xml = await apiClient.fetchApi({
    endpoint: "lawSearch.do",
    target: "eflaw",
    type: "XML",
    extraParams: { query: lawName, display: "100", efYd: `${fromYmd}~${toYmd}` },
    apiKey,
  })
  return parseEffectiveSlices(xml, lawName)
}

/** @deprecated Use fetchHistoricalVersionsFull. 단일 페이지(legacy 호환용). */
export async function fetchHistoricalVersionsRaw(
  apiClient: LawApiClient,
  lawName: string,
  apiKey?: string,
  display = 500
): Promise<HistoricalVersion[]> {
  const r = await fetchHistoricalVersionsFull(apiClient, lawName, apiKey, display)
  return r.versions
}
