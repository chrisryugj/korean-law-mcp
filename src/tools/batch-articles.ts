/**
 * get_batch_articles Tool - 여러 조문 한번에 조회
 * 법령 전문을 가져온 뒤 여러 조문을 추출
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { buildJO } from "../lib/law-parser.js"
import { lawCache } from "../lib/cache.js"

export const GetBatchArticlesSchema = z.object({
  mst: z.string().optional().describe("법령일련번호"),
  lawId: z.string().optional().describe("법령ID"),
  articles: z.array(z.string()).describe("조문 번호 배열 (예: ['제38조', '제39조', '제40조'])"),
  efYd: z.string().optional().describe("시행일자 (YYYYMMDD 형식)")
}).refine(data => data.mst || data.lawId, {
  message: "mst 또는 lawId 중 하나는 필수입니다"
})

export type GetBatchArticlesInput = z.infer<typeof GetBatchArticlesSchema>

export async function getBatchArticles(
  apiClient: LawApiClient,
  input: GetBatchArticlesInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    // 법령 전문 조회 (캐싱 활용)
    const cacheKey = `lawtext:${input.mst || input.lawId}:full:${input.efYd || ''}`
    let fullLawData: any

    const cached = lawCache.get<any>(cacheKey)
    if (cached) {
      fullLawData = cached
    } else {
      const jsonText = await apiClient.getLawText({
        mst: input.mst,
        lawId: input.lawId,
        efYd: input.efYd
      })
      fullLawData = JSON.parse(jsonText)
      lawCache.set(cacheKey, fullLawData)
    }

    const lawData = fullLawData?.법령
    if (!lawData) {
      return {
        content: [{
          type: "text",
          text: "법령 데이터를 찾을 수 없습니다."
        }],
        isError: true
      }
    }

    const basicInfo = lawData.기본정보 || lawData
    const lawName = basicInfo?.법령명_한글 || basicInfo?.법령명한글 || basicInfo?.법령명 || "알 수 없음"

    // 조문 번호를 JO 코드로 변환
    const joCodes = new Set<string>()
    for (const article of input.articles) {
      try {
        const joCode = buildJO(article)
        joCodes.add(joCode)
      } catch (e) {
        return {
          content: [{
            type: "text",
            text: `조문 번호 변환 실패 (${article}): ${e instanceof Error ? e.message : String(e)}`
          }],
          isError: true
        }
      }
    }

    // 조문 추출
    const rawUnits = lawData.조문?.조문단위
    let articleUnits: any[] = []

    if (Array.isArray(rawUnits)) {
      articleUnits = rawUnits
    } else if (rawUnits && typeof rawUnits === 'object') {
      articleUnits = [rawUnits]
    }

    if (articleUnits.length === 0) {
      return {
        content: [{
          type: "text",
          text: "조문 내용을 찾을 수 없습니다."
        }],
        isError: true
      }
    }

    let resultText = `법령명: ${lawName}\n`
    resultText += `조회 조문: ${input.articles.join(', ')}\n\n`

    // Helper functions (from law-text.ts)
    const flattenContent = (value: any): string => {
      if (typeof value === "string") return value
      if (!Array.isArray(value)) return ""

      const result: string[] = []
      for (const item of value) {
        if (typeof item === "string") {
          if (!item.startsWith("<img") && !item.startsWith("</img")) {
            result.push(item)
          }
        } else if (Array.isArray(item)) {
          result.push(flattenContent(item))
        }
      }
      return result.join("\n")
    }

    const extractHangContent = (hangArray: any[]): string => {
      let content = ""

      for (const hang of hangArray) {
        if (hang.항내용) {
          const hangContent = flattenContent(hang.항내용)
          if (hangContent) {
            content += (content ? "\n" : "") + hangContent
          }
        }

        if (hang.호 && Array.isArray(hang.호)) {
          for (const ho of hang.호) {
            if (ho.호내용) {
              const hoContent = flattenContent(ho.호내용)
              if (hoContent) {
                content += "\n" + hoContent
              }
            }

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

    // 요청된 조문만 필터링
    let foundCount = 0
    for (const unit of articleUnits) {
      if (unit.조문여부 !== "조문") continue

      const joNum = unit.조문번호 || ""
      const joBranch = unit.조문가지번호 || ""

      // JO 코드 생성
      const unitJoCode = joNum.padStart(4, '0') + (joBranch || '00').padStart(2, '0')

      // 요청된 조문인지 확인
      if (!joCodes.has(unitJoCode)) continue

      foundCount++
      const joTitle = unit.조문제목 || ""

      // 조문 헤더 출력
      if (joNum) {
        const displayNum = joBranch && joBranch !== "0" ? `${joNum}조의${joBranch}` : `${joNum}조`
        resultText += `제${displayNum}`
        if (joTitle) resultText += ` ${joTitle}`
        resultText += `\n`
      }

      // 조문 내용 추출
      let mainContent = ""
      const rawContent = unit.조문내용

      if (rawContent) {
        const contentStr = flattenContent(rawContent)
        if (contentStr) {
          const headerMatch = contentStr.match(/^(제\d+조(?:의\d+)?\s*(?:\([^)]+\))?)[\s\S]*/)
          if (headerMatch) {
            const bodyPart = contentStr.substring(headerMatch[1].length).trim()
            mainContent = bodyPart || contentStr
          } else {
            mainContent = contentStr
          }
        }
      }

      // 항/호/목 내용 추출
      let paraContent = ""
      if (unit.항 && Array.isArray(unit.항)) {
        paraContent = extractHangContent(unit.항)
      }

      // 본문 + 항/호/목 결합
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

    if (foundCount === 0) {
      resultText += "요청한 조문을 찾을 수 없습니다."
    } else if (foundCount < input.articles.length) {
      resultText += `\n⚠️ ${input.articles.length}개 중 ${foundCount}개 조문만 찾았습니다.`
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
