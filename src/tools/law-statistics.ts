/**
 * get_law_statistics Tool - 법령 통계 기능
 */

import { z } from "zod"
import { DOMParser } from "@xmldom/xmldom"
import type { LawApiClient } from "../lib/api-client.js"

export const LawStatisticsSchema = z.object({
  days: z.number().optional().default(30).describe("최근 변경 분석 기간 (일 단위, 기본값: 30)"),
  limit: z.number().optional().default(10).describe("결과 개수 제한 (기본값: 10)"),
  apiKey: z.string().optional().describe("API 키")
})

export type LawStatisticsInput = z.infer<typeof LawStatisticsSchema>

export async function getLawStatistics(
  apiClient: LawApiClient,
  input: LawStatisticsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    return await getRecentChanges(apiClient, input.days, input.limit, input.apiKey)
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

/**
 * 최근 개정 법령 TOP N
 */
async function getRecentChanges(
  apiClient: LawApiClient,
  days: number,
  limit: number,
  apiKey?: string
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  const endDate = new Date()
  const startDate = new Date(endDate)
  startDate.setDate(endDate.getDate() - days)

  const changes: Array<{ lawName: string, date: string, type: string }> = []

  for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "")

    try {
      const xmlText = await apiClient.getLawHistory({
        regDt: dateStr,
        display: 100,
        apiKey
      })

      const parser = new DOMParser()
      const doc = parser.parseFromString(xmlText, "text/xml")
      const histories = doc.getElementsByTagName("lsHstInf")

      for (let i = 0; i < histories.length; i++) {
        const history = histories[i]
        const lawName = history.getElementsByTagName("법령명한글")[0]?.textContent || "알 수 없음"
        const changeType = history.getElementsByTagName("개정구분명")[0]?.textContent || ""

        changes.push({
          lawName,
          date: dateStr,
          type: changeType
        })
      }
    } catch {
      // 해당 날짜에 데이터 없음 (무시)
    }
  }

  changes.sort((a, b) => b.date.localeCompare(a.date))
  const topChanges = changes.slice(0, limit)

  let resultText = `📊 최근 ${days}일간 개정 법령 TOP ${limit}\n\n`
  topChanges.forEach((change, idx) => {
    const formattedDate = `${change.date.slice(0, 4)}-${change.date.slice(4, 6)}-${change.date.slice(6, 8)}`
    resultText += `${idx + 1}. ${change.lawName}\n`
    resultText += `   - 개정일: ${formattedDate}\n`
    resultText += `   - 개정구분: ${change.type}\n\n`
  })

  resultText += `\n💡 총 ${changes.length}건의 법령이 개정되었습니다.`

  return {
    content: [{
      type: "text",
      text: resultText
    }]
  }
}
