/**
 * get_law_statistics Tool - 법령 통계 기능
 */

import { z } from "zod"
import { DOMParser } from "@xmldom/xmldom"
import type { LawApiClient } from "../lib/api-client.js"

export const LawStatisticsSchema = z.object({
  analysisType: z.enum(["recent_changes", "by_department", "by_year"]).describe(
    "통계 유형: recent_changes (최근 개정 법령), by_department (소관부처별), by_year (제정년도별)"
  ),
  days: z.number().optional().default(30).describe("최근 변경 분석 기간 (일 단위, 기본값: 30)"),
  limit: z.number().optional().default(10).describe("결과 개수 제한 (기본값: 10)")
})

export type LawStatisticsInput = z.infer<typeof LawStatisticsSchema>

export async function getLawStatistics(
  apiClient: LawApiClient,
  input: LawStatisticsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    switch (input.analysisType) {
      case "recent_changes":
        return await getRecentChanges(apiClient, input.days, input.limit)

      case "by_department":
        return await getStatsByDepartment(apiClient, input.limit)

      case "by_year":
        return await getStatsByYear(apiClient, input.limit)

      default:
        return {
          content: [{
            type: "text",
            text: "지원하지 않는 통계 유형입니다."
          }],
          isError: true
        }
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

/**
 * 최근 개정 법령 TOP N
 */
async function getRecentChanges(
  apiClient: LawApiClient,
  days: number,
  limit: number
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  // 날짜 계산
  const endDate = new Date()
  const startDate = new Date(endDate)
  startDate.setDate(endDate.getDate() - days)

  const changes: Array<{ lawName: string, date: string, type: string }> = []

  // 각 날짜별로 변경 법령 조회
  for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "")

    try {
      const xmlText = await apiClient.getLawHistory({
        regDt: dateStr,
        display: 100
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

  // 최신순 정렬 및 상위 N개
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

/**
 * 소관부처별 법령 통계 (임의 데이터)
 */
async function getStatsByDepartment(
  apiClient: LawApiClient,
  limit: number
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  // 실제로는 전체 법령을 조회하고 집계해야 하지만,
  // API 제한으로 인해 샘플 데이터로 대체
  const sampleStats = [
    { department: "법무부", count: 234 },
    { department: "국토교통부", count: 189 },
    { department: "기획재정부", count: 156 },
    { department: "고용노동부", count: 142 },
    { department: "환경부", count: 128 },
    { department: "산업통상자원부", count: 115 },
    { department: "보건복지부", count: 98 },
    { department: "교육부", count: 87 },
    { department: "국방부", count: 76 },
    { department: "행정안전부", count: 65 }
  ]

  let resultText = `📊 소관부처별 법령 수 TOP ${limit}\n\n`
  resultText += "⚠️ 주의: 이 통계는 샘플 데이터입니다. 실제 법제처 API는 전체 법령 집계 기능을 제공하지 않습니다.\n\n"

  sampleStats.slice(0, limit).forEach((stat, idx) => {
    resultText += `${idx + 1}. ${stat.department}: ${stat.count}건\n`
  })

  return {
    content: [{
      type: "text",
      text: resultText
    }]
  }
}

/**
 * 제정연도별 법령 통계 (임의 데이터)
 */
async function getStatsByYear(
  apiClient: LawApiClient,
  limit: number
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  // 실제로는 전체 법령을 조회하고 집계해야 하지만,
  // API 제한으로 인해 샘플 데이터로 대체
  const currentYear = new Date().getFullYear()
  const sampleStats = Array.from({ length: 10 }, (_, i) => {
    const year = currentYear - i
    return { year, count: Math.floor(Math.random() * 50) + 10 }
  })

  let resultText = `📊 최근 ${limit}년간 제정 법령 수\n\n`
  resultText += "⚠️ 주의: 이 통계는 샘플 데이터입니다. 실제 법제처 API는 전체 법령 집계 기능을 제공하지 않습니다.\n\n"

  sampleStats.slice(0, limit).forEach((stat, idx) => {
    resultText += `${idx + 1}. ${stat.year}년: ${stat.count}건\n`
  })

  return {
    content: [{
      type: "text",
      text: resultText
    }]
  }
}
