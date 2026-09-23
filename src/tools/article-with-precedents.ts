/**
 * get_article_with_precedents Tool - 조문 조회 + 관련 판례 자동 조회
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { getLawText, GetLawTextInput } from "./law-text.js"
import { renderPrecedentSearchResult } from "./precedents.js"
import { searchPrecedentsStructured } from "./precedent-search-core.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"
import { getRequestSignal } from "../lib/session-state.js"
import { maskSensitiveUrl } from "../lib/fetch-with-retry.js"

export const GetArticleWithPrecedentsSchema = z.object({
  mst: z.string().optional().describe("법령일련번호 (search_law에서 획득)"),
  lawId: z.string().optional().describe("법령ID (search_law에서 획득)"),
  jo: z.string().describe("조문 번호 (예: '제38조')"),
  efYd: z.string().optional().describe("시행일자 (YYYYMMDD 형식)"),
  includePrecedents: z.boolean().optional().default(true).describe("관련 판례 포함 여부"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
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
      efYd: input.efYd,
      apiKey: input.apiKey
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
    // 3. 관련 판례 검색
    const precedentQuery = `${lawName} ${input.jo}`

    try {
      const precedentResult = await searchPrecedentsStructured(apiClient, {
        query: precedentQuery,
        display: 5,
        page: 1,
        apiKey: input.apiKey
      }, {
        fallbackPolicy: "none",
      })

      if (precedentResult.hits.length > 0) {
        const precedentText = renderPrecedentSearchResult(precedentResult)

        // 판례 결과가 있으면 추가
        if (precedentText && !precedentText.includes("검색 결과가 없습니다")) {
          resultText += `\n${"=".repeat(60)}\n`
          resultText += `\n관련 판례 (상위 5건)\n\n`
          resultText += precedentText
        } else {
          resultText += `\n\n관련 판례: 검색 결과 없음`
        }
      } else {
        // 0건과 조회 실패와 includePrecedents=false가 같은 출력(판례 절 없음)이라 소비자가 가를 수 없었다.
        // 상태를 한 줄로 밝힌다 (2026-09-23 리뷰 D10).
        resultText += `\n\n관련 판례: '${precedentQuery}' 검색 결과 0건. 이 검색어 조합의 결과일 뿐 관련 판례가 없다는 확인은 아닙니다.`
      }
    } catch (error) {
      // 판례 검색 실패는 조문을 버리지 않되, 실패 사실은 밝힌다. 침묵하면 "관련 판례 없음"으로 읽힌다 (리뷰 D10).
      // 예산 소진도 여기서 실패로 적고 이미 받은 조문은 돌려준다. 요청 취소만 전파한다(독립 리뷰).
      if (getRequestSignal()?.aborted) throw error
      const reason = maskSensitiveUrl(error instanceof Error ? error.message : String(error))
      resultText += `\n\n관련 판례: 조회 실패 (${reason}). 조문 본문만 반환합니다. 관련 판례가 없다는 뜻이 아닙니다.`
    }

    return {
      content: [{
        type: "text",
        text: truncateResponse(resultText)
      }]
    }
  } catch (error) {
    return formatToolError(error, "get_article_with_precedents")
  }
}
