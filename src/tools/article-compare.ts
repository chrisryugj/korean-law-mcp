/**
 * compare_articles Tool - 조문 비교
 * 두 법령의 특정 조문을 비교합니다
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { getLawText } from "./law-text.js"

export const CompareArticlesSchema = z.object({
  law1: z.object({
    mst: z.string().optional().describe("법령일련번호"),
    lawId: z.string().optional().describe("법령ID"),
    jo: z.string().describe("조문 번호 (예: '제38조')")
  }).describe("첫 번째 법령 정보"),
  law2: z.object({
    mst: z.string().optional().describe("법령일련번호"),
    lawId: z.string().optional().describe("법령ID"),
    jo: z.string().describe("조문 번호 (예: '제25조')")
  }).describe("두 번째 법령 정보"),
  apiKey: z.string().optional().describe("사용자 API 키 (https://open.law.go.kr 에서 발급, 없으면 서버 기본값 사용)")
})

export type CompareArticlesInput = z.infer<typeof CompareArticlesSchema>

export async function compareArticles(
  apiClient: LawApiClient,
  input: CompareArticlesInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    // Fetch both articles
    const result1 = await getLawText(apiClient, {
      mst: input.law1.mst,
      lawId: input.law1.lawId,
      jo: input.law1.jo,
      apiKey: input.apiKey
    })

    const result2 = await getLawText(apiClient, {
      mst: input.law2.mst,
      lawId: input.law2.lawId,
      jo: input.law2.jo,
      apiKey: input.apiKey
    })

    // Check for errors
    if (result1.isError) {
      throw new Error(`첫 번째 법령 조회 실패: ${result1.content[0].text}`)
    }

    if (result2.isError) {
      throw new Error(`두 번째 법령 조회 실패: ${result2.content[0].text}`)
    }

    const text1 = result1.content[0].text
    const text2 = result2.content[0].text

    // Extract law names from results (first line usually contains the law name)
    const lawName1 = text1.split('\n')[0] || "첫 번째 법령"
    const lawName2 = text2.split('\n')[0] || "두 번째 법령"

    let output = `=== 조문 비교 ===\n\n`
    output += `📋 ${lawName1}\n`
    output += `${"-".repeat(60)}\n`
    output += `${text1}\n\n`
    output += `${"-".repeat(60)}\n\n`
    output += `📋 ${lawName2}\n`
    output += `${"-".repeat(60)}\n`
    output += `${text2}\n\n`
    output += `${"-".repeat(60)}\n\n`
    output += `💡 두 조문의 내용을 비교하여 차이점을 확인하세요.`

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
