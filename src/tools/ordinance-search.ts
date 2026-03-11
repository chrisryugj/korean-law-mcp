/**
 * search_ordinance Tool - 자치법규 검색
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { normalizeLawSearchText, expandOrdinanceQuery } from "../lib/search-normalizer.js"
import { extractTag } from "../lib/xml-parser.js"

export const SearchOrdinanceSchema = z.object({
  query: z.string().describe("검색할 자치법규명 (예: '서울', '환경')"),
  display: z.number().min(1).max(100).default(20).describe("페이지당 결과 개수 (기본값: 20, 최대: 100)"),
  apiKey: z.string().optional().describe("API 키")
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

    let result = parseOrdinanceXML(xmlText)
    let totalCount = parseInt(result.OrdinSearch?.totalCnt || "0")
    let usedQuery = normalizedQuery

    // 검색 결과 없으면 확장 쿼리로 자동 재시도
    if (totalCount === 0) {
      const { expanded } = expandOrdinanceQuery(input.query)

      for (const expandedQuery of expanded) {
        // 재시도: expandedQuery

        xmlText = await apiClient.searchOrdinance({
          query: expandedQuery,
          display: input.display || 20,
          apiKey: input.apiKey
        })

        result = parseOrdinanceXML(xmlText)
        totalCount = parseInt(result.OrdinSearch?.totalCnt || "0")

        if (totalCount > 0) {
          // 발견: expandedQuery
          usedQuery = expandedQuery
          break
        }
      }
    }

    if (!result.OrdinSearch) {
      throw new Error("Invalid response format from API")
    }

    const data = result.OrdinSearch
    const currentPage = parseInt(data.page || "1")
    const ordinances = data.ordin ? (Array.isArray(data.ordin) ? data.ordin : [data.ordin]) : []

    if (totalCount === 0) {
      // 확장 검색도 실패한 경우, 시도한 쿼리들 안내
      const { expanded } = expandOrdinanceQuery(input.query)
      const triedQueries = [normalizedQuery, ...expanded].slice(0, 3).join("', '")
      return {
        content: [{
          type: "text",
          text: `'${input.query}' 검색 결과가 없습니다.\n\n시도한 검색어: '${triedQueries}'\n\n💡 다른 키워드로 다시 검색해보세요.`
        }]
      }
    }

    let output = `자치법규 검색 결과 (총 ${totalCount}건, ${currentPage}페이지):\n\n`

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

    output += `\n💡 전문을 조회하려면 get_ordinance Tool을 사용하세요.\n`

    return {
      content: [{
        type: "text",
        text: output
      }]
    }
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Error: ${error instanceof Error ? error.message : String(error)}`
      }],
      isError: true
    }
  }
}

// Simple XML parser for ordinance search
function parseOrdinanceXML(xml: string): any {
  const obj: any = {}

  // Extract OrdinSearch
  const ordinSearchMatch = xml.match(/<OrdinSearch[^>]*>([\s\S]*?)<\/OrdinSearch>/)
  if (!ordinSearchMatch) return obj

  const content = ordinSearchMatch[1]
  obj.OrdinSearch = {}

  // Extract totalCnt and page
  const totalCntMatch = content.match(/<totalCnt>([^<]*)<\/totalCnt>/)
  const pageMatch = content.match(/<page>([^<]*)<\/page>/)

  obj.OrdinSearch.totalCnt = totalCntMatch ? totalCntMatch[1] : "0"
  obj.OrdinSearch.page = pageMatch ? pageMatch[1] : "1"

  // Extract law items (자치법규는 <law> 태그로 반환됨)
  const ordinMatches = content.matchAll(/<law[^>]*>([\s\S]*?)<\/law>/g)
  obj.OrdinSearch.ordin = []

  for (const match of ordinMatches) {
    const ordinContent = match[1]
    const ordin: any = {}

    const extract = (tag: string) => extractTag(ordinContent, tag)

    ordin.자치법규일련번호 = extract("자치법규일련번호")
    ordin.자치법규명 = extract("자치법규명")
    ordin.지자체기관명 = extract("지자체기관명")
    ordin.공포일자 = extract("공포일자")
    ordin.시행일자 = extract("시행일자")
    ordin.자치법규상세링크 = extract("자치법규상세링크")

    obj.OrdinSearch.ordin.push(ordin)
  }

  return obj
}
