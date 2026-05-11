/**
 * get_law_tree Tool - 법령 트리 뷰
 * 법률→시행령→시행규칙 트리 구조 시각화
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { getThreeTier } from "./three-tier.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"

export const GetLawTreeSchema = z.object({
  mst: z.string().optional().describe("법령일련번호"),
  lawId: z.string().optional().describe("법령ID"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
})

export type GetLawTreeInput = z.infer<typeof GetLawTreeSchema>

export async function getLawTree(
  apiClient: LawApiClient,
  input: GetLawTreeInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    // Get three-tier data
    const result = await getThreeTier(apiClient, {
      mst: input.mst,
      lawId: input.lawId,
      knd: "2", // 위임조문
      apiKey: input.apiKey
    })

    if (result.isError) {
      return result
    }

    const text = result.content[0].text

    // Parse the three-tier result to extract law structure
    // The result contains sections like "법률 조항", "시행령 조항", "시행규칙 조항"
    const lines = text.split('\n')

    let lawName = ""
    let currentSection = ""
    const structure: {
      law: Array<string>
      decree: Array<string>
      rule: Array<string>
    } = {
      law: [],
      decree: [],
      rule: []
    }

    for (const line of lines) {
      if (line.includes('법률명:')) {
        lawName = line.replace('법률명:', '').trim()
      } else if (line.includes('법률 조항')) {
        currentSection = "law"
      } else if (line.includes('시행령 조항')) {
        currentSection = "decree"
      } else if (line.includes('시행규칙 조항')) {
        currentSection = "rule"
      } else if (line.trim() && currentSection) {
        // Extract article references
        const articleMatch = line.match(/제\d+조(의\d+)?/)
        if (articleMatch) {
          if (currentSection === "law") structure.law.push(articleMatch[0])
          else if (currentSection === "decree") structure.decree.push(articleMatch[0])
          else if (currentSection === "rule") structure.rule.push(articleMatch[0])
        }
      }
    }

    // Build tree visualization
    let output = `=== 법령 트리 구조 ===\n\n`
    output += `${lawName || "법률"}\n`

    if (structure.law.length > 0) {
      output += `\n└─ 법률 (${structure.law.length}개 조항)\n`
      for (const article of structure.law.slice(0, 5)) {
        output += `   ├─ ${article}\n`
      }
      if (structure.law.length > 5) {
        output += `   └─ ... 외 ${structure.law.length - 5}개 조항\n`
      }
    }

    if (structure.decree.length > 0) {
      output += `\n└─ 시행령 (${structure.decree.length}개 조항)\n`
      for (const article of structure.decree.slice(0, 5)) {
        output += `   ├─ ${article}\n`
      }
      if (structure.decree.length > 5) {
        output += `   └─ ... 외 ${structure.decree.length - 5}개 조항\n`
      }
    }

    if (structure.rule.length > 0) {
      output += `\n└─ 시행규칙 (${structure.rule.length}개 조항)\n`
      for (const article of structure.rule.slice(0, 5)) {
        output += `   ├─ ${article}\n`
      }
      if (structure.rule.length > 5) {
        output += `   └─ ... 외 ${structure.rule.length - 5}개 조항\n`
      }
    }

    // 후속 도구 안내 제거 (LLM이 이미 도구 목록을 알고 있음)

    return {
      content: [{
        type: "text",
        text: truncateResponse(output)
      }]
    }
  } catch (error) {
    return formatToolError(error, "get_law_tree")
  }
}
