/**
 * get_batch_articles Tool - 여러 조문 한번에 조회
 * 단일 법령 또는 복수 법령의 조문을 일괄 조회
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { buildJO } from "../lib/law-parser.js"
import { lawCache } from "../lib/cache.js"
import { formatArticleUnit } from "../lib/article-parser.js"
import { truncateResponse } from "../lib/schemas.js"
import type { ToolResponse } from "../lib/types.js"
import { formatToolError } from "../lib/errors.js"

const LawEntrySchema = z.object({
  mst: z.string().optional().describe("법령일련번호"),
  lawId: z.string().optional().describe("법령ID"),
  articles: z.array(z.string()).describe("조문 번호 배열 (예: ['제38조', '제39조'])"),
})

type LawEntry = z.infer<typeof LawEntrySchema>

export const GetBatchArticlesSchema = z.object({
  mst: z.string().optional().describe("법령일련번호 (단일 법령 조회 시)"),
  lawId: z.string().optional().describe("법령ID (단일 법령 조회 시)"),
  articles: z.array(z.string()).optional().describe("조문 번호 배열 (단일 법령 조회 시, 예: ['제38조', '제39조'])"),
  efYd: z.string().optional().describe("시행일자 (YYYYMMDD 형식)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
  laws: z.array(LawEntrySchema).optional().describe(
    "복수 법령 조문 일괄 조회 (예: [{mst:'123', articles:['제1조','제2조']}, {lawId:'456', articles:['제3조']}])"
  ),
}).refine(data => data.laws || data.mst || data.lawId, {
  message: "laws 배열 또는 mst/lawId 중 하나는 필수입니다"
})

export type GetBatchArticlesInput = z.infer<typeof GetBatchArticlesSchema>

interface FetchResult {
  text?: string
  foundCount?: number
  error?: string
}

/** 법령 API JSON 응답의 조문단위 구조 */
interface ArticleUnit {
  조문여부?: string
  조문번호?: string
  조문가지번호?: string
  조문제목?: string
  조문내용?: unknown
  항?: unknown[]
  [key: string]: unknown
}

/** 법령 API JSON 응답 구조 (사용하는 필드만 정의) */
interface LawResponse {
  법령?: {
    기본정보?: Record<string, string>
    조문?: { 조문단위?: ArticleUnit | ArticleUnit[] }
    [key: string]: unknown
  }
  [key: string]: unknown
}

/**
 * 단일 법령에서 조문 추출
 */
async function fetchArticlesForLaw(
  apiClient: LawApiClient,
  lawReq: LawEntry,
  efYd?: string,
  apiKey?: string
): Promise<FetchResult> {
  const cacheKey = `batch:${lawReq.mst || lawReq.lawId}:full:${efYd || 'current'}`
  let fullLawData: LawResponse

  const cached = lawCache.get<LawResponse>(cacheKey)
  if (cached) {
    fullLawData = cached
  } else {
    const jsonText = await apiClient.getLawText({
      mst: lawReq.mst,
      lawId: lawReq.lawId,
      efYd: efYd,
      apiKey: apiKey,
    })
    fullLawData = JSON.parse(jsonText) as LawResponse
    lawCache.set(cacheKey, fullLawData)
  }

  const lawData = fullLawData?.법령
  if (!lawData) {
    return { error: `법령 데이터를 찾을 수 없습니다 (${lawReq.mst || lawReq.lawId}).` }
  }

  const basicInfo = lawData.기본정보 ?? {} as Record<string, string>
  const lawName = basicInfo.법령명_한글 || basicInfo.법령명한글 || basicInfo.법령명 || "알 수 없음"

  // 조문 번호를 JO 코드로 변환
  const joCodes = new Set<string>()
  for (const article of lawReq.articles) {
    try {
      const joCode = buildJO(article)
      joCodes.add(joCode)
    } catch (e) {
      return { error: `조문 번호 변환 실패 (${article}): ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  // 조문 추출
  const rawUnits = lawData.조문?.조문단위
  let articleUnits: ArticleUnit[] = []

  if (Array.isArray(rawUnits)) {
    articleUnits = rawUnits
  } else if (rawUnits && typeof rawUnits === 'object') {
    articleUnits = [rawUnits]
  }

  if (articleUnits.length === 0) {
    return { error: `${lawName}: 조문 내용을 찾을 수 없습니다.` }
  }

  let resultText = `${lawName}\n`
  let foundCount = 0

  for (const unit of articleUnits) {
    if (unit.조문여부 !== "조문") continue

    const joNum = unit.조문번호 || ""
    const joBranch = unit.조문가지번호 || ""
    const unitJoCode = joNum.padStart(4, '0') + (joBranch || '00').padStart(2, '0')

    if (!joCodes.has(unitJoCode)) continue

    foundCount++

    const formatted = formatArticleUnit(unit)
    if (formatted) {
      if (formatted.header) resultText += `${formatted.header}\n`
      if (formatted.body) resultText += `${formatted.body}\n\n`
    }
  }

  if (foundCount === 0) {
    resultText += "요청한 조문을 찾을 수 없습니다.\n"
  } else if (foundCount < lawReq.articles.length) {
    resultText += `[주의] ${lawReq.articles.length}개 중 ${foundCount}개 조문만 찾았습니다.\n`
  }

  return { text: resultText, foundCount }
}

export async function getBatchArticles(
  apiClient: LawApiClient,
  input: GetBatchArticlesInput
): Promise<ToolResponse> {
  try {
    // 입력 정규화: laws 배열 또는 단일 법령 -> 통일된 배열
    let lawRequests: LawEntry[]
    if (input.laws && input.laws.length > 0) {
      lawRequests = input.laws
    } else {
      lawRequests = [{
        mst: input.mst,
        lawId: input.lawId,
        articles: input.articles || [],
      }]
    }

    // 각 법령별 조문 일괄 추출 (동시성 제한 병렬 처리)
    const results: string[] = []
    const errors: string[] = []

    // 사전 검증: 유효한 요청만 필터링
    const validRequests: { index: number; lawReq: LawEntry }[] = []
    for (let i = 0; i < lawRequests.length; i++) {
      const lawReq = lawRequests[i]
      if (!lawReq.articles || lawReq.articles.length === 0) {
        errors.push(`${lawReq.mst || lawReq.lawId}: articles 배열이 비어 있습니다.`)
        continue
      }
      if (!lawReq.mst && !lawReq.lawId) {
        errors.push(`법령 식별자(mst 또는 lawId)가 없습니다.`)
        continue
      }
      validRequests.push({ index: i, lawReq })
    }

    // 동시성 제한 병렬 처리 (최대 4개씩)
    const CONCURRENCY = 4
    const fetchResults: { index: number; result?: FetchResult; error?: string }[] = []

    for (let i = 0; i < validRequests.length; i += CONCURRENCY) {
      const chunk = validRequests.slice(i, i + CONCURRENCY)
      const settled = await Promise.allSettled(
        chunk.map(async ({ index, lawReq }) => {
          const result = await fetchArticlesForLaw(apiClient, lawReq, input.efYd, input.apiKey)
          return { index, result }
        })
      )
      for (let j = 0; j < settled.length; j++) {
        const s = settled[j]
        if (s.status === 'fulfilled') {
          fetchResults.push(s.value)
        } else {
          const lawReq = chunk[j].lawReq
          fetchResults.push({
            index: chunk[j].index,
            error: `${lawReq.mst || lawReq.lawId}: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`,
          })
        }
      }
    }

    // 원래 순서대로 정렬 후 결과 수집
    fetchResults.sort((a, b) => a.index - b.index)
    for (const fr of fetchResults) {
      if (fr.error) {
        errors.push(fr.error)
      } else if (fr.result?.error) {
        errors.push(fr.result.error)
      } else if (fr.result?.text) {
        results.push(fr.result.text)
      }
    }

    let finalText = ""
    if (results.length > 0) {
      finalText = results.join("\n---\n\n")
    }
    if (errors.length > 0) {
      if (finalText) finalText += "\n"
      finalText += `[ERROR] 오류:\n${errors.map(e => `  - ${e}`).join('\n')}`
    }
    if (!finalText) {
      finalText = "조회할 조문이 없습니다."
    }

    return {
      content: [{
        type: "text",
        text: truncateResponse(finalText),
      }],
      isError: results.length === 0 && errors.length > 0,
    }
  } catch (error) {
    return formatToolError(error, "get_batch_articles")
  }
}
