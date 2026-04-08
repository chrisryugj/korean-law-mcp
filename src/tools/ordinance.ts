/**
 * get_ordinance Tool - 자치법규 조회
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { cleanHtml } from "../lib/article-parser.js"
import { buildOrdinanceJO } from "../lib/law-parser.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"

export const GetOrdinanceSchema = z.object({
  ordinSeq: z.string().describe("자치법규 일련번호"),
  jo: z.string().optional().describe("조문 번호 (예: '제20조'). 지정 시 해당 조문 본문만 반환"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
})

export type GetOrdinanceInput = z.infer<typeof GetOrdinanceSchema>

export async function getOrdinance(
  apiClient: LawApiClient,
  input: GetOrdinanceInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    // jo가 한글이면 JO 코드로 변환하여 API에 전달 (서버 필터링 시도)
    let joCode: string | undefined
    if (input.jo) {
      try {
        joCode = /제\d+조/.test(input.jo) ? buildOrdinanceJO(input.jo) : input.jo
      } catch {
        // JO 코드 변환 실패 시 클라이언트 필터링만 사용
      }
    }

    const jsonText = await apiClient.getOrdinance(input.ordinSeq, joCode, input.apiKey)
    const json = JSON.parse(jsonText)

    const lawService = json?.LawService

    if (!lawService) {
      return {
        content: [{
          type: "text",
          text: "자치법규 데이터를 찾을 수 없습니다."
        }],
        isError: true
      }
    }

    const ordinance = lawService.자치법규기본정보 || {}

    let resultText = `자치법규명: ${ordinance.자치법규명 || "알 수 없음"}\n`
    resultText += `제정일: ${ordinance.공포일자 || ""}\n`
    resultText += `자치단체: ${ordinance.지자체기관명 || ""}\n`
    resultText += `시행일: ${ordinance.시행일자 || ""}\n`

    if (ordinance.담당부서명) {
      resultText += `소관부서: ${ordinance.담당부서명}\n`
    }

    resultText += `\n---\n\n`

    // 조문 내용 (단일 객체 → 배열 정규화)
    const rawArticles = lawService.조문?.조
    const articles = Array.isArray(rawArticles) ? rawArticles : rawArticles ? [rawArticles] : []

    if (articles.length > 0) {
      // jo 파라미터가 있으면 해당 조문만 필터링
      if (input.jo) {
        // "제20조" → "제20조(목적)" 매칭, "제20조의2" 는 제외
        const joNorm = input.jo.replace(/\s+/g, "")
        const matched = articles.filter(a => {
          const title = (a.조제목 || "").replace(/\s+/g, "")
          if (!title.startsWith(joNorm)) return false
          // "제20조" 뒤에 "의" 가 오면 다른 조문 (제20조의2 등)
          const rest = title.slice(joNorm.length)
          return rest === "" || rest.startsWith("(")
        })

        if (matched.length === 0) {
          resultText += `'${input.jo}' 조문을 찾을 수 없습니다.\n\n`
          resultText += `목차 (총 ${articles.length}개 조문)\n\n`
          const tocItems: string[] = []
          for (const article of articles) {
            if (article.조제목) tocItems.push(article.조제목)
          }
          resultText += tocItems.join("\n")
        } else {
          for (const article of matched) {
            if (article.조제목) resultText += `${article.조제목}\n`
            if (article.조내용) resultText += `${cleanHtml(String(article.조내용))}\n\n`
          }
        }
      } else if (articles.length > 20) {
        // 대형 조례(20개 초과): TOC 반환 (law-text.ts 패턴)
        const tocItems: string[] = []
        for (const article of articles) {
          if (article.조제목) tocItems.push(article.조제목)
        }
        resultText += `목차 (총 ${articles.length}개 조문)\n\n`
        resultText += tocItems.join("\n")
        resultText += `\n\n특정 조문 조회: get_ordinance(ordinSeq="${input.ordinSeq}", jo="제XX조")`
      } else {
        for (const article of articles) {
          if (article.조제목) {
            resultText += `${article.조제목}\n`
          }
          if (article.조내용) {
            resultText += `${cleanHtml(String(article.조내용))}\n\n`
          }
        }
      }
    }

    // 상위법령 동적 추천 (조례명 키워드 기반)
    const name = (ordinance.자치법규명 || "").toLowerCase()
    const parentLawHints: string[] = []
    if (/휴직|병가|육아/.test(name)) parentLawHints.push('search_law(query="지방공무원법") → 제63조(휴직)')
    if (/복무|근무/.test(name)) parentLawHints.push('search_law(query="지방공무원법") → 제48조(복무)')
    if (/징계|파면|해임/.test(name)) parentLawHints.push('search_law(query="지방공무원법") → 제69조(징계)')
    if (/수당|급여|보수/.test(name)) parentLawHints.push('search_law(query="지방공무원 보수규정")')
    if (/임용|채용|승진|전보/.test(name)) parentLawHints.push('search_law(query="지방공무원 임용령")')

    // 상위법령 안내 제거 (LLM이 이미 도구 목록을 알고 있음)

    return {
      content: [{
        type: "text",
        text: truncateResponse(resultText)
      }]
    }
  } catch (error) {
    return formatToolError(error, "get_ordinance")
  }
}
