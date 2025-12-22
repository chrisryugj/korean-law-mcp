/**
 * suggest_law_names Tool - 법령명 자동완성
 * 부분 입력에 대해 가능한 법령명을 제안
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { searchLaw } from "./search.js"

export const SuggestLawNamesSchema = z.object({
  partial: z.string().describe("부분 입력된 법령명 (예: '관세', '환경')"),
  apiKey: z.string().optional().describe("사용자 API 키 (https://open.law.go.kr 에서 발급, 없으면 서버 기본값 사용)")
})

export type SuggestLawNamesInput = z.infer<typeof SuggestLawNamesSchema>

export async function suggestLawNames(
  apiClient: LawApiClient,
  input: SuggestLawNamesInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    if (input.partial.length < 2) {
      return {
        content: [{
          type: "text",
          text: "검색어는 최소 2글자 이상이어야 합니다."
        }],
        isError: true
      }
    }

    // Search for laws matching the partial input
    const searchResult = await searchLaw(apiClient, {
      query: input.partial,
      maxResults: 20,
      apiKey: input.apiKey
    })

    if (searchResult.isError) {
      return searchResult
    }

    const text = searchResult.content[0].text

    // Parse search results to extract law names
    const lines = text.split('\n')
    const suggestions: Array<{ name: string; type: string }> = []

    for (const line of lines) {
      // Match lines like "[1] 관세법 (법률) | MST: 000013"
      const match = line.match(/\[\d+\]\s+(.+?)\s+\((.+?)\)/)
      if (match) {
        const name = match[1].trim()
        const type = match[2].trim()
        suggestions.push({ name, type })
      }
    }

    if (suggestions.length === 0) {
      return {
        content: [{
          type: "text",
          text: `'${input.partial}'로 시작하는 법령을 찾을 수 없습니다.`
        }]
      }
    }

    let output = `=== 법령명 자동완성: "${input.partial}" ===\n\n`

    // Group by type
    const laws = suggestions.filter(s => s.type === "법률")
    const decrees = suggestions.filter(s => s.type === "대통령령")
    const rules = suggestions.filter(s => s.type === "총리령" || s.type === "부령")

    if (laws.length > 0) {
      output += `📜 법률 (${laws.length}건)\n`
      for (const law of laws.slice(0, 10)) {
        output += `  • ${law.name}\n`
      }
      if (laws.length > 10) {
        output += `  ... 외 ${laws.length - 10}건\n`
      }
      output += `\n`
    }

    if (decrees.length > 0) {
      output += `📋 시행령 (${decrees.length}건)\n`
      for (const decree of decrees.slice(0, 5)) {
        output += `  • ${decree.name}\n`
      }
      if (decrees.length > 5) {
        output += `  ... 외 ${decrees.length - 5}건\n`
      }
      output += `\n`
    }

    if (rules.length > 0) {
      output += `📄 시행규칙 (${rules.length}건)\n`
      for (const rule of rules.slice(0, 5)) {
        output += `  • ${rule.name}\n`
      }
      if (rules.length > 5) {
        output += `  ... 외 ${rules.length - 5}건\n`
      }
      output += `\n`
    }

    output += `💡 자세한 정보는 search_law Tool을 사용하세요.`

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
