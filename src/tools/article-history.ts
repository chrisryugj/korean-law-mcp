/**
 * get_article_history Tool - 일자별 조문 개정 이력 조회
 */

import { z } from "zod"
import { DOMParser } from "@xmldom/xmldom"
import type { LawApiClient } from "../lib/api-client.js"

export const ArticleHistorySchema = z.object({
  lawId: z.string().optional().describe("법령ID (선택)"),
  jo: z.string().optional().describe("조문번호 (예: '제38조', 선택)"),
  regDt: z.string().optional().describe("조문 개정일 (YYYYMMDD, 선택)"),
  fromRegDt: z.string().optional().describe("조회기간 시작일 (YYYYMMDD, 선택)"),
  toRegDt: z.string().optional().describe("조회기간 종료일 (YYYYMMDD, 선택)"),
  org: z.string().optional().describe("소관부처코드 (선택)"),
  page: z.number().optional().default(1).describe("페이지 번호 (기본값: 1)")
})

export type ArticleHistoryInput = z.infer<typeof ArticleHistorySchema>

export async function getArticleHistory(
  apiClient: LawApiClient,
  input: ArticleHistoryInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const xmlText = await apiClient.getArticleHistory(input)

    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlText, "text/xml")

    const totalCnt = doc.getElementsByTagName("totalCnt")[0]?.textContent || "0"
    const histories = doc.getElementsByTagName("lsJoHstInf")

    if (histories.length === 0) {
      return {
        content: [{
          type: "text",
          text: "조문 개정 이력이 없습니다."
        }]
      }
    }

    let resultText = `조문 개정 이력 (총 ${totalCnt}건):\n\n`

    for (let i = 0; i < histories.length; i++) {
      const history = histories[i]

      const lawName = history.getElementsByTagName("법령명한글")[0]?.textContent || "알 수 없음"
      const lawId = history.getElementsByTagName("법령ID")[0]?.textContent || ""
      const promDate = history.getElementsByTagName("공포일자")[0]?.textContent || ""
      const joNo = history.getElementsByTagName("조문번호")[0]?.textContent || ""
      const joInfo = history.getElementsByTagName("조문정보")[0]?.textContent || ""
      const changeReason = history.getElementsByTagName("변경사유")[0]?.textContent || ""
      const joRegDt = history.getElementsByTagName("조문개정일")[0]?.textContent || ""
      const joEffDt = history.getElementsByTagName("조문시행일")[0]?.textContent || ""

      resultText += `${i + 1}. ${lawName} ${joNo}\n`
      resultText += `   - 법령ID: ${lawId}\n`
      resultText += `   - 공포일: ${promDate}\n`
      resultText += `   - 조문정보: ${joInfo}\n`
      resultText += `   - 변경사유: ${changeReason}\n`
      resultText += `   - 조문개정일: ${joRegDt}\n`
      resultText += `   - 조문시행일: ${joEffDt}\n\n`
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
