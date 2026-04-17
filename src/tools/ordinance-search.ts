/**
 * search_ordinance Tool - 자치법규 검색
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { normalizeLawSearchText, expandOrdinanceQuery } from "../lib/search-normalizer.js"
import { parseSearchXML, extractTag } from "../lib/xml-parser.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"

export const SearchOrdinanceSchema = z.object({
  query: z.string().describe("검색할 자치법규명 (예: '서울', '환경')"),
  display: z.number().min(1).max(100).default(20).describe("페이지당 결과 개수 (기본값: 20, 최대: 100)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
})

export type SearchOrdinanceInput = z.infer<typeof SearchOrdinanceSchema>

export async function searchOrdinance(
  apiClient: LawApiClient,
  input: SearchOrdinanceInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    // 검색어 정규화 (약칭 해결, 오타 보정)
    const normalizedQuery = normalizeLawSearchText(input.query)

    // 1차 검색 시도
    let xmlText = await apiClient.searchOrdinance({
      query: normalizedQuery,
      display: input.display || 20,
      apiKey: input.apiKey
    })

    // parseSearchXML 사용 (rootTag: OrdinSearch, itemTag: law)
    let parsed = parseSearchXML(
      xmlText, "OrdinSearch", "law",
      (content) => ({
        자치법규일련번호: extractTag(content, "자치법규일련번호"),
        자치법규명: extractTag(content, "자치법규명"),
        지자체기관명: extractTag(content, "지자체기관명"),
        공포일자: extractTag(content, "공포일자"),
        시행일자: extractTag(content, "시행일자"),
        자치법규상세링크: extractTag(content, "자치법규상세링크"),
      })
    )
    let totalCount = parsed.totalCnt
    let usedQuery = normalizedQuery

    // 검색 결과 없으면 확장 쿼리로 자동 재시도
    if (totalCount === 0) {
      const { expanded } = expandOrdinanceQuery(input.query)

      for (const expandedQuery of expanded) {
        xmlText = await apiClient.searchOrdinance({
          query: expandedQuery,
          display: input.display || 20,
          apiKey: input.apiKey
        })

        parsed = parseSearchXML(
          xmlText, "OrdinSearch", "law",
          (content) => ({
            자치법규일련번호: extractTag(content, "자치법규일련번호"),
            자치법규명: extractTag(content, "자치법규명"),
            지자체기관명: extractTag(content, "지자체기관명"),
            공포일자: extractTag(content, "공포일자"),
            시행일자: extractTag(content, "시행일자"),
            자치법규상세링크: extractTag(content, "자치법규상세링크"),
          })
        )
        totalCount = parsed.totalCnt

        if (totalCount > 0) {
          usedQuery = expandedQuery
          break
        }
      }
    }

    const currentPage = parsed.page
    const ordinances = parsed.items

    if (totalCount === 0) {
      // 확장 검색도 실패한 경우, 시도한 쿼리들 안내
      const { expanded } = expandOrdinanceQuery(input.query)
      const triedQueries = [normalizedQuery, ...expanded].slice(0, 3).join("', '")
      const keywords = input.query.trim().split(/\s+/)
      const hint = [`[NOT_FOUND] '${input.query}' 자치법규 검색 결과가 없습니다.`, `시도한 검색어: '${triedQueries}'`, "", "⚠️ LLM은 조례 내용을 추측하지 마세요. 사용자에게 '검색 실패'를 보고하세요."]
      if (keywords.length >= 2) {
        hint.push("")
        hint.push("힌트: 법제처 API는 공백 구분 키워드를 AND 조건으로 처리합니다. 키워드가 많을수록 결과가 줄어듭니다.")
        hint.push(`재시도 제안: "${keywords[0]}" 또는 "${keywords.slice(0, 2).join(" ")}"`)
      }
      return {
        content: [{ type: "text", text: hint.join("\n") }],
        isError: true,
      }
    }

    let output = `자치법규 검색 결과 (총 ${totalCount}건, ${currentPage}페이지`
    if (usedQuery !== normalizedQuery) {
      output += `, 확장쿼리: "${usedQuery}"`
    }
    output += `):\n\n`

    for (const ordin of ordinances) {
      output += `[${ordin.자치법규일련번호}] ${ordin.자치법규명}\n`
      output += `  지자체: ${ordin.지자체기관명 || "N/A"}\n`
      output += `  공포일: ${ordin.공포일자 || "N/A"}\n`
      output += `  시행일: ${ordin.시행일자 || "N/A"}\n`
      if (ordin.자치법규상세링크) {
        output += `  링크: ${ordin.자치법규상세링크}\n`
      }
      output += `\n`
    }

    // 다음 단계 힌트 — 자치법규 ID로 본문 조회 유도
    if (ordinances.length > 0 && ordinances[0].자치법규일련번호) {
      output += `💡 다음: get_ordinance(id="${ordinances[0].자치법규일련번호}") 로 본문 조회. 원하는 규정 없으면 상위 법령 검색도 고려 (예: 휴직·복무·징계 → 지방공무원법).\n`
    }

    return {
      content: [{
        type: "text",
        text: truncateResponse(output)
      }]
    }
  } catch (error) {
    return formatToolError(error, "search_ordinance")
  }
}

