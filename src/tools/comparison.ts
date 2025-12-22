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
  LAW_OC: z.string().optional().describe("사용자 API 키 (https://open.law.go.kr 에서 발급, 없으면 서버 기본값 사용)")
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
      apiKey: input.LAW_OC
    })

    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlText, "text/xml")

    const lawName = doc.getElementsByTagName("법령명")[0]?.textContent || "알 수 없음"

    let resultText = `법령명: ${lawName}\n\n`
    resultText += `━━━━━━━━━━━━━━━━━━━━━━\n`
    resultText += `신구법 대조\n`
    resultText += `━━━━━━━━━━━━━━━━━━━━━━\n\n`

    // 신구법 조문 파싱
    const articles = doc.getElementsByTagName("조문")

    if (articles.length === 0) {
      return {
        content: [{
          type: "text",
          text: resultText + "개정 이력이 없거나 신구법 대조 데이터가 없습니다."
        }]
      }
    }

    for (let i = 0; i < Math.min(articles.length, 10); i++) {
      const article = articles[i]

      const joNum = article.getElementsByTagName("조문번호")[0]?.textContent || ""
      const joTitle = article.getElementsByTagName("조문제목")[0]?.textContent || ""
      const oldContent = article.getElementsByTagName("개정전내용")[0]?.textContent || ""
      const newContent = article.getElementsByTagName("개정후내용")[0]?.textContent || ""

      resultText += `\n━━━━━━━━━━━━━━━━━━━━━━\n`
      resultText += `${joNum}`
      if (joTitle) resultText += ` ${joTitle}`
      resultText += `\n━━━━━━━━━━━━━━━━━━━━━━\n\n`

      if (oldContent) {
        resultText += `[개정 전]\n${oldContent.trim()}\n\n`
      }

      if (newContent) {
        resultText += `[개정 후]\n${newContent.trim()}\n\n`
      }
    }

    if (articles.length > 10) {
      resultText += `\n... 외 ${articles.length - 10}개 조문 (생략)\n`
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
