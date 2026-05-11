/**
 * advanced_search Tool - 고급 검색 (기간, 부처, 복합 검색)
 */

import { z } from "zod"
import { DOMParser } from "@xmldom/xmldom"
import type { LawApiClient } from "../lib/api-client.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"

export const AdvancedSearchSchema = z.object({
  query: z.string().describe("검색 키워드"),
  searchType: z.enum(["law", "admin_rule", "ordinance", "all"]).optional().default("law").describe(
    "검색 대상: law (법령), admin_rule (행정규칙), ordinance (자치법규), all (전체)"
  ),
  fromDate: z.string().optional().describe("제정일 시작 (YYYYMMDD)"),
  toDate: z.string().optional().describe("제정일 종료 (YYYYMMDD)"),
  org: z.string().optional().describe("소관부처코드"),
  operator: z.enum(["AND", "OR"]).optional().default("AND").describe("키워드 결합 연산자"),
  display: z.number().optional().default(20).describe("최대 결과 개수"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
})

export type AdvancedSearchInput = z.infer<typeof AdvancedSearchSchema>

export async function advancedSearch(
  apiClient: LawApiClient,
  input: AdvancedSearchInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    // 키워드 분리 (공백 기준)
    const keywords = input.query.split(/\s+/).filter(k => k.length > 0)

    let results: Array<{ name: string, id: string, type: string, date: string }> = []

    // 검색 대상별로 실행 (병렬)
    const searchTargets = input.searchType === "all"
      ? ["law", "admin_rule", "ordinance"]
      : [input.searchType]

    const targetResults = await Promise.all(
      searchTargets.map(target => searchByType(apiClient, target, keywords, input, input.apiKey))
    )
    results = targetResults.flat()

    // AND/OR 연산 적용
    if (input.operator === "AND" && keywords.length > 1) {
      results = filterByAnd(results, keywords)
    }

    // 기간 필터링
    if (input.fromDate || input.toDate) {
      results = filterByDate(results, input.fromDate, input.toDate)
    }

    // 상위 N개만
    results = results.slice(0, input.display)

    // 결과 포맷
    let resultText = `고급 검색 결과 (${results.length}건)\n\n`
    resultText += `검색어: ${input.query}\n`
    resultText += `연산자: ${input.operator}\n`
    if (input.fromDate || input.toDate) {
      resultText += `기간: ${input.fromDate || "시작"} ~ ${input.toDate || "종료"}\n`
    }
    resultText += `\n`

    results.forEach((result, idx) => {
      resultText += `${idx + 1}. ${result.name}\n`
      resultText += `   - ID: ${result.id}\n`
      resultText += `   - 유형: ${result.type}\n`
      resultText += `   - 날짜: ${result.date}\n\n`
    })

    return {
      content: [{
        type: "text",
        text: truncateResponse(resultText)
      }]
    }
  } catch (error) {
    return formatToolError(error, "advanced_search")
  }
}

/**
 * 검색 대상별 검색 실행
 */
async function searchByType(
  apiClient: LawApiClient,
  type: string,
  keywords: string[],
  input: AdvancedSearchInput,
  apiKey?: string
): Promise<Array<{ name: string, id: string, type: string, date: string }>> {
  const query = keywords.join(" ")
  const results: Array<{ name: string, id: string, type: string, date: string }> = []

  try {
    let xmlText = ""

    if (type === "law") {
      xmlText = await apiClient.searchLaw(query, apiKey)
    } else if (type === "admin_rule") {
      xmlText = await apiClient.searchAdminRule({ query, apiKey })
    } else if (type === "ordinance") {
      xmlText = await apiClient.searchOrdinance({ query, display: 100, apiKey })
    }

    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlText, "text/xml")

    // 검색 대상별 XML 태그명 매핑
    const tagMap: Record<string, string> = { law: "law", admin_rule: "admrul", ordinance: "ordin" }
    const tagName = tagMap[type] || "law"
    const items = doc.getElementsByTagName(tagName)

    for (let i = 0; i < items.length; i++) {
      const item = items[i]

      // 검색 대상별 필드명 매핑
      const name = item.getElementsByTagName("법령명한글")[0]?.textContent ||
        item.getElementsByTagName("행정규칙명")[0]?.textContent ||
        item.getElementsByTagName("자치법규명")[0]?.textContent ||
        "알 수 없음"

      const id = item.getElementsByTagName("법령ID")[0]?.textContent ||
        item.getElementsByTagName("행정규칙일련번호")[0]?.textContent ||
        item.getElementsByTagName("자치법규ID")[0]?.textContent ||
        ""

      const date = item.getElementsByTagName("공포일자")[0]?.textContent ||
        item.getElementsByTagName("시행일자")[0]?.textContent ||
        item.getElementsByTagName("제정일자")[0]?.textContent ||
        ""

      results.push({ name, id, type, date })
    }
  } catch (e) {
    // 인증/권한 에러는 전파, 그 외는 빈 배열 (부분 실패 허용)
    if (e instanceof Error && /429|401|403|API 키/.test(e.message)) throw e
  }

  return results
}

/**
 * AND 연산 필터링 (모든 키워드 포함 여부)
 */
function filterByAnd(
  results: Array<{ name: string, id: string, type: string, date: string }>,
  keywords: string[]
): Array<{ name: string, id: string, type: string, date: string }> {
  // 안전: includes() 사용 (regex가 아님) → injection 위험 없음
  return results.filter(result => {
    const name = (result.name || "").toLowerCase()
    return keywords.every(keyword => name.includes(keyword.toLowerCase()))
  })
}

/**
 * 날짜 필터링
 */
function filterByDate(
  results: Array<{ name: string, id: string, type: string, date: string }>,
  fromDate?: string,
  toDate?: string
): Array<{ name: string, id: string, type: string, date: string }> {
  return results.filter(result => {
    if (!result.date) return false

    const dateStr = result.date.replace(/-/g, "")

    if (fromDate && dateStr < fromDate) return false
    if (toDate && dateStr > toDate) return false

    return true
  })
}
