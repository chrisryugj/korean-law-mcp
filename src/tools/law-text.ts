/**
 * get_law_text Tool - 법령 조문 조회
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { buildJO } from "../lib/law-parser.js"
import { lawCache } from "../lib/cache.js"

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

    // Check cache first
    const cacheKey = `lawtext:${input.mst || input.lawId}:${joCode || 'full'}:${input.efYd || ''}`
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

    // Helper: 중첩 배열 평탄화 후 문자열 결합 (<img> 태그 제외)
    const flattenContent = (value: any): string => {
      if (typeof value === "string") return value
      if (!Array.isArray(value)) return ""

      const result: string[] = []
      for (const item of value) {
        if (typeof item === "string") {
          // <img> 태그만 제외 (표 테두리는 유지)
          if (!item.startsWith("<img") && !item.startsWith("</img")) {
            result.push(item)
          }
        } else if (Array.isArray(item)) {
          result.push(flattenContent(item))
        }
      }
      return result.join("\n")
    }

    // Helper: 항 배열에서 내용 추출 (재귀적으로 호/목 처리)
    const extractHangContent = (hangArray: any[]): string => {
      let content = ""

      for (const hang of hangArray) {
        // 항내용 추출
        if (hang.항내용) {
          const hangContent = flattenContent(hang.항내용)
          if (hangContent) {
            content += (content ? "\n" : "") + hangContent
          }
        }

        // 호 (items) 처리
        if (hang.호 && Array.isArray(hang.호)) {
          for (const ho of hang.호) {
            if (ho.호내용) {
              const hoContent = flattenContent(ho.호내용)
              if (hoContent) {
                content += "\n" + hoContent
              }
            }

            // 목 (sub-items) 처리
            if (ho.목 && Array.isArray(ho.목)) {
              for (const mok of ho.목) {
                if (mok.목내용) {
                  const mokContent = flattenContent(mok.목내용)
                  if (mokContent) {
                    content += "\n" + mokContent
                  }
                }
              }
            }
          }
        }
      }

      return content
    }

    // HTML 정리 함수
    const cleanHtml = (text: string): string => {
      return text
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .trim()
    }

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

      // STEP 2: 항/호/목 내용 추출
      let paraContent = ""
      if (unit.항 && Array.isArray(unit.항)) {
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
