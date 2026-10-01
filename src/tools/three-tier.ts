/**
 * get_three_tier Tool - 3단비교 (법률→시행령→시행규칙)
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { parseThreeTierCitation } from "../lib/three-tier-citation.js"
import { parseThreeTierDelegation } from "../lib/three-tier-parser.js"
import { cleanHtml } from "../lib/article-parser.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"
import { lawCache } from "../lib/cache.js"

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
    // 3단비교 응답은 조문 필터가 없어 통째로 온다(관세법 1.98 MB, JO·display 무시 실측). 같은 법령을 체인 여럿
    // (law_system·action_basis·ordinance_compare·procedure_detail)이 부르므로 렌더 결과를 캐시한다(2026-09-28 성능 감사).
    // 옛 MST 를 줘도 늘 현행 3단비교가 온다(MST 는 법령을 고를 뿐, 리뷰 실측) — 시행령·시행규칙 개정을 넘기지 않게 1시간만 둔다.
    // 체인은 스키마를 거치지 않아 knd 가 비어 온다 — 기본값 2로 맞춰 키를 하나로
    const cacheKey = `thdcmp:${input.mst ? `m${input.mst}` : `i${input.lawId}`}:${input.knd || "2"}`
    const cached = lawCache.get<string>(cacheKey)
    if (cached) return { content: [{ type: "text", text: cached }] }

    const jsonText = await apiClient.getThreeTier({
      mst: input.mst,
      lawId: input.lawId,
      knd: input.knd,
      apiKey: input.apiKey
    })
    const json = JSON.parse(jsonText)

    const threeTierData = input.knd === "1" ? parseThreeTierCitation(json) : parseThreeTierDelegation(json)

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

      if (threeTierData.kndType === "인용조문" && article.content) {
        const content = cleanHtml(article.content)
        resultText += content.length > 500
          ? `${content.slice(0, 500)}\n   (법률 본문 ${content.length.toLocaleString()}자 중 일부만 표시)\n\n`
          : `${content}\n\n`
      }

      if (article.delegations.length === 0) {
        if (threeTierData.kndType === "인용조문") continue
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

    const text = truncateResponse(resultText)
    lawCache.set(cacheKey, text, 60 * 60 * 1000)
    return { content: [{ type: "text", text }] }
  } catch (error) {
    return formatToolError(error, "get_three_tier")
  }
}
