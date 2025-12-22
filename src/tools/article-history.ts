/**
 * get_article_history Tool - 일자별 조문 개정 이력 조회
 */

import { z } from "zod"
import { DOMParser } from "@xmldom/xmldom"
import type { LawApiClient } from "../lib/api-client.js"

/**
 * JO 코드를 읽기 쉬운 형식으로 변환
 * 예: 003800 → 제38조, 001002 → 제10조의2
 */
function formatJoCode(joCode: string): string {
  if (!joCode || joCode.length !== 6) return joCode

  const articleNum = parseInt(joCode.substring(0, 4), 10)
  const branchNum = parseInt(joCode.substring(4, 6), 10)

  if (branchNum === 0) {
    return `제${articleNum}조`
  } else {
    return `제${articleNum}조의${branchNum}`
  }
}

export const ArticleHistorySchema = z.object({
  lawId: z.string().optional().describe("법령ID (예: '003440'). search_law 결과의 법령ID 사용. lawName과 함께 사용 불가"),
  lawName: z.string().optional().describe("법령명 (예: '공정거래법 시행령'). 법령명으로 검색 후 자동으로 법령ID를 찾음"),
  jo: z.string().optional().describe("조문번호 (예: '제38조', 선택)"),
  regDt: z.string().optional().describe("조문 개정일 (YYYYMMDD, 선택)"),
  fromRegDt: z.string().optional().describe("조회기간 시작일 (YYYYMMDD, 예: '20240101')"),
  toRegDt: z.string().optional().describe("조회기간 종료일 (YYYYMMDD, 예: '20241231')"),
  org: z.string().optional().describe("소관부처코드 (선택)"),
  page: z.number().optional().default(1).describe("페이지 번호 (기본값: 1)"),
  apiKey: z.string().optional().describe("사용자 API 키 (https://open.law.go.kr 에서 발급, 없으면 서버 기본값 사용)")
})

export type ArticleHistoryInput = z.infer<typeof ArticleHistorySchema>

export async function getArticleHistory(
  apiClient: LawApiClient,
  input: ArticleHistoryInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    let lawId = input.lawId

    // lawName이 제공된 경우 먼저 법령 검색하여 lawId 찾기
    if (input.lawName && !lawId) {
      const searchResult = await apiClient.searchLaw(input.lawName, input.apiKey)
      const lawIdMatch = searchResult.match(/<법령ID>(\d+)<\/법령ID>/)
      if (lawIdMatch) {
        lawId = lawIdMatch[1]
      } else {
        return {
          content: [{
            type: "text",
            text: `법령 '${input.lawName}'을(를) 찾을 수 없습니다. 법령명을 확인하거나 search_law로 먼저 검색해주세요.`
          }],
          isError: true
        }
      }
    }

    const xmlText = await apiClient.getArticleHistory({ ...input, lawId, apiKey: input.apiKey })

    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlText, "text/xml")

    const totalCnt = doc.getElementsByTagName("totalCnt")[0]?.textContent || "0"
    const laws = doc.getElementsByTagName("law")

    if (laws.length === 0) {
      return {
        content: [{
          type: "text",
          text: "조문 개정 이력이 없습니다."
        }]
      }
    }

    let resultText = `조문 개정 이력 (총 ${totalCnt}건):\n\n`
    let itemNum = 0

    for (let i = 0; i < laws.length; i++) {
      const law = laws[i]

      // 법령정보 추출
      const lawInfo = law.getElementsByTagName("법령정보")[0]
      const lawName = lawInfo?.getElementsByTagName("법령명한글")[0]?.textContent || "알 수 없음"
      const lawId = lawInfo?.getElementsByTagName("법령ID")[0]?.textContent || ""
      const mst = lawInfo?.getElementsByTagName("법령일련번호")[0]?.textContent || ""
      const promDate = lawInfo?.getElementsByTagName("공포일자")[0]?.textContent || ""
      const changeType = lawInfo?.getElementsByTagName("제개정구분명")[0]?.textContent || ""
      const effDate = lawInfo?.getElementsByTagName("시행일자")[0]?.textContent || ""

      // 조문정보 추출
      const joInfos = law.getElementsByTagName("jo")
      for (let j = 0; j < joInfos.length; j++) {
        itemNum++
        const jo = joInfos[j]
        const joNo = jo.getElementsByTagName("조문번호")[0]?.textContent || ""
        const changeReason = jo.getElementsByTagName("변경사유")[0]?.textContent || ""
        const joRegDt = jo.getElementsByTagName("조문개정일")[0]?.textContent || ""
        const joEffDt = jo.getElementsByTagName("조문시행일")[0]?.textContent || ""

        // 조문번호를 읽기 쉬운 형식으로 변환 (예: 003800 → 제38조)
        const joDisplay = formatJoCode(joNo)

        resultText += `${itemNum}. ${lawName} ${joDisplay}\n`
        resultText += `   - 법령ID: ${lawId}, MST: ${mst}\n`
        resultText += `   - 개정구분: ${changeType}\n`
        resultText += `   - 변경사유: ${changeReason}\n`
        resultText += `   - 공포일: ${promDate}, 조문개정일: ${joRegDt}\n`
        resultText += `   - 시행일: ${effDate}, 조문시행일: ${joEffDt}\n\n`
      }
    }

    // 조문이 하나도 없는 경우 (법령정보만 있는 경우)
    if (itemNum === 0) {
      resultText = "조문 개정 이력이 없습니다."
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
