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

    const ordinance = json?.자치법규

    if (!ordinance) {
      return {
        content: [{
          type: "text",
          text: "자치법규 데이터를 찾을 수 없습니다."
        }],
        isError: true
      }
    }

    let resultText = `자치법규명: ${ordinance.자치법규명 || "알 수 없음"}\n`
    resultText += `제정일: ${ordinance.제정일자 || ""}\n`
    resultText += `자치단체: ${ordinance.자치단체명 || ""}\n`

    if (ordinance.소관부서) {
      resultText += `소관부서: ${ordinance.소관부서}\n`
    }

    resultText += `\n━━━━━━━━━━━━━━━━━━━━━━\n\n`

    // 조문 내용
    const articles = ordinance.조문 || []

    if (Array.isArray(articles)) {
      const maxArticles = Math.min(articles.length, 10)

      for (let i = 0; i < maxArticles; i++) {
        const article = articles[i]

        if (article.조문번호) {
          resultText += `${article.조문번호}`
        }
        if (article.조문제목) {
          resultText += ` ${article.조문제목}`
        }
        resultText += `\n`

        if (article.조문내용) {
          const content = article.조문내용
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
    } else if (typeof ordinance.조문내용 === 'string') {
      // 단일 조문인 경우
      const content = ordinance.조문내용
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .trim()

      resultText += `${content}\n`
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
