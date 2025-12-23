/**
 * extract_precedent_keywords Tool - 판례 키워드 추출
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { getPrecedentText } from "./precedents.js"

export const ExtractKeywordsSchema = z.object({
  id: z.string().describe("판례일련번호"),
  maxKeywords: z.number().optional().default(10).describe("최대 키워드 개수 (기본값: 10)"),
  apiKey: z.string().optional().describe("API 키")
})

export type ExtractKeywordsInput = z.infer<typeof ExtractKeywordsSchema>

/**
 * 법률 용어 키워드 추출 (빈도 기반)
 */
export async function extractPrecedentKeywords(
  apiClient: LawApiClient,
  input: ExtractKeywordsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    // 1. 판례 전문 조회
    const precedentResult = await getPrecedentText(apiClient, { id: input.id, apiKey: input.apiKey })

    if (precedentResult.isError || precedentResult.content.length === 0) {
      return {
        content: [{
          type: "text",
          text: "판례를 찾을 수 없습니다."
        }],
        isError: true
      }
    }

    const fullText = precedentResult.content[0].text

    // 2. 키워드 추출
    const keywords = extractKeywords(fullText, input.maxKeywords)

    // 3. 결과 포맷
    let resultText = "🔑 핵심 키워드\n\n"
    keywords.forEach((kw, idx) => {
      resultText += `${idx + 1}. ${kw.word} (${kw.count}회)\n`
    })

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
 * 빈도 기반 키워드 추출
 */
function extractKeywords(text: string, maxKeywords: number): Array<{ word: string, count: number }> {
  // 법률 용어 패턴
  const legalTermPatterns = [
    /\b[가-힣]{2,}법\b/g,      // ~법
    /\b[가-힣]{2,}권\b/g,      // ~권
    /\b[가-힣]{2,}의무\b/g,    // ~의무
    /\b[가-힣]{2,}책임\b/g,    // ~책임
    /\b[가-힣]{2,}계약\b/g,    // ~계약
    /제\d+조(의\d+)?/g,        // 조문 번호
    /\b[가-힣]{3,}에\s*관한\b/g, // ~에 관한
    /\b[가-힣]{2,}행위\b/g,    // ~행위
    /\b[가-힣]{2,}소송\b/g,    // ~소송
    /\b[가-힣]{2,}청구\b/g,    // ~청구
  ]

  const wordCount: Record<string, number> = {}

  // 각 패턴으로 용어 추출
  for (const pattern of legalTermPatterns) {
    const matches = text.match(pattern)
    if (matches) {
      matches.forEach(word => {
        const normalized = word.trim()
        if (normalized.length >= 2) {  // 2글자 이상만
          wordCount[normalized] = (wordCount[normalized] || 0) + 1
        }
      })
    }
  }

  // 일반 명사도 추출 (2-4글자 한글)
  const generalNouns = text.match(/[가-힣]{2,4}/g) || []
  generalNouns.forEach(word => {
    const normalized = word.trim()
    // 불용어 제거 (조사, 어미 등)
    const stopWords = ["것을", "것은", "것이", "하는", "되는", "있는", "없는", "하고", "되고", "이고"]
    if (!stopWords.includes(normalized) && normalized.length >= 2) {
      wordCount[normalized] = (wordCount[normalized] || 0) + 1
    }
  })

  // 빈도순 정렬
  const sorted = Object.entries(wordCount)
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .filter(item => item.count >= 2)  // 2회 이상만
    .slice(0, maxKeywords)

  return sorted
}
