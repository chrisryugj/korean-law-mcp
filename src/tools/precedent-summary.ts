/**
 * summarize_precedent Tool - 판례 요약 (AI 활용)
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { getPrecedentText } from "./precedents.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"

export const SummarizePrecedentSchema = z.object({
  id: z.string().describe("판례일련번호"),
  maxLength: z.number().optional().default(500).describe("요약 최대 길이 (기본값: 500자)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
})

export type SummarizePrecedentInput = z.infer<typeof SummarizePrecedentSchema>

/**
 * 간단한 키워드 기반 요약 (AI 없이 구현)
 * 실제 AI 연동은 Claude API를 사용할 수 있지만, 여기서는 규칙 기반으로 구현
 */
export async function summarizePrecedent(
  apiClient: LawApiClient,
  input: SummarizePrecedentInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    // 1. 판례 전문 조회
    const precedentResult = await getPrecedentText(apiClient, { id: input.id, apiKey: input.apiKey })

    if (precedentResult.isError || precedentResult.content.length === 0) {
      return {
        content: [{
          type: "text",
          text: "[NOT_FOUND] 판례를 찾을 수 없습니다.\n⚠️ LLM은 판례 내용을 추측/생성하지 마세요."
        }],
        isError: true
      }
    }

    const fullText = precedentResult.content[0].text

    // 2. 핵심 정보 추출
    const summary = extractPrecedentSummary(fullText, input.maxLength)

    return {
      content: [{
        type: "text",
        text: truncateResponse(summary)
      }]
    }
  } catch (error) {
    return formatToolError(error, "summarize_precedent")
  }
}

/**
 * 판례에서 핵심 정보 추출
 */
function extractPrecedentSummary(fullText: string, maxLength: number): string {
  const lines = fullText.split('\n')

  // 판시사항, 판결요지, 주문 등 핵심 섹션 추출
  const sections = {
    title: "",
    court: "",
    caseNumber: "",
    judgment: "",
    summary: "",
    mainText: ""
  }

  let currentSection = ""

  for (const line of lines) {
    const trimmed = line.trim()

    // 섹션 구분
    if (trimmed.includes("사건번호:") || trimmed.startsWith("사건:")) {
      sections.caseNumber = trimmed
    } else if (trimmed.includes("법원:") || trimmed.includes("선고:")) {
      sections.court = trimmed
    } else if (trimmed === "【판시사항】" || trimmed.startsWith("판시사항")) {
      currentSection = "judgment"
    } else if (trimmed === "【판결요지】" || trimmed.startsWith("판결요지")) {
      currentSection = "summary"
    } else if (trimmed === "【주문】" || trimmed.startsWith("주문")) {
      currentSection = "mainText"
    } else if (currentSection === "judgment" && trimmed.length > 0) {
      sections.judgment += trimmed + "\n"
    } else if (currentSection === "summary" && trimmed.length > 0) {
      sections.summary += trimmed + "\n"
    } else if (currentSection === "mainText" && trimmed.length > 0) {
      sections.mainText += trimmed + "\n"
    }
  }

  // 요약 생성
  let result = "판례 요약\n\n"

  if (sections.caseNumber) {
    result += `${sections.caseNumber}\n`
  }
  if (sections.court) {
    result += `${sections.court}\n\n`
  }

  if (sections.judgment) {
    result += "【판시사항】\n"
    result += truncateText(sections.judgment, maxLength / 3) + "\n\n"
  }

  if (sections.summary) {
    result += "【판결요지】\n"
    result += truncateText(sections.summary, maxLength / 3) + "\n\n"
  }

  if (sections.mainText) {
    result += "【주문】\n"
    result += truncateText(sections.mainText, maxLength / 3) + "\n"
  }

  return result
}

/**
 * 텍스트 길이 제한
 */
function truncateText(text: string, maxLength: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxLength) {
    return trimmed
  }
  return trimmed.substring(0, maxLength) + "..."
}
