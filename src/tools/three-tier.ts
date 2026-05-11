/**
 * get_three_tier Tool - 3단비교 (법률→시행령→시행규칙)
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { parseThreeTierDelegation } from "../lib/three-tier-parser.js"
import { cleanHtml } from "../lib/article-parser.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"

export const GetThreeTierSchema = z.object({
  mst: z.string().optional().describe("법령일련번호"),
  lawId: z.string().optional().describe("법령ID"),
  knd: z.enum(["1", "2"]).optional().default("2").describe("1=인용조문, 2=위임조문 (기본값)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
}).refine(data => data.mst || data.lawId, {
  message: "mst 또는 lawId 중 하나는 필수입니다"
})

export type GetThreeTierInput = z.infer<typeof GetThreeTierSchema>

export async function getThreeTier(
  apiClient: LawApiClient,
  input: GetThreeTierInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const jsonText = await apiClient.getThreeTier({
      mst: input.mst,
      lawId: input.lawId,
      knd: input.knd,
      apiKey: input.apiKey
    })
    const json = JSON.parse(jsonText)

    const threeTierData = parseThreeTierDelegation(json)

    const { meta, articles } = threeTierData

    let resultText = `법령명: ${meta.lawName}\n`
    if (meta.sihyungryungName) {
      resultText += `시행령: ${meta.sihyungryungName}\n`
    }
    if (meta.sihyungkyuchikName) {
      resultText += `시행규칙: ${meta.sihyungkyuchikName}\n`
    }
    resultText += `\n`

    if (articles.length === 0) {
      return {
        content: [{
          type: "text",
          text: resultText + "3단비교 데이터가 없습니다."
        }]
      }
    }

    // 최대 5개 조문만 표시 (너무 길어질 수 있음)
    const maxArticles = Math.min(articles.length, 5)

    for (let i = 0; i < maxArticles; i++) {
      const article = articles[i]

      resultText += `---\n`
      resultText += `${article.joNum}`
      if (article.title) resultText += ` ${article.title}`
      resultText += `\n---\n\n`

      if (article.delegations.length === 0) {
        resultText += `(위임 조문 없음)\n\n`
        continue
      }

      for (const delegation of article.delegations) {
        const typeLabel = delegation.type === "시행령" ? "[시행령]"
                        : delegation.type === "시행규칙" ? "[시행규칙]"
                        : "[행정규칙]"

        resultText += `${typeLabel} ${delegation.lawName}`
        if (delegation.joNum) resultText += ` ${delegation.joNum}`
        if (delegation.title) resultText += ` (${delegation.title})`
        resultText += `\n`

        if (delegation.content) {
          const cleanContent = cleanHtml(delegation.content)

          // 너무 길면 줄 경계에서 자르기 (위임 내용은 법적으로 중요하므로 500자)
          if (cleanContent.length > 500) {
            const lastNewline = cleanContent.lastIndexOf('\n', 500)
            const cutPos = lastNewline > 300 ? lastNewline : 500
            resultText += `${cleanContent.substring(0, cutPos)}\n   (위임 내용 ${cleanContent.length.toLocaleString()}자 중 일부만 표시)\n\n`
          } else if (cleanContent) {
            resultText += `${cleanContent}\n\n`
          }
        } else {
          resultText += `\n`
        }
      }
    }

    if (articles.length > maxArticles) {
      resultText += `\n... 외 ${articles.length - maxArticles}개 조문 (생략)\n`
      resultText += `전체 ${articles.length}개 조문 중 처음 ${maxArticles}개만 표시합니다.\n`
    }

    return {
      content: [{
        type: "text",
        text: truncateResponse(resultText)
      }]
    }
  } catch (error) {
    return formatToolError(error, "get_three_tier")
  }
}
