/**
 * get_three_tier Tool - 3단비교 (법률→시행령→시행규칙)
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { parseThreeTierCitation } from "../lib/three-tier-citation.js"
import { parseThreeTierDelegation } from "../lib/three-tier-parser.js"
import { cleanHtml } from "../lib/article-parser.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"
import { lawCache } from "../lib/cache.js"
import { findLaws, resolvedLawMatches } from "../lib/law-search.js"

export const GetThreeTierSchema = z.object({
  mst: z.string().optional().describe("법령일련번호"),
  lawId: z.string().optional().describe("법령ID"),
  lawName: z.string().optional().describe("법령명 (mst·lawId 대신, 예: '자동차관리법')"),
  jo: z.string().optional().describe("이 조만 (예: '제8조', '8', '제9조의2'). 비우면 앞 5개 조와 나머지 조 번호 목록"),
  knd: z.enum(["1", "2"]).optional().default("2").describe("1=인용조문, 2=위임조문 (기본값)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
}).refine(data => data.mst || data.lawId || data.lawName, {
  message: "mst·lawId·lawName 중 하나는 필수입니다"
})

/** "제9조의2"·"9의2"·"9" → [9, 2] */
function joKey(jo: string): [number, number] | undefined {
  const m = jo.replace(/\s+/g, "").match(/^(?:제)?(\d+)(?:조)?(?:의(\d+))?$/)
  return m ? [parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : 0] : undefined
}

export type GetThreeTierInput = z.infer<typeof GetThreeTierSchema>

export async function getThreeTier(
  apiClient: LawApiClient,
  input: GetThreeTierInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    // 3단비교 응답은 조문 필터가 없어 통째로 온다(관세법 1.98 MB, JO·display 무시 실측). 같은 법령을 체인 여럿
    // (law_system·action_basis·ordinance_compare·procedure_detail)이 부르므로 렌더 결과를 캐시한다(2026-09-28 성능 감사).
    // 옛 MST 를 줘도 늘 현행 3단비교가 온다(MST 는 법령을 고를 뿐, 리뷰 실측) — 시행령·시행규칙 개정을 넘기지 않게 1시간만 둔다.
    // 체인은 스키마를 거치지 않아 knd 가 비어 온다 — 기본값 2로 맞춰 키를 하나로
    let { mst, lawId } = input
    if (!mst && !lawId) {
      const hits = await findLaws(apiClient, input.lawName!, input.apiKey, 3)
      const hit = hits.find(h => resolvedLawMatches(input.lawName!, h.lawName)) ?? hits[0]
      if (!hit) return { content: [{ type: "text", text: `[NOT_FOUND] '${input.lawName}' 법령을 찾지 못했습니다. 정식 법령명이나 공식 약칭으로 다시 찾으세요.` }], isError: true }
      lawId = hit.lawId
      mst = lawId ? undefined : hit.mst
    }
    const want = input.jo ? joKey(input.jo) : undefined
    if (input.jo && !want) return { content: [{ type: "text", text: `[INVALID_INPUT] jo '${input.jo}' 를 읽지 못했습니다 (예: '제8조', '제9조의2')` }], isError: true }
    // 렌더가 아니라 파싱 결과를 캐시한다. 조를 골라 볼 때마다 통째 응답(관세법 1.98 MB)을 다시 받지 않게
    const cacheKey = `thdcmp:${mst ? `m${mst}` : `i${lawId}`}:${input.knd || "2"}`
    type Parsed = ReturnType<typeof parseThreeTierDelegation>
    let threeTierData = lawCache.get<Parsed>(cacheKey)
    if (!threeTierData) {
      const json = JSON.parse(await apiClient.getThreeTier({ mst, lawId, knd: input.knd, apiKey: input.apiKey }))
      threeTierData = (input.knd === "1" ? parseThreeTierCitation(json) : parseThreeTierDelegation(json)) as Parsed
      lawCache.set(cacheKey, threeTierData, 60 * 60 * 1000)
    }

    const { meta } = threeTierData
    const all = threeTierData.articles
    const articles = want ? all.filter(a => { const k = joKey(a.joNum); return !!k && k[0] === want[0] && k[1] === want[1] }) : all

    let resultText = `법령명: ${meta.lawName}\n`
    if (meta.sihyungryungName) {
      resultText += `시행령: ${meta.sihyungryungName}\n`
    }
    if (meta.sihyungkyuchikName) {
      resultText += `시행규칙: ${meta.sihyungkyuchikName}\n`
    }
    resultText += `\n`

    if (want && articles.length === 0) {
      return { content: [{ type: "text", text: resultText + `${input.jo} 의 3단비교 항목이 없습니다 (이 조를 위임·인용하는 하위법령 조문 없음). 3단비교가 있는 조: ${all.map(a => a.joNum).join(", ") || "없음"}` }] }
    }
    if (articles.length === 0) {
      return {
        content: [{
          type: "text",
          text: resultText + "3단비교 데이터가 없습니다."
        }]
      }
    }

    // 조를 고르지 않으면 앞 5개 조만 펼친다(너무 길어질 수 있음). 나머지는 조 번호 목록으로 알리고 jo 로 골라 보게 한다
    const maxArticles = want ? articles.length : Math.min(articles.length, 5)

    for (let i = 0; i < maxArticles; i++) {
      const article = articles[i]

      resultText += `---\n`
      resultText += `${article.joNum}`
      if (article.title) resultText += ` ${article.title}`
      resultText += `\n---\n\n`

      if (threeTierData.kndType === "인용조문" && article.content) {
        const content = cleanHtml(article.content)
        resultText += content.length > 500
          ? `${content.slice(0, 500)}\n   (법률 본문 ${content.length.toLocaleString()}자 중 일부만 표시)\n\n`
          : `${content}\n\n`
      }

      if (article.delegations.length === 0) {
        if (threeTierData.kndType === "인용조문") continue
        resultText += `(위임 조문 없음)\n\n`
        continue
      }

      for (const delegation of article.delegations) {
        const typeLabel = delegation.type === "시행령" ? "[시행령]"
                        : delegation.type === "시행규칙" ? "[시행규칙]"
                        : "[행정규칙]"

        resultText += `${typeLabel} ${delegation.lawName}`
        if (delegation.joNum) resultText += ` ${delegation.joNum}`
        if (delegation.title) resultText += ` (${delegation.title})`
        resultText += `\n`

        if (delegation.content) {
          const cleanContent = cleanHtml(delegation.content)

          // 너무 길면 줄 경계에서 자르기 (위임 내용은 법적으로 중요하므로 500자)
          if (cleanContent.length > 500) {
            const lastNewline = cleanContent.lastIndexOf('\n', 500)
            const cutPos = lastNewline > 300 ? lastNewline : 500
            resultText += `${cleanContent.substring(0, cutPos)}\n   (위임 내용 ${cleanContent.length.toLocaleString()}자 중 일부만 표시)\n\n`
          } else if (cleanContent) {
            resultText += `${cleanContent}\n\n`
          }
        } else {
          resultText += `\n`
        }
      }
    }

    if (articles.length > maxArticles) {
      resultText += `\n... 외 ${articles.length - maxArticles}개 조문 (생략)\n`
      resultText += `전체 ${articles.length}개 조문 중 처음 ${maxArticles}개만 표시합니다. 나머지 조: ${articles.slice(maxArticles).map(a => a.joNum).join(", ")}\n`
      resultText += `특정 조는 jo 로 골라 보세요 (예: jo="${articles[maxArticles].joNum}").\n`
    }

    return { content: [{ type: "text", text: truncateResponse(resultText) }] }
  } catch (error) {
    return formatToolError(error, "get_three_tier")
  }
}
