/**
 * search_law Tool - 법령 검색
 */

import { z } from "zod"
import { DOMParser } from "@xmldom/xmldom"
import type { LawApiClient } from "../lib/api-client.js"
import { lawCache } from "../lib/cache.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError, noResultHint } from "../lib/errors.js"
import { expandLawQuery, normalizeAliasKey, resolveLawAlias } from "../lib/search-normalizer.js"
import { buildUpcomingNotes, fetchUpcomingLaws } from "../lib/upcoming-laws.js"
import { searchAdminRule } from "./admin-rule.js"
import { searchOrdinance } from "./ordinance-search.js"

export const SearchLawSchema = z.object({
  query: z.string().describe("검색할 법령명 (예: '관세법', 'fta특례법', '화관법')"),
  display: z.number().optional().default(50).describe("최대 결과 개수 (기본 50 — 짧은 법령명 정확매칭 누락 방지)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
})

export type SearchLawInput = z.infer<typeof SearchLawSchema>

interface LawHit {
  name: string
  abbr: string
  lawId: string
  mst: string
  promDate: string
  effDate: string
  statusCode: string // 현행연혁코드: "현행" | "연혁" | "" (API 미제공)
  lawType: string
}

function parseLawsXml(xmlText: string): LawHit[] {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml")
  const out: LawHit[] = []
  const nodes = doc.getElementsByTagName("law")
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    out.push({
      name: n.getElementsByTagName("법령명한글")[0]?.textContent || "알 수 없음",
      abbr: n.getElementsByTagName("법령약칭명")[0]?.textContent || "",
      lawId: n.getElementsByTagName("법령ID")[0]?.textContent || "",
      mst: n.getElementsByTagName("법령일련번호")[0]?.textContent || "",
      promDate: n.getElementsByTagName("공포일자")[0]?.textContent || "",
      effDate: n.getElementsByTagName("시행일자")[0]?.textContent || "",
      statusCode: n.getElementsByTagName("현행연혁코드")[0]?.textContent || "",
      lawType: n.getElementsByTagName("법령구분명")[0]?.textContent || "",
    })
  }
  return out
}

// 법제처 API는 특정 쿼리("AI법" 등)에서 검색어를 무시하고 무관한 법령 목록을 반환할 때가 있음.
// 결과 중 최소 1건은 법령명/약칭이 쿼리와 포함 관계여야 유효한 검색 결과로 인정.
export function hasRelatedHit(laws: LawHit[], query: string): boolean {
  const qKey = normalizeAliasKey(query)
  if (!qKey) return false
  return laws.some((h) => {
    const nameKey = normalizeAliasKey(h.name)
    if (nameKey.includes(qKey) || qKey.includes(nameKey)) return true
    if (!h.abbr) return false
    const abbrKey = normalizeAliasKey(h.abbr)
    return abbrKey.includes(qKey) || qKey.includes(abbrKey)
  })
}

// '광진구 복무 조례'처럼 조례 키워드나 지역명 토큰(○○시/군/구)이 있으면 자치법규 쿼리로 판단.
// '도'는 도로법·양도세 등 오탐이 많아 제외. 토큰 3자 미만('구', '시')도 제외.
function looksLikeOrdinanceQuery(query: string): boolean {
  if (query.includes("조례")) return true
  return query.split(/\s+/).some((t) => t.length >= 3 && /[시군구]$/.test(t))
}

function formatHit(idx: number, h: LawHit): string {
  const status = h.statusCode === "연혁" ? " ⚠️[연혁-과거버전]" : h.statusCode === "현행" ? " [현행]" : ""
  let line = `${idx}. ${h.name}${status}\n   - 법령ID: ${h.lawId}\n   - MST: ${h.mst}\n   - 공포일: ${h.promDate}`
  if (h.effDate) line += ` / 시행일: ${h.effDate}`
  line += `\n   - 구분: ${h.lawType}\n\n`
  return line
}

export async function searchLaw(
  apiClient: LawApiClient,
  input: SearchLawInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    // 캐시 키에 apiKey 해시 미포함 — 법제처는 키로 결과를 분기하지 않음
    const cacheKey = `search:${input.query.toLowerCase().trim()}:${input.display}`
    const cached = lawCache.get<string>(cacheKey)
    if (cached) {
      return {
        content: [{
          type: "text",
          text: cached
        }]
      }
    }

    let xmlText = await apiClient.searchLaw(input.query, input.apiKey, input.display)
    let laws = parseLawsXml(xmlText)
    let usedQuery = input.query

    // 0건이면 약칭/오타 확장 쿼리로 자동 재시도
    if (laws.length === 0) {
      const { expanded } = expandLawQuery(input.query)
      for (const expandedQuery of expanded) {
        if (expandedQuery === input.query) continue
        const candidateXml = await apiClient.searchLaw(expandedQuery, input.apiKey, input.display)
        const candidates = parseLawsXml(candidateXml)
        // 확장쿼리와 무관한 목록(법제처가 쿼리 무시)은 버리고 다음 확장쿼리 시도
        if (candidates.length > 0 && hasRelatedHit(candidates, expandedQuery)) {
          xmlText = candidateXml
          laws = candidates
          usedQuery = expandedQuery
          break
        }
      }
    }

    if (laws.length === 0) {
      // 공포됐지만 미시행인 신규 법령은 현행(target=law) 검색에 안 잡힘 → 시행예정 보조검색
      const upcomingOnly = await fetchUpcomingLaws(apiClient, input.query, input.apiKey)
      if (upcomingOnly.length > 0) {
        const text = `현행 법령 0건 — 단, 공포 후 시행 대기 중인 법령이 있습니다:\n\n` +
          buildUpcomingNotes([], upcomingOnly) +
          `⚠️ 현재 시점에는 아직 효력이 없는 법령입니다. 현행 기준 답변에 인용하지 마세요.\n`
        return { content: [{ type: "text", text: truncateResponse(text) }] }
      }

      // Fallback: 외국환거래규정·은행업감독규정 등 "규정/고시"는 행정규칙(고시)임.
      // 일반 법령에 없으면 search_admin_rule 자동 시도.
      const adminFallback = await searchAdminRule(apiClient, {
        query: input.query,
        display: input.display,
        apiKey: input.apiKey,
      }).catch(() => null)

      if (adminFallback && !adminFallback.isError) {
        const text = adminFallback.content[0]?.text || ""
        const prefix = `[FALLBACK] 법령 '${input.query}' 0건 → 행정규칙으로 자동 폴백.\n` +
                       `💡 '규정/고시/훈령/예규/지침'은 행정규칙이며 search_admin_rule이 본 도구입니다.\n\n`
        return {
          content: [{ type: "text", text: truncateResponse(prefix + text) }],
        }
      }
      // Fallback: 조례·규칙(지자체)은 자치법규라 국가법령 검색에 안 잡힘.
      // 쿼리가 자치법규 형태면 search_ordinance 자동 시도.
      if (looksLikeOrdinanceQuery(input.query)) {
        const ordinFallback = await searchOrdinance(apiClient, {
          query: input.query,
          display: Math.min(input.display, 100),
          apiKey: input.apiKey,
        }).catch(() => null)

        if (ordinFallback && !ordinFallback.isError) {
          const text = ordinFallback.content[0]?.text || ""
          const prefix = `[FALLBACK] 법령 '${input.query}' 0건 → 자치법규로 자동 폴백.\n` +
                         `💡 조례·규칙(지자체)은 자치법규이며 search_ordinance(execute_tool 경유)가 본 도구입니다.\n\n`
          return {
            content: [{ type: "text", text: truncateResponse(prefix + text) }],
          }
        }
      }
      return noResultHint(input.query, "법령")
    }

    // 정확매칭 분리: 법제처 API는 LIKE 검색 + 가나다순 정렬이라
    // "상법"같이 짧은 법령명은 "보상법/배상법/기상법" 등에 묻혀버림.
    // 법령명/약칭이 사용자 입력(또는 canonical alias)과 정확히 같으면 우선 노출.
    const queryKey = normalizeAliasKey(input.query)
    const canonicalKey = normalizeAliasKey(resolveLawAlias(input.query).canonical)

    // 현행 우선 정렬: 연혁(과거버전) 법령이 정확매칭 첫 항목으로 노출되면
    // LLM이 옛 조문을 현행으로 오인해 답변하는 사고가 남 (소방시설법 분법 사례).
    laws.sort((a, b) => {
      const rank = (h: LawHit) => h.statusCode === "연혁" ? 1 : 0
      return rank(a) - rank(b)
    })

    const exact: LawHit[] = []
    const partial: LawHit[] = []
    for (const h of laws) {
      const nameKey = normalizeAliasKey(h.name)
      const abbrKey = h.abbr ? normalizeAliasKey(h.abbr) : ""
      const isExact = nameKey === queryKey
        || nameKey === canonicalKey
        || (abbrKey && (abbrKey === queryKey || abbrKey === canonicalKey))
      if (isExact) exact.push(h)
      else partial.push(h)
    }

    let resultText = `검색 결과 (총 ${laws.length}건`
    if (usedQuery !== input.query) {
      resultText += `, 확장쿼리: "${usedQuery}"`
    }
    resultText += `):\n\n`

    let counter = 0
    if (exact.length > 0) {
      resultText += `📍 정확매칭 (${exact.length}건):\n`
      for (const h of exact) {
        counter++
        resultText += formatHit(counter, h)
      }
    }

    if (partial.length > 0) {
      const partialShown = Math.min(partial.length, Math.max(0, input.display - exact.length))
      resultText += `📂 부분매칭 (${partial.length}건 중 ${partialShown}건 표시):\n`
      for (let i = 0; i < partialShown; i++) {
        counter++
        resultText += formatHit(counter, partial[i])
      }
    }

    // 시행예정 병기: 제명변경 개정(구명칭→신명칭)이 공포~시행 사이면 신명칭 검색 시
    // "정확매칭 없음"만 떠서 LLM이 "법령 없음"으로 오판 → 신·구 명칭 매핑을 명시
    const upcoming = await fetchUpcomingLaws(apiClient, usedQuery, input.apiKey)
    const upcomingNotes = buildUpcomingNotes(laws, upcoming)
    if (upcomingNotes) resultText += upcomingNotes

    // 다음 단계 힌트: 정확매칭이 있으면 그 첫 항목, 없으면 부분매칭 첫 항목 안내
    const primary = exact[0] || partial[0]
    if (primary) {
      resultText += `💡 다음: get_law_text(mst="${primary.mst}") 로 「${primary.name}」 조문 전문. 특정 조문만은 jo="제N조" 추가.\n`
      if (primary.statusCode === "연혁") {
        resultText += `⚠️ 위 법령은 **연혁(과거버전)** 입니다. 현행 기준 답변에는 [현행] 표시된 법령의 MST를 사용하세요.\n`
      }
    }
    if (exact.length === 0 && laws.length > 0) {
      resultText += `⚠️ 정확매칭 없음 — 법제처 API의 부분 LIKE 검색 특성상 위 결과는 법령명에 "${input.query}"가 포함된 모든 법령입니다. 의도한 법령이 없으면 정식 법령명으로 재검색하세요.\n`
    }

    // Cache the result (1 hour TTL)
    const truncated = truncateResponse(resultText)
    lawCache.set(cacheKey, truncated, 60 * 60 * 1000)

    return {
      content: [{
        type: "text",
        text: truncated
      }]
    }
  } catch (error) {
    return formatToolError(error, "search_law")
  }
}
