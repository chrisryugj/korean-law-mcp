/**
 * get_law_statistics Tool - 법령 통계 기능
 */

import { z } from "zod"
import { DOMParser } from "@xmldom/xmldom"
import type { LawApiClient } from "../lib/api-client.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"

export const LawStatisticsSchema = z.object({
  days: z.number().min(1).max(90).optional().default(30).describe("최근 변경 분석 기간 (일 단위, 기본값: 30, 최대: 90)"),
  limit: z.number().optional().default(10).describe("결과 개수 제한 (기본값: 10)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
})

export type LawStatisticsInput = z.infer<typeof LawStatisticsSchema>

export async function getLawStatistics(
  apiClient: LawApiClient,
  input: LawStatisticsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    return await getRecentChanges(apiClient, input.days, input.limit, input.apiKey)
  } catch (error) {
    return formatToolError(error, "get_law_statistics")
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

  // 날짜 목록 생성
  const dateStrings: string[] = []
  for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
    dateStrings.push(date.toISOString().slice(0, 10).replace(/-/g, ""))
  }

  // 병렬 API 호출 (동시 요청 5개씩 배치)
  const BATCH_SIZE = 5
  const changes: Array<{ lawName: string, date: string, type: string }> = []

  for (let i = 0; i < dateStrings.length; i += BATCH_SIZE) {
    const batch = dateStrings.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(
      batch.map(async (dateStr) => {
        try {
          const xmlText = await apiClient.getLawHistory({
            regDt: dateStr,
            display: 100,
            apiKey
          })

          const parser = new DOMParser()
          const doc = parser.parseFromString(xmlText, "text/xml")
          const histories = doc.getElementsByTagName("lsHstInf")
          const items: Array<{ lawName: string, date: string, type: string }> = []

          for (let j = 0; j < histories.length; j++) {
            const history = histories[j]
            const lawName = history.getElementsByTagName("법령명한글")[0]?.textContent || "알 수 없음"
            const changeType = history.getElementsByTagName("개정구분명")[0]?.textContent || ""
            items.push({ lawName, date: dateStr, type: changeType })
          }
          return items
        } catch {
          return []
        }
      })
    )
    for (const items of results) {
      changes.push(...items)
    }
  }

  changes.sort((a, b) => b.date.localeCompare(a.date))
  const topChanges = changes.slice(0, limit)

  let resultText = `최근 ${days}일간 개정 법령 TOP ${limit}\n\n`
  topChanges.forEach((change, idx) => {
    const formattedDate = `${change.date.slice(0, 4)}-${change.date.slice(4, 6)}-${change.date.slice(6, 8)}`
    resultText += `${idx + 1}. ${change.lawName}\n`
    resultText += `   - 개정일: ${formattedDate}\n`
    resultText += `   - 개정구분: ${change.type}\n\n`
  })

  resultText += `\n총 ${changes.length}건의 법령이 개정되었습니다.`

  return {
    content: [{
      type: "text",
      text: truncateResponse(resultText)
    }]
  }
}
