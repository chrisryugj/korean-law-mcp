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
  display: z.number().min(1).max(50).default(10).describe("각 유형별 최대 결과 개수 (기본값: 10)"),
  apiKey: z.string().optional().describe("API 키")
})

export type SearchAllInput = z.infer<typeof SearchAllSchema>

/**
 * 검색 결과에서 각 항목의 핵심 정보(법령명, ID, MST)를 보존하면서 요약.
 * 기존의 5줄 자르기 방식은 lawId/MST가 잘려서 후속 조회가 불가능했음.
 */
function summarizeSearchResult(text: string, maxItems: number): string {
  const lines = text.split('\n')
  // "N. 법령명" 패턴으로 항목 시작점 식별
  const itemStarts: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (/^\d+\.\s/.test(lines[i])) {
      itemStarts.push(i)
    }
  }

  if (itemStarts.length === 0) {
    // 항목 패턴이 없으면 첫 줄(총건수 등) + 제한된 줄 반환
    return lines.slice(0, maxItems * 3).join('\n') + '\n'
  }

  // 헤더(첫 항목 전 텍스트)
  const header = itemStarts[0] > 0
    ? lines.slice(0, itemStarts[0]).join('\n').trim() + '\n'
    : ''

  // 각 항목을 통째로 유지 (법령명 + ID + MST 등 메타데이터 보존)
  const items: string[] = []
  const limit = Math.min(itemStarts.length, maxItems)
  for (let i = 0; i < limit; i++) {
    const start = itemStarts[i]
    const end = i + 1 < itemStarts.length ? itemStarts[i + 1] : lines.length
    items.push(lines.slice(start, end).join('\n').trimEnd())
  }

  let result = header + items.join('\n') + '\n'
  if (itemStarts.length > limit) {
    result += `... 외 ${itemStarts.length - limit}건\n`
  }
  return result
}

export async function searchAll(
  apiClient: LawApiClient,
  input: SearchAllInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const display = input.display || 10

    // Parallel searches for all three types
    const [lawResult, adminRuleResult, ordinanceResult] = await Promise.all([
      searchLaw(apiClient, { query: input.query, display, apiKey: input.apiKey }).catch(e => ({
        content: [{ type: "text", text: `법령 검색 실패: ${e.message}` }],
        isError: true
      })),
      searchAdminRule(apiClient, { query: input.query, display, apiKey: input.apiKey }).catch(e => ({
        content: [{ type: "text", text: `행정규칙 검색 실패: ${e.message}` }],
        isError: true
      })),
      searchOrdinance(apiClient, { query: input.query, display, apiKey: input.apiKey }).catch(e => ({
        content: [{ type: "text", text: `자치법규 검색 실패: ${e.message}` }],
        isError: true
      }))
    ])

    // 각 결과에서 핵심 정보(법령명, ID, MST)를 보존하면서 요약
    const maxLinesPerCategory = Math.max(3, Math.min(15, Math.floor(30 / 3)))

    let output = `=== 통합 검색 결과: "${input.query}" ===\n\n`

    // Law results
    output += `[법령]\n`
    if (!lawResult.isError) {
      output += summarizeSearchResult(lawResult.content[0]?.text || "", maxLinesPerCategory)
    } else {
      output += `${lawResult.content[0]?.text || "검색 실패"}\n`
    }
    output += `\n`

    // Admin rule results
    output += `[행정규칙]\n`
    if (!adminRuleResult.isError) {
      output += summarizeSearchResult(adminRuleResult.content[0]?.text || "", maxLinesPerCategory)
    } else {
      output += `${adminRuleResult.content[0]?.text || "검색 실패"}\n`
    }
    output += `\n`

    // Ordinance results
    output += `[자치법규]\n`
    if (!ordinanceResult.isError) {
      output += summarizeSearchResult(ordinanceResult.content[0]?.text || "", maxLinesPerCategory)
    } else {
      output += `${ordinanceResult.content[0]?.text || "검색 실패"}\n`
    }
    output += `\n`

    output += `각 영역의 상세 검색: search_law / search_admin_rule / search_ordinance`

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
