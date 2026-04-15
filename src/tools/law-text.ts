/**
 * get_law_text Tool - 법령 조문 조회
 *
 * 개선 사항:
 *  - lawName 파라미터 추가: mst/lawId 없이 법령명만으로 조문 조회 가능
 *  - jo 자유형식 지원: '제38조', '38조', '38', '38조의2' 모두 허용
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { buildJO } from "../lib/law-parser.js"
import { lawCache } from "../lib/cache.js"
import { formatArticleUnit } from "../lib/article-parser.js"
import { formatToolError } from "../lib/errors.js"

import { MAX_RESPONSE_SIZE, truncateResponse } from "../lib/schemas.js"

export const GetLawTextSchema = z.object({
  lawName: z.string().optional().describe("법령명 (예: '근로기준법'). mst/lawId를 모를 때 사용. 있으면 자동으로 mst를 검색함."),
  mst: z.string().optional().describe("법령일련번호 (search_law에서 획득)"),
  lawId: z.string().optional().describe("법령ID (search_law에서 획득)"),
  jo: z.string().optional().describe("조문 번호 — '제38조', '38조', '38', '38조의2' 등 자유형식 모두 허용"),
  efYd: z.string().optional().describe("시행일자 (YYYYMMDD 형식)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
}).refine(data => data.mst || data.lawId || data.lawName, {
  message: "lawName, mst, lawId 중 하나는 필수입니다"
})

/**
 * jo 파라미터를 '제N조' 또는 '제N조의M' 정규 형식으로 정규화
 * '38' → '제38조', '38조' → '제38조', '38조의2' → '제38조의2'
 */
function normalizeJo(jo: string): string {
  // 이미 정규 형식
  if (/^제\d+조/.test(jo)) return jo
  // '38조의2' 또는 '38조'
  if (/^\d+조/.test(jo)) return `제${jo}`
  // 숫자만 '38'
  if (/^\d+$/.test(jo)) return `제${jo}조`
  return jo
}

export type GetLawTextInput = z.infer<typeof GetLawTextSchema>

export async function getLawText(
  apiClient: LawApiClient,
  input: GetLawTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    // lawName만 있으면 search_law로 mst 자동 획득
    let resolvedMst = input.mst
    let resolvedLawId = input.lawId
    if (!resolvedMst && !resolvedLawId && input.lawName) {
      const xmlText = await apiClient.searchLaw(input.lawName, input.apiKey)
      const mstMatch = xmlText.match(/<법령일련번호>(\d+)<\/법령일련번호>/)
      if (mstMatch) {
        resolvedMst = mstMatch[1]
      } else {
        return {
          content: [{
            type: "text",
            text: `법령 '${input.lawName}'을(를) 찾을 수 없습니다. 법령명을 확인하거나 search_law로 먼저 검색해주세요.`
          }],
          isError: true
        }
      }
    }

    // jo 자유형식 → 정규 형식으로 정규화 후 JO 코드 변환
    let joCode = input.jo ? normalizeJo(input.jo) : undefined
    if (joCode && /^제\d+조/.test(joCode)) {
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
    const cacheKey = `lawtext:${resolvedMst || resolvedLawId}:${joCode || 'full'}:${input.efYd || 'current'}`
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
      mst: resolvedMst,
      lawId: resolvedLawId,
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
          errorMsg += `\n\n이 법령은 제${range.min}조~제${range.max}조까지 총 ${range.count}개 조문만 존재합니다.`
          errorMsg += `\n\n해결 방법:`
          errorMsg += `\n   1. 전체 조회:`
          if (resolvedMst) {
            errorMsg += `\n      get_law_text(mst="${resolvedMst}")`
          } else if (resolvedLawId) {
            errorMsg += `\n      get_law_text(lawId="${resolvedLawId}")`
          }
          errorMsg += `\n\n   2. 유사 조문 조회 예시:`
          const suggestJo = Math.max(1, range.max - 3)
          if (resolvedMst) {
            errorMsg += `\n      get_law_text(mst="${resolvedMst}", jo="제${range.max}조")`
            errorMsg += `\n      get_law_text(mst="${resolvedMst}", jo="제${suggestJo}조")`
          } else if (resolvedLawId) {
            errorMsg += `\n      get_law_text(lawId="${resolvedLawId}", jo="제${range.max}조")`
            errorMsg += `\n      get_law_text(lawId="${resolvedLawId}", jo="제${suggestJo}조")`
          }
          errorMsg += `\n\n   3. 키워드 검색:`
          errorMsg += `\n      search_all(query="${lawName.replace(/\s+(시행령|시행규칙)/, '')}")`
        } else {
          errorMsg += `\n\n조문을 찾을 수 없습니다. 다음을 시도해보세요:`
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
      tocText += `목차 (총 ${tocItems.length}개 조문)\n\n`
      tocText += tocItems.join("\n")
      tocText += `\n\n특정 조문 조회: get_law_text(`
      if (resolvedMst) {
        tocText += `mst="${resolvedMst}", jo="제XX조")`
      } else if (resolvedLawId) {
        tocText += `lawId="${resolvedLawId}", jo="제XX조")`
      }
      tocText += `\n여러 조문 일괄 조회: get_batch_articles 도구 사용`

      lawCache.set(cacheKey, tocText)
      return {
        content: [{
          type: "text",
          text: truncateResponse(tocText)
        }]
      }
    }

    for (const unit of articleUnits) {
      const formatted = formatArticleUnit(unit)
      if (!formatted) continue

      if (formatted.header) resultText += `${formatted.header}\n`
      if (formatted.body) resultText += `${formatted.body}\n\n`
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

      resultText += `\n\n[응답 크기 제한] ${totalArticles}개 조문 중 ${includedArticles.length}개만 포함 (${first}~${last})`
      resultText += `\n나머지 조문 조회: get_law_text(`
      if (resolvedMst) {
        resultText += `mst="${resolvedMst}", jo="제XX조")`
      } else if (resolvedLawId) {
        resultText += `lawId="${resolvedLawId}", jo="제XX조")`
      }
      resultText += `\n여러 조문 일괄 조회: get_batch_articles 도구 사용`
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
    return formatToolError(error, "get_law_text")
  }
}
