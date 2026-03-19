/**
 * get_law_text Tool - 법령 조문 조회
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { buildJO } from "../lib/law-parser.js"
import { lawCache } from "../lib/cache.js"
import { flattenContent, extractHangContent, cleanHtml } from "../lib/article-parser.js"

import { MAX_RESPONSE_SIZE } from "../lib/schemas.js"

export const GetLawTextSchema = z.object({
  mst: z.string().optional().describe("법령일련번호 (search_law에서 획득)"),
  lawId: z.string().optional().describe("법령ID (search_law에서 획득)"),
  jo: z.string().optional().describe("조문 번호 (예: '제38조' 또는 '003800')"),
  efYd: z.string().optional().describe("시행일자 (YYYYMMDD 형식)"),
  apiKey: z.string().optional().describe("API 키")
}).refine(data => data.mst || data.lawId, {
  message: "mst 또는 lawId 중 하나는 필수입니다"
})

export type GetLawTextInput = z.infer<typeof GetLawTextSchema>

export async function getLawText(
  apiClient: LawApiClient,
  input: GetLawTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    // 조문 번호가 한글이면 JO 코드로 변환
    let joCode = input.jo
    if (joCode && /제\d+조/.test(joCode)) {
      try {
        joCode = buildJO(joCode)
      } catch (e) {
        return {
          content: [{
            type: "text",
            text: `조문 번호 변환 실패: ${e instanceof Error ? e.message : String(e)}`
          }],
          isError: true
        }
      }
    }

    // Check cache first (efYd 정규화: 미지정 → 'current'로 통일)
    const cacheKey = `lawtext:${input.mst || input.lawId}:${joCode || 'full'}:${input.efYd || 'current'}`
    const cached = lawCache.get<string>(cacheKey)
    if (cached) {
      return {
        content: [{
          type: "text",
          text: cached
        }]
      }
    }

    const jsonText = await apiClient.getLawText({
      mst: input.mst,
      lawId: input.lawId,
      jo: joCode,
      efYd: input.efYd,
      apiKey: input.apiKey
    })

    const json = JSON.parse(jsonText)

    // JSON 구조 파싱 (LexDiff 방식 적용)
    const lawData = json?.법령
    if (!lawData) {
      return {
        content: [{
          type: "text",
          text: "법령 데이터를 찾을 수 없습니다."
        }],
        isError: true
      }
    }

    // 조문 범위 파싱 함수
    const extractArticleRange = (data: any): { min: number, max: number, count: number } | null => {
      const rawUnits = data.조문?.조문단위
      if (!rawUnits) return null

      const units = Array.isArray(rawUnits) ? rawUnits : [rawUnits]
      const articleNumbers: number[] = []

      for (const unit of units) {
        if (unit.조문여부 === "조문" && unit.조문번호) {
          const num = parseInt(unit.조문번호, 10)
          if (!isNaN(num)) articleNumbers.push(num)
        }
      }

      if (articleNumbers.length === 0) return null

      return {
        min: Math.min(...articleNumbers),
        max: Math.max(...articleNumbers),
        count: articleNumbers.length
      }
    }

    const basicInfo = lawData.기본정보 || lawData
    const lawName = basicInfo?.법령명_한글 || basicInfo?.법령명한글 || basicInfo?.법령명 || "알 수 없음"
    const promDate = basicInfo?.공포일자 || ""
    const effDate = basicInfo?.시행일자 || basicInfo?.최종시행일자 || ""

    let resultText = `법령명: ${lawName}\n`
    if (promDate) resultText += `공포일: ${promDate}\n`
    if (effDate) resultText += `시행일: ${effDate}\n`
    resultText += `\n`

    // 조문 내용 추출 (정확한 경로: 법령.조문.조문단위)
    // 주의: 조문단위는 배열 또는 객체일 수 있음
    const rawUnits = lawData.조문?.조문단위
    let articleUnits: any[] = []

    if (Array.isArray(rawUnits)) {
      articleUnits = rawUnits
    } else if (rawUnits && typeof rawUnits === 'object') {
      articleUnits = [rawUnits]  // 단일 객체를 배열로 변환
    }

    if (articleUnits.length === 0) {
      // 조문 범위 확인
      const range = extractArticleRange(lawData)
      let errorMsg = resultText + "조문 내용을 찾을 수 없습니다."

      if (input.jo) {
        // 특정 조문 요청했는데 없는 경우
        if (range) {
          errorMsg += `\n\n💡 이 법령은 제${range.min}조~제${range.max}조까지 총 ${range.count}개 조문만 존재합니다.`
          errorMsg += `\n\n해결 방법:`
          errorMsg += `\n   1. 전체 조회:`
          if (input.mst) {
            errorMsg += `\n      get_law_text(mst="${input.mst}")`
          } else if (input.lawId) {
            errorMsg += `\n      get_law_text(lawId="${input.lawId}")`
          }
          errorMsg += `\n\n   2. 유사 조문 조회 예시:`
          const suggestJo = Math.max(1, range.max - 3)
          if (input.mst) {
            errorMsg += `\n      get_law_text(mst="${input.mst}", jo="제${range.max}조")`
            errorMsg += `\n      get_law_text(mst="${input.mst}", jo="제${suggestJo}조")`
          } else if (input.lawId) {
            errorMsg += `\n      get_law_text(lawId="${input.lawId}", jo="제${range.max}조")`
            errorMsg += `\n      get_law_text(lawId="${input.lawId}", jo="제${suggestJo}조")`
          }
          errorMsg += `\n\n   3. 키워드 검색:`
          errorMsg += `\n      search_all(query="${lawName.replace(/\s+(시행령|시행규칙)/, '')}")`
        } else {
          errorMsg += `\n\n💡 조문을 찾을 수 없습니다. 다음을 시도해보세요:`
          errorMsg += `\n   - 전체 법령 조회 (jo 파라미터 생략)`
          errorMsg += `\n   - 키워드 검색 (search_all 도구 사용)`
        }
      }

      return {
        content: [{
          type: "text",
          text: errorMsg
        }],
        isError: true
      }
    }

    // 조문 미지정 시 전체 법령 대신 목차(조문 제목 목록)만 반환
    // 대형 법령(국가공무원법 등)의 "too large content" 에러 방지
    if (!input.jo && articleUnits.length > 20) {
      const tocItems: string[] = []
      for (const unit of articleUnits) {
        if (unit.조문여부 !== "조문") continue
        const joNum = unit.조문번호 || ""
        const joBranch = unit.조문가지번호 || ""
        const joTitle = unit.조문제목 || ""
        if (joNum) {
          const displayNum = joBranch && joBranch !== "0" ? `제${joNum}조의${joBranch}` : `제${joNum}조`
          tocItems.push(`${displayNum}${joTitle ? ` ${joTitle}` : ""}`)
        }
      }

      let tocText = resultText
      tocText += `📋 목차 (총 ${tocItems.length}개 조문)\n\n`
      tocText += tocItems.join("\n")
      tocText += `\n\n💡 특정 조문 조회: get_law_text(`
      if (input.mst) {
        tocText += `mst="${input.mst}", jo="제XX조")`
      } else if (input.lawId) {
        tocText += `lawId="${input.lawId}", jo="제XX조")`
      }
      tocText += `\n💡 여러 조문 일괄 조회: get_batch_articles 도구 사용`

      lawCache.set(cacheKey, tocText)
      return {
        content: [{
          type: "text",
          text: tocText
        }]
      }
    }

    // 공통 파싱 유틸리티 (article-parser.ts에서 import)
    // flattenContent, extractHangContent, cleanHtml은 상단 import 참조

    for (const unit of articleUnits) {
      // 조문 여부 확인
      if (unit.조문여부 !== "조문") continue

      const joNum = unit.조문번호 || ""
      const joBranch = unit.조문가지번호 || ""
      const joTitle = unit.조문제목 || ""

      // 조문 헤더 출력
      if (joNum) {
        const displayNum = joBranch && joBranch !== "0" ? `${joNum}조의${joBranch}` : `${joNum}조`
        resultText += `제${displayNum}`
        if (joTitle) resultText += ` ${joTitle}`
        resultText += `\n`
      }

      // STEP 1: 조문내용 추출 (본문)
      let mainContent = ""
      const rawContent = unit.조문내용

      if (rawContent) {
        const contentStr = flattenContent(rawContent)
        if (contentStr) {
          // 제목 패턴 제거: 제X조(제목) 형식
          const headerMatch = contentStr.match(/^(제\d+조(?:의\d+)?\s*(?:\([^)]+\))?)[\s\S]*/)
          if (headerMatch) {
            const bodyPart = contentStr.substring(headerMatch[1].length).trim()
            mainContent = bodyPart || contentStr
          } else {
            mainContent = contentStr
          }
        }
      }

      // STEP 2: 항/호/목 내용 추출 (API가 단일 항을 객체로 반환하는 경우 포함)
      let paraContent = ""
      if (unit.항) {
        paraContent = extractHangContent(unit.항)
      }

      // STEP 3: 본문 + 항/호/목 결합
      let finalContent = ""
      if (mainContent) {
        finalContent = mainContent
        if (paraContent) {
          finalContent += "\n" + paraContent
        }
      } else {
        finalContent = paraContent
      }

      // HTML 태그 제거 및 엔티티 변환
      if (finalContent) {
        const cleanContent = cleanHtml(finalContent)
        resultText += `${cleanContent}\n\n`
      }
    }

    // 응답 크기 제한 - 조문 경계에서 자르기 (mid-article 절단 방지)
    if (resultText.length > MAX_RESPONSE_SIZE) {
      const totalArticles = articleUnits.filter(u => u.조문여부 === "조문").length

      // 조문 헤더 위치를 역순으로 찾아서 MAX_RESPONSE_SIZE 이내의 마지막 완전한 조문 경계에서 자르기
      const articleHeaderPattern = /^제\d+조(?:의\d+)?/gm
      let lastSafePos = 0
      let includedCount = 0
      let match
      while ((match = articleHeaderPattern.exec(resultText)) !== null) {
        if (match.index > MAX_RESPONSE_SIZE - 200) break // 200자 여유 (안내 메시지용)
        lastSafePos = match.index
        includedCount++
      }

      // 마지막 조문 이후의 내용도 포함 (조문 본문)
      if (lastSafePos > 0 && includedCount > 0) {
        // 다음 조문 헤더 전까지 또는 끝까지
        const nextArticlePattern = /^제\d+조(?:의\d+)?/gm
        nextArticlePattern.lastIndex = lastSafePos + 1
        const nextMatch = nextArticlePattern.exec(resultText)
        const cutPos = nextMatch && nextMatch.index <= MAX_RESPONSE_SIZE - 200
          ? nextMatch.index
          : Math.min(resultText.length, MAX_RESPONSE_SIZE - 200)
        resultText = resultText.slice(0, cutPos)
      } else {
        resultText = resultText.slice(0, MAX_RESPONSE_SIZE - 200)
      }

      // 포함된 조문 번호 추출
      const includedArticles: string[] = []
      const finalHeaderPattern = /^(제\d+조(?:의\d+)?)/gm
      let m
      while ((m = finalHeaderPattern.exec(resultText)) !== null) {
        includedArticles.push(m[1])
      }

      const first = includedArticles[0] || "?"
      const last = includedArticles[includedArticles.length - 1] || "?"

      resultText += `\n\n⚠️ 응답 크기 제한으로 ${totalArticles}개 조문 중 ${includedArticles.length}개만 포함 (${first}~${last})`
      resultText += `\n💡 나머지 조문 조회: get_law_text(`
      if (input.mst) {
        resultText += `mst="${input.mst}", jo="제XX조")`
      } else if (input.lawId) {
        resultText += `lawId="${input.lawId}", jo="제XX조")`
      }
      resultText += `\n💡 여러 조문 일괄 조회: get_batch_articles 도구 사용`
    }

    // Cache the result
    lawCache.set(cacheKey, resultText)

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
