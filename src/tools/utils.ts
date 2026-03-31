/**
 * parse_jo_code Tool - JO 코드 양방향 변환
 */

import { z } from "zod"
import { DOMParser } from "@xmldom/xmldom"
import type { LawApiClient } from "../lib/api-client.js"
import { truncateResponse } from "../lib/schemas.js"
import { buildJO, buildOrdinanceJO, formatJO } from "../lib/law-parser.js"

export const ParseJoCodeSchema = z.object({
  joText: z.string().describe("변환할 조문 번호 (예: '제38조', '10조의2', '003800', '010000')"),
  direction: z.enum(["to_code", "to_text"]).optional().default("to_code").describe("변환 방향: to_code (한글→코드) 또는 to_text (코드→한글)"),
  lawType: z.enum(["law", "ordinance"]).optional().default("law").describe("법령 유형: law (법률/시행령/시행규칙, AAAABB 형식) 또는 ordinance (자치법규, AABBCC 형식)")
})

export type ParseJoCodeInput = z.infer<typeof ParseJoCodeSchema>

export async function parseJoCode(
  input: ParseJoCodeInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    let result: string
    const isOrdinance = input.lawType === "ordinance"

    if (input.direction === "to_code") {
      // 한글 → JO 코드
      result = isOrdinance ? buildOrdinanceJO(input.joText) : buildJO(input.joText)
    } else {
      // JO 코드 → 한글
      result = formatJO(input.joText, isOrdinance)
    }

    const formatInfo = isOrdinance
      ? "AABBCC (AA=조문, BB=의X, CC=서브)"
      : "AAAABB (AAAA=조문, BB=의X)"

    const resultText = JSON.stringify({
      input: input.joText,
      output: result,
      direction: input.direction,
      lawType: input.lawType,
      format: formatInfo
    }, null, 2)

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
        text: `조문 번호 변환 실패: ${error instanceof Error ? error.message : String(error)}`
      }],
      isError: true
    }
  }
}

// get_law_abbreviations 스키마
export const GetLawAbbreviationsSchema = z.object({
  stdDt: z.string().optional().describe("기준 시작일 (YYYYMMDD)"),
  endDt: z.string().optional().describe("기준 종료일 (YYYYMMDD)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
})

export type GetLawAbbreviationsInput = z.infer<typeof GetLawAbbreviationsSchema>

export async function getLawAbbreviations(
  apiClient: LawApiClient,
  input: GetLawAbbreviationsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const extraParams: Record<string, string> = {}
    if (input.stdDt) extraParams.stdDt = String(input.stdDt)
    if (input.endDt) extraParams.endDt = String(input.endDt)

    const xmlText = await apiClient.fetchApi({
      endpoint: "lawSearch.do",
      target: "lsAbrv",
      type: "XML",
      extraParams,
      apiKey: input.apiKey
    })

    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlText, "text/xml")

    const items = doc.getElementsByTagName("lsAbrv")
    if (items.length === 0) {
      return {
        content: [{ type: "text", text: "약칭 데이터가 없습니다." }],
        isError: true
      }
    }

    let resultText = `법령 약칭 목록 (총 ${items.length}건):\n\n`

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const lawName = item.getElementsByTagName("법령명")[0]?.textContent || ""
      const abbr = item.getElementsByTagName("약칭명")[0]?.textContent
        || item.getElementsByTagName("약칭")[0]?.textContent || ""
      const lawId = item.getElementsByTagName("법령ID")[0]?.textContent || ""

      if (lawName || abbr) {
        resultText += `${i + 1}. ${lawName}`
        if (abbr) resultText += ` → 약칭: ${abbr}`
        if (lawId) resultText += ` (ID: ${lawId})`
        resultText += `\n`
      }
    }

    return {
      content: [{ type: "text", text: truncateResponse(resultText) }]
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true
    }
  }
}
