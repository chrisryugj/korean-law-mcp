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
  // 총계가 콤마 표기(예: <strong>1,696</strong> 건)로 와도 파싱한다. 이 값은
  // 페이징 종료의 1차 기준이라(위 fetchHistoricalVersionsFull), \d+ 로만 잡으면
  // "1,696"이 "1"로 끊겨 totalCount=1 → 대형 법령 연혁이 1페이지에서 조기 종료되는
  // 역행이 생긴다(정확히 이 함수가 고치려던 케이스).
  const m = html.match(/<strong>([\d,]+)<\/strong>\s*건/)
  return m ? parseInt(m[1].replace(/,/g, ""), 10) : 0
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
    allVersions.push(...pageRows)

    // 종료 판정은 원시 총계(totalCount) 기준이어야 한다. pageRows는 대상 법령명으로
    // 필터링된 부분집합이라 "filtered < pageSize" 비교는 원시 행이 다음 페이지에
    // 남아 있어도 1페이지에서 끊는다 — 본법+시행령·규칙 연혁 합계가 500행을 넘는
    // 법령(소득세법류)에서 옛 본법 버전이 통째로 누락되어 applicable_law의
    // 행위시법 버전 특정이 최신 쪽으로 어긋나던 원인.
    if (totalCount > 0) {
      if (page * pageSize >= totalCount) break   // 원시 총계 기준 마지막 페이지
    } else if (pageRows.length === 0) {
      break   // 총계 파싱 실패 시 보수적 종료 (무한루프 방지)
    }
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
