/**
 * get_law_history Tool - 법령 변경이력 목록 조회
 */

import { z } from "zod"
import { DOMParser } from "@xmldom/xmldom"
import type { LawApiClient } from "../lib/api-client.js"

export const LawHistorySchema = z.object({
  regDt: z.string().describe("법령 변경일자 (YYYYMMDD, 예: '20240101')"),
  org: z.string().optional().describe("소관부처코드 (선택)"),
  display: z.number().optional().default(20).describe("결과 개수 (기본값: 20, 최대: 100)"),
  page: z.number().optional().default(1).describe("페이지 번호 (기본값: 1)")
})

export type LawHistoryInput = z.infer<typeof LawHistorySchema>

export async function getLawHistory(
  apiClient: LawApiClient,
  input: LawHistoryInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const xmlText = await apiClient.getLawHistory(input)

    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlText, "text/xml")

    const totalCnt = doc.getElementsByTagName("totalCnt")[0]?.textContent || "0"
    const histories = doc.getElementsByTagName("lsHstInf")

    if (histories.length === 0) {
      return {
        content: [{
          type: "text",
          text: `${input.regDt} 날짜에 변경된 법령이 없습니다.`
        }]
      }
    }

    let resultText = `법령 변경이력 (${input.regDt}, 총 ${totalCnt}건):\n\n`

    for (let i = 0; i < histories.length; i++) {
      const history = histories[i]

      const lawName = history.getElementsByTagName("법령명한글")[0]?.textContent || "알 수 없음"
      const lawId = history.getElementsByTagName("법령ID")[0]?.textContent || ""
      const mst = history.getElementsByTagName("법령일련번호")[0]?.textContent || ""
      const promDate = history.getElementsByTagName("공포일자")[0]?.textContent || ""
      const effDate = history.getElementsByTagName("시행일자")[0]?.textContent || ""
      const lawNo = history.getElementsByTagName("법령번호")[0]?.textContent || ""
      const changeType = history.getElementsByTagName("개정구분명")[0]?.textContent || ""
      const orgName = history.getElementsByTagName("소관부처명")[0]?.textContent || ""

      resultText += `${i + 1}. ${lawName}\n`
      resultText += `   - 법령ID: ${lawId}\n`
      resultText += `   - MST: ${mst}\n`
      resultText += `   - 법령번호: ${lawNo}\n`
      resultText += `   - 개정구분: ${changeType}\n`
      resultText += `   - 공포일: ${promDate}\n`
      resultText += `   - 시행일: ${effDate}\n`
      resultText += `   - 소관부처: ${orgName}\n\n`
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
