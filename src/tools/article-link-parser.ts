/**
 * parse_article_links Tool - 조문 내 참조 링크 파싱
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { getLawText } from "./law-text.js"

export const ParseArticleLinksSchema = z.object({
  mst: z.string().optional().describe("법령일련번호"),
  lawId: z.string().optional().describe("법령ID"),
  jo: z.string().describe("조문 번호 (예: '제38조')"),
  efYd: z.string().optional().describe("시행일자 (YYYYMMDD)")
})

export type ParseArticleLinksInput = z.infer<typeof ParseArticleLinksSchema>

export async function parseArticleLinks(
  apiClient: LawApiClient,
  input: ParseArticleLinksInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    // 1. 조문 조회
    const articleResult = await getLawText(apiClient, input)

    if (articleResult.isError || articleResult.content.length === 0) {
      return {
        content: [{
          type: "text",
          text: "조문을 찾을 수 없습니다."
        }],
        isError: true
      }
    }

    const articleText = articleResult.content[0].text

    // 2. 조문 내 참조 파싱
    const references = extractArticleReferences(articleText)

    // 3. 결과 포맷
    let resultText = `🔗 조문 내 참조 링크 (${references.length}개)\n\n`

    if (references.length === 0) {
      resultText += "이 조문에는 다른 조문을 참조하는 내용이 없습니다.\n"
    } else {
      references.forEach((ref, idx) => {
        resultText += `${idx + 1}. ${ref.text}\n`
        resultText += `   → 참조: ${ref.reference}\n`
        if (ref.context) {
          resultText += `   문맥: "${ref.context}"\n`
        }
        resultText += `\n`
      })
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

/**
 * 조문 내 참조 추출
 */
function extractArticleReferences(text: string): Array<{
  text: string
  reference: string
  context?: string
}> {
  const references: Array<{ text: string, reference: string, context?: string }> = []

  // 패턴 1: "제X조"
  const articlePattern = /제(\d+)조(의(\d+))?/g
  let match = articlePattern.exec(text)
  while (match) {
    const fullMatch = match[0]
    const context = extractContext(text, match.index, 30)

    references.push({
      text: fullMatch,
      reference: fullMatch,
      context
    })

    match = articlePattern.exec(text)
  }

  // 패턴 2: "같은 조", "이 조", "당해 조"
  const sameArticlePattern = /(같은|이|당해|해당)\s*조/g
  match = sameArticlePattern.exec(text)
  while (match) {
    const fullMatch = match[0]
    const context = extractContext(text, match.index, 30)

    references.push({
      text: fullMatch,
      reference: "현재 조문",
      context
    })

    match = sameArticlePattern.exec(text)
  }

  // 패턴 3: "전항", "전각호"
  const prevPattern = /(전|다음)\s*(항|각\s*호|호)/g
  match = prevPattern.exec(text)
  while (match) {
    const fullMatch = match[0]
    const context = extractContext(text, match.index, 30)

    references.push({
      text: fullMatch,
      reference: match[1] === "전" ? "이전 항/호" : "다음 항/호",
      context
    })

    match = prevPattern.exec(text)
  }

  // 패턴 4: "이 법", "이 영", "이 규칙"
  const lawPattern = /이\s*(법|영|규칙|령)/g
  match = lawPattern.exec(text)
  while (match) {
    const fullMatch = match[0]
    const context = extractContext(text, match.index, 30)

    references.push({
      text: fullMatch,
      reference: "현행 법령 전체",
      context
    })

    match = lawPattern.exec(text)
  }

  return references
}

/**
 * 매칭된 텍스트 주변 문맥 추출
 */
function extractContext(text: string, index: number, contextLength: number): string {
  const start = Math.max(0, index - contextLength)
  const end = Math.min(text.length, index + contextLength)
  let context = text.substring(start, end).trim()

  // 줄바꿈 제거
  context = context.replace(/\n/g, " ")

  return context
}
