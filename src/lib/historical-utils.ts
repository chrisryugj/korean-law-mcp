/**
 * 연혁 조회 유틸 — time_travel 시나리오에서 raw 데이터 필요
 * (tools/historical-law.ts는 포맷팅된 텍스트만 반환하므로 별도 추출)
 */
import type { LawApiClient } from "./api-client.js"

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

  unique.sort((a, b) => parseInt(b.efYd || "0", 10) - parseInt(a.efYd || "0", 10))
  return { versions: unique, totalCount, fetchedPages }
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
