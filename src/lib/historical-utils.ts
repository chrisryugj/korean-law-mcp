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

/** lsHistory API 호출 → HTML 파싱 → 시행일 내림차순 */
export async function fetchHistoricalVersionsRaw(
  apiClient: LawApiClient,
  lawName: string,
  apiKey?: string,
  display = 100
): Promise<HistoricalVersion[]> {
  const html = await apiClient.fetchApi({
    endpoint: "lawSearch.do",
    target: "lsHistory",
    type: "HTML",
    extraParams: {
      query: lawName,
      display: String(display),
      sort: "efdes",
    },
    apiKey,
  })

  const histories: HistoricalVersion[] = []
  const rowPattern = /<tr[^>]*>[\s\S]*?<\/tr>/gi
  const rows = html.match(rowPattern) || []

  const normalizedTarget = lawName.replace(/\s/g, "")
  const targetHasDecree = lawName.includes("시행령") || lawName.includes("시행규칙")

  for (const row of rows) {
    const linkMatch = row.match(/MST=(\d+)[^"]*efYd=(\d*)/)
    if (!linkMatch) continue
    const mst = linkMatch[1]
    const efYd = linkMatch[2] || ""

    const lawNmMatch = row.match(/<a[^>]+>([^<]+)<\/a>/)
    const lawNm = lawNmMatch?.[1]?.trim() || ""
    if (!lawNm) continue

    // 시행령/시행규칙 필터
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

    histories.push({ mst, efYd, ancNo, ancYd, lawNm, rrCls })
  }

  histories.sort((a, b) => parseInt(b.efYd || "0", 10) - parseInt(a.efYd || "0", 10))
  return histories
}
