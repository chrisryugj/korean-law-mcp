/**
 * get_law_text Tool - 법령 조문 조회
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { buildJO } from "../lib/law-parser.js"

export const GetLawTextSchema = z.object({
  mst: z.string().optional().describe("법령일련번호 (search_law에서 획득)"),
  lawId: z.string().optional().describe("법령ID (search_law에서 획득)"),
  jo: z.string().optional().describe("조문 번호 (예: '제38조' 또는 '003800')"),
  efYd: z.string().optional().describe("시행일자 (YYYYMMDD 형식)")
}).refine(data => data.mst || data.lawId, {
  message: "mst 또는 lawId 중 하나는 필수입니다"
})

export type GetLawTextInput = z.infer<typeof GetLawTextSchema>

export async function getLawText(
  apiClient: LawApiClient,
  input: GetLawTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    // 조문 번호가 한글이면 JO 코드로 변환
    let joCode = input.jo
    if (joCode && /제\d+조/.test(joCode)) {
      try {
        joCode = buildJO(joCode)
      } catch (e) {
        return {
          content: [{
            type: "text",
            text: `조문 번호 변환 실패: ${e instanceof Error ? e.message : String(e)}`
          }],
          isError: true
        }
      }
    }

    const jsonText = await apiClient.getLawText({
      mst: input.mst,
      lawId: input.lawId,
      jo: joCode,
      efYd: input.efYd
    })

    const json = JSON.parse(jsonText)

    // JSON 구조 파싱
    const lawInfo = json?.LawService || json?.법령 || json
    const lawName = lawInfo?.법령명 || lawInfo?.법령명_한글 || "알 수 없음"
    const promDate = lawInfo?.공포일자 || ""
    const effDate = lawInfo?.시행일자 || ""

    let resultText = `법령명: ${lawName}\n`
    if (promDate) resultText += `공포일: ${promDate}\n`
    if (effDate) resultText += `시행일: ${effDate}\n`
    resultText += `\n`

    // 조문 내용 추출
    const articles = lawInfo?.조문 || []
    const articleArray = Array.isArray(articles) ? articles : [articles]

    if (articleArray.length === 0) {
      return {
        content: [{
          type: "text",
          text: resultText + "조문 내용을 찾을 수 없습니다."
        }]
      }
    }

    for (const article of articleArray) {
      const joNum = article?.조문번호 || article?.조번호 || ""
      const joTitle = article?.조문제목 || article?.조제목 || ""
      const joContent = article?.조문내용 || article?.조내용 || ""

      if (joNum) {
        resultText += `${joNum}`
        if (joTitle) resultText += ` ${joTitle}`
        resultText += `\n`
      }

      if (joContent) {
        // HTML 태그 제거 (간단한 처리)
        const cleanContent = joContent
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
          .trim()

        resultText += `${cleanContent}\n\n`
      }
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
