/**
 * get_ordinance Tool - 자치법규 조회
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"

export const GetOrdinanceSchema = z.object({
  ordinSeq: z.string().describe("자치법규 일련번호")
})

export type GetOrdinanceInput = z.infer<typeof GetOrdinanceSchema>

export async function getOrdinance(
  apiClient: LawApiClient,
  input: GetOrdinanceInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const jsonText = await apiClient.getOrdinance(input.ordinSeq)
    const json = JSON.parse(jsonText)

    const lawService = json?.LawService

    if (!lawService) {
      return {
        content: [{
          type: "text",
          text: "자치법규 데이터를 찾을 수 없습니다."
        }],
        isError: true
      }
    }

    const ordinance = lawService.자치법규기본정보 || {}

    let resultText = `자치법규명: ${ordinance.자치법규명 || "알 수 없음"}\n`
    resultText += `제정일: ${ordinance.공포일자 || ""}\n`
    resultText += `자치단체: ${ordinance.지자체기관명 || ""}\n`
    resultText += `시행일: ${ordinance.시행일자 || ""}\n`

    if (ordinance.담당부서명) {
      resultText += `소관부서: ${ordinance.담당부서명}\n`
    }

    resultText += `\n━━━━━━━━━━━━━━━━━━━━━━\n\n`

    // 조문 내용
    const articles = lawService.조문?.조 || []

    if (Array.isArray(articles)) {
      const maxArticles = Math.min(articles.length, 10)

      for (let i = 0; i < maxArticles; i++) {
        const article = articles[i]

        if (article.조제목) {
          resultText += `${article.조제목}\n`
        }

        if (article.조내용) {
          const content = article.조내용
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .trim()

          resultText += `${content}\n\n`
        }
      }

      if (articles.length > maxArticles) {
        resultText += `\n... 외 ${articles.length - maxArticles}개 조문 (생략)\n`
      }
    }

    resultText += `\n💡 자치법규는 시·도 또는 시·군·구에서 제정한 조례 및 규칙입니다.`

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
