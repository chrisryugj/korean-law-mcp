/**
 * compare_old_new Tool - 신구법 대조
 */

import { z } from "zod"
import { DOMParser } from "@xmldom/xmldom"
import type { LawApiClient } from "../lib/api-client.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"

export const CompareOldNewSchema = z.object({
  mst: z.string().optional().describe("법령일련번호"),
  lawId: z.string().optional().describe("법령ID"),
  ld: z.string().optional().describe("공포일자 (YYYYMMDD)"),
  ln: z.string().optional().describe("공포번호"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
}).refine(data => data.mst || data.lawId, {
  message: "mst 또는 lawId 중 하나는 필수입니다"
})

export type CompareOldNewInput = z.infer<typeof CompareOldNewSchema>

export async function compareOldNew(
  apiClient: LawApiClient,
  input: CompareOldNewInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const xmlText = await apiClient.compareOldNew({
      mst: input.mst,
      lawId: input.lawId,
      ld: input.ld,
      ln: input.ln,
      apiKey: input.apiKey
    })

    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlText, "text/xml")

    const lawName = doc.getElementsByTagName("법령명")[0]?.textContent || "알 수 없음"
    const oldInfo = doc.getElementsByTagName("구조문_기본정보")[0]
    const newInfo = doc.getElementsByTagName("신조문_기본정보")[0]

    const oldDate = oldInfo?.getElementsByTagName("공포일자")[0]?.textContent || ""
    const newDate = newInfo?.getElementsByTagName("공포일자")[0]?.textContent || ""
    const revisionType = newInfo?.getElementsByTagName("제개정구분명")[0]?.textContent || ""

    let resultText = `법령명: ${lawName}\n`
    if (revisionType) resultText += `개정구분: ${revisionType}\n`
    if (oldDate) resultText += `구법 공포일: ${oldDate}\n`
    if (newDate) resultText += `신법 공포일: ${newDate}\n`
    resultText += `\n---\n`
    resultText += `신구법 대조\n`
    resultText += `---\n\n`

    // 구조문목록과 신조문목록 파싱
    const oldArticleList = doc.getElementsByTagName("구조문목록")[0]
    const newArticleList = doc.getElementsByTagName("신조문목록")[0]

    if (!oldArticleList || !newArticleList) {
      return {
        content: [{
          type: "text",
          text: resultText + "[NOT_FOUND] 개정 이력이 없거나 신구법 대조 데이터가 없습니다.\n⚠️ LLM은 대조 내용을 추측하지 마세요."
        }],
        isError: true
      }
    }

    const oldArticles = oldArticleList.getElementsByTagName("조문")
    const newArticles = newArticleList.getElementsByTagName("조문")

    if (oldArticles.length === 0 && newArticles.length === 0) {
      return {
        content: [{
          type: "text",
          text: resultText + "[NOT_FOUND] 개정 이력이 없거나 신구법 대조 데이터가 없습니다.\n⚠️ LLM은 대조 내용을 추측하지 마세요."
        }],
        isError: true
      }
    }

    // 구/신 조문을 쌍으로 매칭 (동일 인덱스 기반 — API가 대응 쌍을 순서대로 반환)
    const maxArticles = Math.max(oldArticles.length, newArticles.length)
    const displayCount = Math.min(maxArticles, 30)

    for (let i = 0; i < displayCount; i++) {
      const oldArticle = oldArticles[i]
      const newArticle = newArticles[i]

      const oldContent = oldArticle?.textContent?.trim() || ""
      const newContent = newArticle?.textContent?.trim() || ""

      // 조문 번호 추출 시도
      const articleNumMatch = (newContent || oldContent).match(/제\d+조(?:의\d+)?/)
      const articleLabel = articleNumMatch ? articleNumMatch[0] : `조문 ${i + 1}`

      resultText += `\n---\n`
      resultText += `${articleLabel}\n`
      resultText += `---\n\n`

      if (oldContent) {
        resultText += `[개정 전]\n${oldContent}\n\n`
      } else {
        resultText += `[개정 전] (신설)\n\n`
      }

      if (newContent) {
        resultText += `[개정 후]\n${newContent}\n\n`
      } else {
        resultText += `[개정 후] (삭제)\n\n`
      }
    }

    if (maxArticles > displayCount) {
      resultText += `\n... 외 ${maxArticles - displayCount}개 조문 (생략)\n`
      resultText += `전체 ${maxArticles}개 조문 중 ${displayCount}개만 표시합니다.\n`
    }

    return {
      content: [{
        type: "text",
        text: truncateResponse(resultText)
      }]
    }
  } catch (error) {
    return formatToolError(error, "compare_old_new")
  }
}
