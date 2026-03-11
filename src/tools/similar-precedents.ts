/**
 * find_similar_precedents Tool - 유사 판례 검색
 * 키워드 기반 유사도 계산 (간단한 구현)
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { searchPrecedents } from "./precedents.js"

export const FindSimilarPrecedentsSchema = z.object({
  query: z.string().describe("검색 키워드 또는 판례 내용"),
  display: z.number().optional().default(5).describe("최대 결과 개수 (기본값: 5)"),
  apiKey: z.string().optional().describe("API 키")
})

export type FindSimilarPrecedentsInput = z.infer<typeof FindSimilarPrecedentsSchema>

/**
 * 유사 판례 검색 (키워드 기반)
 * 실제 벡터 유사도 계산은 향후 추가 가능
 */
export async function findSimilarPrecedents(
  apiClient: LawApiClient,
  input: FindSimilarPrecedentsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    // 1. 입력 텍스트에서 키워드 추출
    const keywords = extractQueryKeywords(input.query)

    if (keywords.length === 0) {
      return {
        content: [{
          type: "text",
          text: "키워드를 추출할 수 없습니다. 더 구체적인 검색어를 입력해주세요."
        }],
        isError: true
      }
    }

    // 2. 키워드로 판례 검색
    const searchQuery = keywords.join(" ")
    const searchResult = await searchPrecedents(apiClient, {
      query: searchQuery,
      display: input.display * 2,  // 여유있게 가져오기
      page: 1,
      apiKey: input.apiKey
    })

    if (searchResult.isError) {
      return searchResult
    }

    // 3. 유사도 기반 정렬 (간단한 키워드 매칭)
    const resultText = searchResult.content[0].text
    const rankedResults = rankByKeywordSimilarity(resultText, keywords, input.display)

    return {
      content: [{
        type: "text",
        text: rankedResults
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
 * 쿼리에서 키워드 추출
 */
function extractQueryKeywords(query: string): string[] {
  const keywords: string[] = []

  // 법률 용어 패턴
  const legalTerms = query.match(/[가-힣]{2,}법/g)
  if (legalTerms) keywords.push(...legalTerms)

  // 조문 번호
  const articles = query.match(/제\d+조(의\d+)?/g)
  if (articles) keywords.push(...articles)

  // 일반 명사 (2-4글자)
  const nouns = query.match(/[가-힣]{2,4}/g)
  if (nouns) {
    // 불용어 제거
    const stopWords = ["것을", "것은", "것이", "하는", "되는", "있는", "없는", "관련", "대한", "관하여"]
    const filtered = nouns.filter(w => !stopWords.includes(w) && w.length >= 2)
    keywords.push(...filtered)
  }

  // 중복 제거
  return Array.from(new Set(keywords))
}

/**
 * 키워드 유사도 기반 순위 매기기
 */
function rankByKeywordSimilarity(searchResultText: string, keywords: string[], maxResults: number): string {
  const lines = searchResultText.split('\n')

  // 각 판례별로 키워드 매칭 점수 계산
  const precedents: Array<{ text: string, score: number }> = []
  let currentPrecedent = ""
  let currentScore = 0

  for (const line of lines) {
    if (line.match(/^\d+\.\s/)) {  // 새로운 판례 시작
      if (currentPrecedent) {
        precedents.push({ text: currentPrecedent, score: currentScore })
      }
      currentPrecedent = line
      currentScore = 0

      // 키워드 매칭 점수 계산
      for (const keyword of keywords) {
        const regex = new RegExp(keyword, 'g')
        const matches = line.match(regex)
        if (matches) {
          currentScore += matches.length
        }
      }
    } else {
      currentPrecedent += "\n" + line

      // 키워드 매칭 점수 추가
      for (const keyword of keywords) {
        const regex = new RegExp(keyword, 'g')
        const matches = line.match(regex)
        if (matches) {
          currentScore += matches.length * 0.5  // 본문 매칭은 절반 가중치
        }
      }
    }
  }

  // 마지막 판례 추가
  if (currentPrecedent) {
    precedents.push({ text: currentPrecedent, score: currentScore })
  }

  // 점수순 정렬
  precedents.sort((a, b) => b.score - a.score)

  // 상위 N개만 반환
  const topResults = precedents.slice(0, maxResults)

  let resultText = `🔍 유사 판례 (총 ${topResults.length}건, 유사도순 정렬)\n\n`
  resultText += `검색 키워드: ${keywords.join(", ")}\n\n`

  topResults.forEach((p, idx) => {
    resultText += `${p.text}\n`
    resultText += `   유사도 점수: ${p.score.toFixed(1)}\n\n`
  })

  return resultText
}
