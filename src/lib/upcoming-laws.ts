/**
 * 시행예정 법령 감지 — search_law 보조 (target=eflaw).
 *
 * 제명변경 개정(예: 「데이터기반행정 활성화에 관한 법률」 → 「인공지능 및
 * 데이터 기반 행정 활성화에 관한 법률」, 2026-08-28 시행)이 공포~시행 사이에는
 * 현행(target=law) 검색에 신명칭이 없어 LLM이 "법령 없음"으로 오판한다.
 * eflaw 보조검색으로 시행예정본을 병기해 신·구 명칭 매핑과 시행일을 알려준다.
 */

import type { LawApiClient } from "./api-client.js"
import { lawCache } from "./cache.js"
import { extractTag } from "./xml-parser.js"

export interface UpcomingLaw {
  name: string
  lawId: string
  mst: string
  effDates: string[] // 조항별 단계 시행이면 복수
  promDate: string
  promNo: string
  revisionType: string // 제개정구분명
  lawType: string
}

/** eflaw 검색 XML에서 "시행예정" 항목만 추출 (동일 MST의 복수 시행일 병합) */
export function parseUpcomingXml(xmlText: string): UpcomingLaw[] {
  const byMst = new Map<string, UpcomingLaw>()
  const lawRegex = /<law[^>]*>([\s\S]*?)<\/law>/g
  let m
  while ((m = lawRegex.exec(xmlText)) !== null) {
    const c = m[1]
    if (extractTag(c, "현행연혁코드") !== "시행예정") continue
    const mst = extractTag(c, "법령일련번호")
    if (!mst) continue
    const effDate = extractTag(c, "시행일자")
    const prev = byMst.get(mst)
    if (prev) {
      if (effDate && !prev.effDates.includes(effDate)) prev.effDates.push(effDate)
      continue
    }
    byMst.set(mst, {
      name: extractTag(c, "법령명한글"),
      lawId: extractTag(c, "법령ID"),
      mst,
      effDates: effDate ? [effDate] : [],
      promDate: extractTag(c, "공포일자"),
      promNo: extractTag(c, "공포번호"),
      revisionType: extractTag(c, "제개정구분명"),
      lawType: extractTag(c, "법령구분명"),
    })
  }
  const out = [...byMst.values()]
  for (const u of out) u.effDates.sort()
  return out
}

/** 시행예정 법령 조회 — 보조 정보이므로 실패는 전파하지 않고 빈 배열 */
export async function fetchUpcomingLaws(
  apiClient: LawApiClient,
  query: string,
  apiKey?: string
): Promise<UpcomingLaw[]> {
  const cacheKey = `upcoming:${query.toLowerCase().trim()}`
  const cached = lawCache.get<UpcomingLaw[]>(cacheKey)
  if (cached) return cached
  try {
    const xml = await apiClient.searchLaw(query, apiKey, 30, "eflaw")
    const parsed = parseUpcomingXml(xml)
    lawCache.set(cacheKey, parsed, 60 * 60 * 1000)
    return parsed
  } catch {
    return []
  }
}

const fmtDate = (d: string) => (d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d)

/**
 * 검색 결과에 붙일 시행예정 안내 노트.
 * - 법령ID가 결과와 같고 이름이 다르면 → 제명변경 예정 (신·구 명칭 매핑)
 * - 법령ID가 같고 이름도 같으면 → 개정 시행예정
 * - 결과에 없는 법령ID → 공포됐지만 미시행인 신규 법령 (현행 검색 0건의 원인)
 */
export function buildUpcomingNotes(
  hits: Array<{ name: string; lawId: string }>,
  upcoming: UpcomingLaw[]
): string {
  if (upcoming.length === 0) return ""
  const hitById = new Map(hits.map(h => [h.lawId, h]))
  const lines: string[] = []
  for (const u of upcoming.slice(0, 5)) {
    const eff = u.effDates.map(fmtDate).join(" · ")
    // 시행예정본은 efYd 없이는 법제처 API가 404 — 반드시 시행일 병기
    const joHint = u.effDates[0]
      ? `get_law_text(mst="${u.mst}", efYd="${u.effDates[0]}")`
      : `get_law_text(mst="${u.mst}")`
    const tail = `(${u.revisionType || "개정"}, ${fmtDate(u.promDate)} 공포 제${u.promNo}호, 시행 ${eff}) — 시행예정본 조문: ${joHint}`
    const hit = hitById.get(u.lawId)
    if (hit && hit.name !== u.name) {
      lines.push(`🔜 제명변경 예정: 「${hit.name}」 → 「${u.name}」 ${tail}`)
    } else if (hit) {
      lines.push(`🔜 「${u.name}」 개정 시행예정 ${tail}`)
    } else {
      lines.push(`🔜 시행예정 ${u.lawType || "법령"}: 「${u.name}」 ${tail} — 아직 미시행이라 현행 검색에는 없음`)
    }
  }
  return lines.join("\n") + "\n"
}
