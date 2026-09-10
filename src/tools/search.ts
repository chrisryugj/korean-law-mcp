/**
 * search_law Tool - 법령 검색
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { lawCache } from "../lib/cache.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"
import { expandLawQuery } from "../lib/search-normalizer.js"
import { formatHit, hasRelatedHit, parseLawsXml, sortCurrentFirst, splitExactPartial } from "./search-hits.js"
import { buildUpcomingNotes, fetchUpcomingLaws } from "../lib/upcoming-laws.js"
import { searchLawFallbacks } from "./search-fallbacks.js"

export const SearchLawSchema = z.object({
  query: z.string().describe("검색할 법령명 (예: '관세법', 'fta특례법', '화관법')"),
  display: z.number().optional().default(50).describe("최대 결과 개수 (기본 50 — 짧은 법령명 정확매칭 누락 방지)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
})

export type SearchLawInput = z.infer<typeof SearchLawSchema>

/**
 * 업스트림 조회 하한 (#89).
 *
 * 법제처는 LIKE 검색 + 가나다순으로 응답하므로 "민법"의 정확매칭이 "난민법·난민법
 * 시행령·난민법 시행규칙" 뒤에 온다. display를 그대로 넘기면 아래 정확/부분 분리에
 * 도달하기 전에 업스트림이 잘라버려 정확매칭이 통째로 사라진다 — 토큰을 아끼려
 * display를 낮춘 클라이언트가 조용히 "다른 법령"을 1순위로 받는다.
 *
 * 그래서 업스트림에는 항상 하한 이상을 요청하고, 사용자가 지정한 display는 분리를
 * 마친 결과에 적용한다. 업스트림 호출 횟수는 늘지 않는다.
 */
const UPSTREAM_DISPLAY_FLOOR = 50

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

    const upstreamDisplay = Math.max(input.display, UPSTREAM_DISPLAY_FLOOR)
    let xmlText = await apiClient.searchLaw(input.query, input.apiKey, upstreamDisplay)
    let laws = parseLawsXml(xmlText)
    let usedQuery = input.query

    // 0건이면 약칭/오타 확장 쿼리로 자동 재시도
    if (laws.length === 0) {
      const { expanded } = expandLawQuery(input.query)
      for (const expandedQuery of expanded) {
        if (expandedQuery === input.query) continue
        const candidateXml = await apiClient.searchLaw(expandedQuery, input.apiKey, upstreamDisplay)
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
      return await searchLawFallbacks(apiClient, input)
    }

    // 현행 우선 정렬 + 정확매칭 분리 (판정은 search-hits.ts — search_law_bulk 와 공용)
    const { exact, partial } = splitExactPartial(sortCurrentFirst(laws), input.query)

    // display는 여기서 — 정확/부분 분리를 마친 "결과"에 적용한다 (#89).
    const exactShown = Math.min(exact.length, input.display)
    const partialShown = Math.min(partial.length, Math.max(0, input.display - exactShown))

    let resultText = `검색 결과 (총 ${laws.length}건`
    if (usedQuery !== input.query) {
      resultText += `, 확장쿼리: "${usedQuery}"`
    }
    if (laws.length > exactShown + partialShown) {
      resultText += `, display=${input.display} 적용`
    }
    resultText += `):\n\n`

    let counter = 0
    if (exactShown > 0) {
      resultText += exact.length > exactShown
        ? `📍 정확매칭 (${exact.length}건 중 ${exactShown}건 표시):\n`
        : `📍 정확매칭 (${exact.length}건):\n`
      for (let i = 0; i < exactShown; i++) {
        counter++
        resultText += formatHit(counter, exact[i])
      }
    }

    if (partial.length > 0) {
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
