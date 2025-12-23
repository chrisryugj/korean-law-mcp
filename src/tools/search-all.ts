/**
 * search_all Tool - 통합 검색
 * 법령, 행정규칙, 자치법규를 한번에 검색
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { searchLaw } from "./search.js"
import { searchAdminRule } from "./admin-rule.js"
import { searchOrdinance } from "./ordinance-search.js"

export const SearchAllSchema = z.object({
  query: z.string().describe("검색할 키워드"),
  maxResults: z.number().min(1).max(50).default(10).describe("각 유형별 최대 결과 개수 (기본값: 10)"),
  apiKey: z.string().optional().describe("API 키")
})

export type SearchAllInput = z.infer<typeof SearchAllSchema>

export async function searchAll(
  apiClient: LawApiClient,
  input: SearchAllInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const maxResults = input.maxResults || 10

    // Parallel searches for all three types
    const [lawResult, adminRuleResult, ordinanceResult] = await Promise.all([
      searchLaw(apiClient, { query: input.query, maxResults, apiKey: input.apiKey }).catch(e => ({
        content: [{ type: "text", text: `법령 검색 실패: ${e.message}` }],
        isError: true
      })),
      searchAdminRule(apiClient, { query: input.query, maxResults, apiKey: input.apiKey }).catch(e => ({
        content: [{ type: "text", text: `행정규칙 검색 실패: ${e.message}` }],
        isError: true
      })),
      searchOrdinance(apiClient, { query: input.query, display: maxResults, apiKey: input.apiKey }).catch(e => ({
        content: [{ type: "text", text: `자치법규 검색 실패: ${e.message}` }],
        isError: true
      }))
    ])

    let output = `=== 통합 검색 결과: "${input.query}" ===\n\n`

    // Law results
    output += `📚 법령 검색 결과\n`
    output += `${"-".repeat(60)}\n`
    if (!lawResult.isError) {
      const lawText = lawResult.content[0].text
      // Extract summary (first 300 chars)
      const lawSummary = lawText.split('\n').slice(0, 5).join('\n')
      output += `${lawSummary}\n`
      if (lawText.length > lawSummary.length) {
        output += `... (자세한 내용은 search_law 사용)\n`
      }
    } else {
      output += `${lawResult.content[0].text}\n`
    }
    output += `\n`

    // Admin rule results
    output += `📋 행정규칙 검색 결과\n`
    output += `${"-".repeat(60)}\n`
    if (!adminRuleResult.isError) {
      const adminText = adminRuleResult.content[0].text
      const adminSummary = adminText.split('\n').slice(0, 5).join('\n')
      output += `${adminSummary}\n`
      if (adminText.length > adminSummary.length) {
        output += `... (자세한 내용은 search_admin_rule 사용)\n`
      }
    } else {
      output += `${adminRuleResult.content[0].text}\n`
    }
    output += `\n`

    // Ordinance results
    output += `🏛️ 자치법규 검색 결과\n`
    output += `${"-".repeat(60)}\n`
    if (!ordinanceResult.isError) {
      const ordinText = ordinanceResult.content[0].text
      const ordinSummary = ordinText.split('\n').slice(0, 5).join('\n')
      output += `${ordinSummary}\n`
      if (ordinText.length > ordinSummary.length) {
        output += `... (자세한 내용은 search_ordinance 사용)\n`
      }
    } else {
      output += `${ordinanceResult.content[0].text}\n`
    }
    output += `\n`

    output += `${"-".repeat(60)}\n`
    output += `💡 각 영역을 더 자세히 검색하려면 해당 검색 Tool을 사용하세요.`

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
