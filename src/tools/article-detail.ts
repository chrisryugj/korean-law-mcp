/**
 * get_article_detail Tool - 조항호목 단위 정밀 조회
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { truncateResponse } from "../lib/schemas.js"
import { buildJO } from "../lib/law-parser.js"

export const GetArticleDetailSchema = z.object({
  mst: z.string().optional().describe("법령일련번호 (search_law에서 획득)"),
  lawId: z.string().optional().describe("법령ID (search_law에서 획득)"),
  jo: z.string().describe("조문 번호 (예: '제38조' 또는 '003800')"),
  hang: z.string().optional().describe("항 번호 (예: '2')"),
  ho: z.string().optional().describe("호 번호 (예: '3')"),
  mok: z.string().optional().describe("목 번호 (예: '1')"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
}).refine(data => data.mst || data.lawId, {
  message: "mst 또는 lawId 중 하나는 필수입니다"
})

export type GetArticleDetailInput = z.infer<typeof GetArticleDetailSchema>

export async function getArticleDetail(
  apiClient: LawApiClient,
  input: GetArticleDetailInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    // 조문 번호가 한글이면 JO 코드로 변환
    let joCode = input.jo
    if (/제\d+조/.test(joCode)) {
      joCode = buildJO(joCode)
    }

    const extraParams: Record<string, string> = {}
    if (input.mst) extraParams.MST = String(input.mst)
    if (input.lawId) extraParams.ID = String(input.lawId)
    extraParams.JO = String(joCode)
    if (input.hang) extraParams.HANG = String(input.hang)
    if (input.ho) extraParams.HO = String(input.ho)
    if (input.mok) extraParams.MOK = String(input.mok)

    const jsonText = await apiClient.fetchApi({
      endpoint: "lawService.do",
      target: "eflaw",
      type: "JSON",
      extraParams,
      apiKey: input.apiKey
    })

    const json = JSON.parse(jsonText)
    const lawData = json?.법령

    if (!lawData) {
      return {
        content: [{ type: "text", text: "법령 데이터를 찾을 수 없습니다." }],
        isError: true
      }
    }

    const basicInfo = lawData.기본정보 || lawData
    const lawName = basicInfo?.법령명_한글 || basicInfo?.법령명한글 || basicInfo?.법령명 || "알 수 없음"

    // 조회 위치 표시
    let locationLabel = `제${input.jo.replace(/^제/, "").replace(/조$/, "")}조`
    if (/^\d{4,6}$/.test(input.jo)) locationLabel = `JO=${input.jo}`
    if (input.hang) locationLabel += ` 제${input.hang}항`
    if (input.ho) locationLabel += ` 제${input.ho}호`
    if (input.mok) locationLabel += ` ${input.mok}목`

    let resultText = `법령명: ${lawName}\n`
    resultText += `조회 위치: ${locationLabel}\n\n`

    // 조문 추출
    const rawUnits = lawData.조문?.조문단위
    const articleUnits: any[] = Array.isArray(rawUnits) ? rawUnits : rawUnits ? [rawUnits] : []

    if (articleUnits.length === 0) {
      return {
        content: [{ type: "text", text: resultText + "해당 조문을 찾을 수 없습니다." }],
        isError: true
      }
    }

    for (const unit of articleUnits) {
      if (unit.조문여부 !== "조문") continue

      const joNum = unit.조문번호 || ""
      const joBranch = unit.조문가지번호 || ""
      const joTitle = unit.조문제목 || ""
      const displayNum = joBranch && joBranch !== "0" ? `제${joNum}조의${joBranch}` : `제${joNum}조`

      resultText += `${displayNum}`
      if (joTitle) resultText += ` ${joTitle}`
      resultText += `\n`

      // 조문내용
      if (unit.조문내용) {
        const content = typeof unit.조문내용 === "string" ? unit.조문내용 : String(unit.조문내용)
        resultText += `${content}\n`
      }

      // 항 내용
      if (unit.항) {
        const hangList = Array.isArray(unit.항) ? unit.항 : [unit.항]
        for (const hang of hangList) {
          const hangNum = hang.항번호 || ""
          const hangContent = hang.항내용 || ""
          if (hangContent) {
            resultText += `  ${hangNum ? `(${hangNum})` : ""} ${hangContent}\n`
          }

          // 호 내용
          if (hang.호) {
            const hoList = Array.isArray(hang.호) ? hang.호 : [hang.호]
            for (const ho of hoList) {
              const hoNum = ho.호번호 || ""
              const hoContent = ho.호내용 || ""
              if (hoContent) {
                resultText += `    ${hoNum}. ${hoContent}\n`
              }

              // 목 내용
              if (ho.목) {
                const mokList = Array.isArray(ho.목) ? ho.목 : [ho.목]
                for (const mok of mokList) {
                  const mokNum = mok.목번호 || ""
                  const mokContent = mok.목내용 || ""
                  if (mokContent) {
                    resultText += `      ${mokNum}. ${mokContent}\n`
                  }
                }
              }
            }
          }
        }
      }

      resultText += `\n`
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
