/**
 * compare_old_new Tool - 신구법 대조
 */

import { z } from "zod"
import { DOMParser } from "@xmldom/xmldom"
import type { LawApiClient } from "../lib/api-client.js"

export const CompareOldNewSchema = z.object({
  mst: z.string().optional().describe("법령일련번호"),
  lawId: z.string().optional().describe("법령ID"),
  ld: z.string().optional().describe("공포일자 (YYYYMMDD)"),
  ln: z.string().optional().describe("공포번호"),
  apiKey: z.string().optional().describe("사용자 API 키 (https://open.law.go.kr 에서 발급, 없으면 서버 기본값 사용)")
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
    resultText += `\n━━━━━━━━━━━━━━━━━━━━━━\n`
    resultText += `신구법 대조\n`
    resultText += `━━━━━━━━━━━━━━━━━━━━━━\n\n`

    // 구조문목록과 신조문목록 파싱
    const oldArticleList = doc.getElementsByTagName("구조문목록")[0]
    const newArticleList = doc.getElementsByTagName("신조문목록")[0]

    if (!oldArticleList || !newArticleList) {
      return {
        content: [{
          type: "text",
          text: resultText + "개정 이력이 없거나 신구법 대조 데이터가 없습니다."
        }]
      }
    }

    const oldArticles = oldArticleList.getElementsByTagName("조문")
    const newArticles = newArticleList.getElementsByTagName("조문")

    if (oldArticles.length === 0 && newArticles.length === 0) {
      return {
        content: [{
          type: "text",
          text: resultText + "개정 이력이 없거나 신구법 대조 데이터가 없습니다."
        }]
      }
    }

    const maxArticles = Math.max(oldArticles.length, newArticles.length)
    const displayCount = Math.min(maxArticles, 10)

    for (let i = 0; i < displayCount; i++) {
      const oldArticle = oldArticles[i]
      const newArticle = newArticles[i]

      const oldContent = oldArticle?.textContent?.trim() || ""
      const newContent = newArticle?.textContent?.trim() || ""

      resultText += `\n━━━━━━━━━━━━━━━━━━━━━━\n`
      resultText += `조문 ${i + 1}\n`
      resultText += `━━━━━━━━━━━━━━━━━━━━━━\n\n`

      if (oldContent) {
        resultText += `[개정 전]\n${oldContent}\n\n`
      }

      if (newContent) {
        resultText += `[개정 후]\n${newContent}\n\n`
      }
    }

    if (maxArticles > 10) {
      resultText += `\n... 외 ${maxArticles - 10}개 조문 (생략)\n`
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
