/**
 * suggest_law_names Tool - 법령명 자동완성
 * 부분 입력에 대해 가능한 법령명을 제안
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { searchLaw } from "./search.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"

export const SuggestLawNamesSchema = z.object({
  partial: z.string().describe("부분 입력된 법령명 (예: '관세', '환경')"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
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
      display: 20,
      apiKey: input.apiKey
    })

    if (searchResult.isError) {
      return searchResult
    }

    const text = searchResult.content[0].text

    // Parse search results to extract law names (정규식 기반 — 출력 포맷 변경에 안전)
    const lines = text.split('\n')
    const suggestions: Array<{ name: string; type: string }> = []

    let currentName = ""
    for (const line of lines) {
      // 법령명 라인: "1. 관세법", "2. 관세법 시행령" 등
      const nameMatch = line.match(/^\d+\.\s+(.+)$/)
      if (nameMatch) {
        currentName = nameMatch[1].trim()
        continue
      }
      // 구분 라인: "   - 구분: 법률" (법령명 이후 어느 위치든 매칭)
      if (currentName) {
        const typeMatch = line.match(/구분:\s+(.+)/)
        if (typeMatch) {
          suggestions.push({ name: currentName, type: typeMatch[1].trim() })
          currentName = ""
        }
      }
    }

    if (suggestions.length === 0) {
      return {
        content: [{
          type: "text",
          text: `[NOT_FOUND] '${input.partial}'로 시작하는 법령을 찾을 수 없습니다.\n⚠️ LLM은 법령명을 추측하지 마세요.`
        }],
        isError: true
      }
    }

    let output = `=== 법령명 자동완성: "${input.partial}" ===\n\n`

    // Group by type
    const laws = suggestions.filter(s => s.type === "법률")
    const decrees = suggestions.filter(s => s.type === "대통령령")
    const rules = suggestions.filter(s => s.type === "총리령" || s.type === "부령")

    if (laws.length > 0) {
      output += `법률 (${laws.length}건)\n`
      for (const law of laws.slice(0, 10)) {
        output += `  • ${law.name}\n`
      }
      if (laws.length > 10) {
        output += `  ... 외 ${laws.length - 10}건\n`
      }
      output += `\n`
    }

    if (decrees.length > 0) {
      output += `시행령 (${decrees.length}건)\n`
      for (const decree of decrees.slice(0, 5)) {
        output += `  • ${decree.name}\n`
      }
      if (decrees.length > 5) {
        output += `  ... 외 ${decrees.length - 5}건\n`
      }
      output += `\n`
    }

    if (rules.length > 0) {
      output += `시행규칙 (${rules.length}건)\n`
      for (const rule of rules.slice(0, 5)) {
        output += `  • ${rule.name}\n`
      }
      if (rules.length > 5) {
        output += `  ... 외 ${rules.length - 5}건\n`
      }
      output += `\n`
    }

    // 후속 도구 안내 제거 (LLM이 이미 도구 목록을 알고 있음)

    return {
      content: [{
        type: "text",
        text: truncateResponse(output)
      }]
    }
  } catch (error) {
    return formatToolError(error, "suggest_law_names")
  }
}
