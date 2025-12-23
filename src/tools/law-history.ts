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
  page: z.number().optional().default(1).describe("페이지 번호 (기본값: 1)"),
  apiKey: z.string().optional().describe("API 키")
})

export type LawHistoryInput = z.infer<typeof LawHistorySchema>

export async function getLawHistory(
  apiClient: LawApiClient,
  input: LawHistoryInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const xmlText = await apiClient.getLawHistory({
      regDt: input.regDt,
      org: input.org,
      display: input.display,
      page: input.page,
      apiKey: input.apiKey
    })

    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlText, "text/xml")

    const totalCnt = doc.getElementsByTagName("totalCnt")[0]?.textContent || "0"
    const laws = doc.getElementsByTagName("law")

    if (laws.length === 0) {
      return {
        content: [{
          type: "text",
          text: `${input.regDt} 날짜에 변경된 법령이 없습니다.`
        }]
      }
    }

    let resultText = `법령 변경이력 (${input.regDt}, 총 ${totalCnt}건):\n\n`

    for (let i = 0; i < laws.length; i++) {
      const law = laws[i]

      const lawName = law.getElementsByTagName("법령명한글")[0]?.textContent || "알 수 없음"
      const lawId = law.getElementsByTagName("법령ID")[0]?.textContent || ""
      const mst = law.getElementsByTagName("법령일련번호")[0]?.textContent || ""
      const promDate = law.getElementsByTagName("공포일자")[0]?.textContent || ""
      const effDate = law.getElementsByTagName("시행일자")[0]?.textContent || ""
      const lawNo = law.getElementsByTagName("공포번호")[0]?.textContent || ""
      const changeType = law.getElementsByTagName("제개정구분명")[0]?.textContent || ""
      const orgName = law.getElementsByTagName("소관부처명")[0]?.textContent || ""
      const lawType = law.getElementsByTagName("법령구분명")[0]?.textContent || ""
      const status = law.getElementsByTagName("현행연혁코드")[0]?.textContent || ""

      resultText += `${i + 1}. ${lawName}\n`
      resultText += `   - 법령ID: ${lawId}, MST: ${mst}\n`
      resultText += `   - 법령구분: ${lawType}, 상태: ${status}\n`
      resultText += `   - 공포번호: ${lawNo}\n`
      resultText += `   - 개정구분: ${changeType}\n`
      resultText += `   - 공포일: ${promDate}, 시행일: ${effDate}\n`
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
