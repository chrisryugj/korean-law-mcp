/**
 * get_article_with_precedents Tool - 조문 조회 + 관련 판례 자동 조회
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { getLawText, GetLawTextInput } from "./law-text.js"
import { searchPrecedents } from "./precedents.js"

export const GetArticleWithPrecedentsSchema = z.object({
  mst: z.string().optional().describe("법령일련번호 (search_law에서 획득)"),
  lawId: z.string().optional().describe("법령ID (search_law에서 획득)"),
  jo: z.string().describe("조문 번호 (예: '제38조')"),
  efYd: z.string().optional().describe("시행일자 (YYYYMMDD 형식)"),
  includePrecedents: z.boolean().optional().default(true).describe("관련 판례 포함 여부")
}).refine(data => data.mst || data.lawId, {
  message: "mst 또는 lawId 중 하나는 필수입니다"
})

export type GetArticleWithPrecedentsInput = z.infer<typeof GetArticleWithPrecedentsSchema>

export async function getArticleWithPrecedents(
  apiClient: LawApiClient,
  input: GetArticleWithPrecedentsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    // 1. 조문 조회
    const articleResult = await getLawText(apiClient, {
      mst: input.mst,
      lawId: input.lawId,
      jo: input.jo,
      efYd: input.efYd
    } as GetLawTextInput)

    if (articleResult.isError || !input.includePrecedents) {
      return articleResult
    }

    let resultText = articleResult.content[0].text

    // 2. 법령명 추출 (조문 결과에서)
    const lawNameMatch = resultText.match(/법령명: (.+?)\n/)
    if (!lawNameMatch) {
      return articleResult // 법령명을 찾을 수 없으면 조문만 반환
    }

    const lawName = lawNameMatch[1].trim()
    const joNumber = input.jo.replace(/제|조/g, '').trim()

    // 3. 관련 판례 검색
    const precedentQuery = `${lawName} ${input.jo}`

    try {
      const precedentResult = await searchPrecedents(apiClient, {
        query: precedentQuery,
        display: 5,
        page: 1
      })

      if (!precedentResult.isError) {
        const precedentText = precedentResult.content[0].text

        // 판례 결과가 있으면 추가
        if (precedentText && !precedentText.includes("검색 결과가 없습니다")) {
          resultText += `\n${"=".repeat(60)}\n`
          resultText += `\n📚 관련 판례 (상위 5건)\n\n`
          resultText += precedentText
          resultText += `\n💡 판례 전문을 보려면 get_precedent_text Tool을 사용하세요.`
        } else {
          resultText += `\n\n📚 관련 판례: 검색 결과 없음`
        }
      }
    } catch (error) {
      // 판례 검색 실패는 무시하고 조문 내용만 반환
      console.error(`판례 검색 실패: ${error}`)
    }

    return {
      content: [{
        type: "text",
        text: resultText
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
