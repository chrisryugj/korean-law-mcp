/**
 * search_law Tool - 법령 검색
 */

import { z } from "zod"
import { DOMParser } from "@xmldom/xmldom"
import type { LawApiClient } from "../lib/api-client.js"

export const SearchLawSchema = z.object({
  query: z.string().describe("검색할 법령명 (예: '관세법', 'fta특례법', '화관법')"),
  maxResults: z.number().optional().default(20).describe("최대 결과 개수")
})

export type SearchLawInput = z.infer<typeof SearchLawSchema>

export async function searchLaw(
  apiClient: LawApiClient,
  input: SearchLawInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const xmlText = await apiClient.searchLaw(input.query)

    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlText, "text/xml")

    const laws = doc.getElementsByTagName("law")

    if (laws.length === 0) {
      return {
        content: [{
          type: "text",
          text: "검색 결과가 없습니다. 법령명을 확인해주세요."
        }]
      }
    }

    let resultText = `검색 결과 (총 ${laws.length}건):\n\n`

    const maxResults = Math.min(laws.length, input.maxResults)

    for (let i = 0; i < maxResults; i++) {
      const law = laws[i]

      const lawName = law.getElementsByTagName("법령명한글")[0]?.textContent || "알 수 없음"
      const lawId = law.getElementsByTagName("법령ID")[0]?.textContent || ""
      const mst = law.getElementsByTagName("법령일련번호")[0]?.textContent || ""
      const promDate = law.getElementsByTagName("공포일자")[0]?.textContent || ""
      const lawType = law.getElementsByTagName("법령구분명")[0]?.textContent || ""

      resultText += `${i + 1}. ${lawName}\n`
      resultText += `   - 법령ID: ${lawId}\n`
      resultText += `   - MST: ${mst}\n`
      resultText += `   - 공포일: ${promDate}\n`
      resultText += `   - 구분: ${lawType}\n\n`
    }

    resultText += `\n💡 특정 조문을 조회하려면 get_law_text Tool을 사용하세요.`

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
