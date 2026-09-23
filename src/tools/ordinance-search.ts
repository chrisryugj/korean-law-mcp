/**
 * search_ordinance Tool - 자치법규 검색
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { normalizeLawSearchText, expandOrdinanceQuery } from "../lib/search-normalizer.js"
import { extractArticleNumber, stripArticleTail } from "../lib/query-extract.js"
import { filterByArticleRelevance } from "../lib/ordinance-relevance.js"

/** 질의에서 조문 표기를 걷어낸 나머지를 법령명으로 본다 ("도로교통법 제148조의2" → "도로교통법") */
function lawNameOf(query: string): string {
  return stripArticleTail(query)
}
import { parseSearchXML, extractTag } from "../lib/xml-parser.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"

export const SearchOrdinanceSchema = z.object({
  query: z.string().describe("검색할 자치법규명 (예: '서울', '환경')"),
  display: z.number().min(1).max(100).default(20).describe("페이지당 결과 개수 (기본값: 20, 최대: 100)"),
  verifyArticleRelevance: z.boolean().optional()
    .describe("질의에 조문 번호가 있을 때 상위 후보의 본문을 열어 그 조문을 인용하는지 확인 (기본 false — 건당 업스트림 1회·약 1초가 추가된다)"),
  relevanceLimit: z.number().min(1).max(30).optional()
    .describe("본문 확인 상한 (기본 10). 상한 밖은 버리지 않고 '미확인'으로 남는다"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
})

export type SearchOrdinanceInput = z.infer<typeof SearchOrdinanceSchema>

export async function searchOrdinance(
  apiClient: LawApiClient,
  input: SearchOrdinanceInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    // 2026-09-23 리뷰 C3: normalizeLawSearchText(LexDiff 이식본)의 `\s*[-]\s*`·`\s*\.\s*` 는 공백 덩어리에서
    // 제곱이다(10만 자 15.0초, fetch 전에 이벤트 루프 정지). 이식본은 두고 여기서 공백을 한 칸으로 접는다.
    // 접어도 결과가 같다(ordinance-search.test.ts 고정 시드 퍼즈). expandOrdinanceQuery 도 같은 정규화를 탄다.
    const collapsedQuery = input.query.replace(/\s+/g, " ")

    // 검색어 정규화 (약칭 해결, 오타 보정)
    const normalizedQuery = normalizeLawSearchText(collapsedQuery)

    // 1차 검색 시도
    let xmlText = await apiClient.searchOrdinance({
      query: normalizedQuery,
      display: input.display || 20,
      apiKey: input.apiKey
    })

    // parseSearchXML 사용 (rootTag: OrdinSearch, itemTag: law)
    let parsed = parseSearchXML(
      xmlText, "OrdinSearch", "law",
      (content) => ({
        자치법규일련번호: extractTag(content, "자치법규일련번호"),
        자치법규명: extractTag(content, "자치법규명"),
        지자체기관명: extractTag(content, "지자체기관명"),
        공포일자: extractTag(content, "공포일자"),
        시행일자: extractTag(content, "시행일자"),
        자치법규상세링크: extractTag(content, "자치법규상세링크"),
      })
    )
    let totalCount = parsed.totalCnt
    let usedQuery = normalizedQuery

    // 검색 결과 없으면 확장 쿼리로 자동 재시도
    if (totalCount === 0) {
      const { expanded } = expandOrdinanceQuery(collapsedQuery)

      for (const expandedQuery of expanded) {
        xmlText = await apiClient.searchOrdinance({
          query: expandedQuery,
          display: input.display || 20,
          apiKey: input.apiKey
        })

        parsed = parseSearchXML(
          xmlText, "OrdinSearch", "law",
          (content) => ({
            자치법규일련번호: extractTag(content, "자치법규일련번호"),
            자치법규명: extractTag(content, "자치법규명"),
            지자체기관명: extractTag(content, "지자체기관명"),
            공포일자: extractTag(content, "공포일자"),
            시행일자: extractTag(content, "시행일자"),
            자치법규상세링크: extractTag(content, "자치법규상세링크"),
          })
        )
        totalCount = parsed.totalCnt

        if (totalCount > 0) {
          usedQuery = expandedQuery
          break
        }
      }
    }

    const currentPage = parsed.page
    let ordinances = parsed.items

    if (totalCount === 0) {
      // 확장 검색도 실패한 경우, 시도한 쿼리들 안내
      const { expanded } = expandOrdinanceQuery(collapsedQuery)
      const triedQueries = [normalizedQuery, ...expanded].slice(0, 3).join("', '")
      const keywords = input.query.trim().split(/\s+/)
      const hint = [`[NOT_FOUND] '${input.query}' 자치법규 검색 결과가 없습니다.`, `시도한 검색어: '${triedQueries}'`, "", "⚠️ LLM은 조례 내용을 추측하지 마세요. 사용자에게 '검색 실패'를 보고하세요."]
      if (keywords.length >= 2) {
        hint.push("")
        hint.push("힌트: 법제처 API는 공백 구분 키워드를 AND 조건으로 처리합니다. 키워드가 많을수록 결과가 줄어듭니다.")
        hint.push(`재시도 제안: "${keywords[0]}" 또는 "${keywords.slice(0, 2).join(" ")}"`)
      }
      return {
        content: [{ type: "text", text: hint.join("\n") }],
        isError: true,
      }
    }

    // 조문 관련성 확인(옵트인) — 이름으로 못 좁히는 것을 본문으로 좁힌다 (#124).
    const queryArticle = extractArticleNumber(input.query)
    let relevance: Awaited<ReturnType<typeof filterByArticleRelevance<typeof ordinances[number]>>> | undefined
    if (input.verifyArticleRelevance && queryArticle) {
      relevance = await filterByArticleRelevance(
        apiClient, ordinances, o => o.자치법규일련번호,
        { lawName: lawNameOf(input.query), jo: queryArticle, apiKey: input.apiKey, limit: input.relevanceLimit }
      )
      // 확인된 것을 앞으로. 미확인은 버리지 않는다 — 확인 못 한 것은 무관이 아니다.
      ordinances = [...relevance.confirmed, ...relevance.unconfirmed]
    }

    let output = `자치법규 검색 결과 (총 ${totalCount}건, ${currentPage}페이지`
    if (usedQuery !== normalizedQuery) {
      output += `, 확장쿼리: "${usedQuery}"`
    }
    output += `):\n\n`

    for (const ordin of ordinances) {
      output += `[${ordin.자치법규일련번호}] ${ordin.자치법규명}\n`
      output += `  지자체: ${ordin.지자체기관명 || "N/A"}\n`
      output += `  공포일: ${ordin.공포일자 || "N/A"}\n`
      output += `  시행일: ${ordin.시행일자 || "N/A"}\n`
      if (ordin.자치법규상세링크) {
        output += `  링크: ${ordin.자치법규상세링크}\n`
      }
      output += `\n`
    }

    // 업스트림 자치법규 검색은 section=ordinNm — **자치법규명만** 훑는다. 조문 번호는
    // 어느 자치법규명에도 없으므로 사실상 무시되고, "도로교통법 제148조의2"에도 158건이
    // 그대로 돌아온다(2026-08-17 실측). 조번호가 사라진 뒤라 하류의 조문 경계 대조로도
    // 걸러낼 수 없으니, 결과를 그 조문 관련으로 읽지 않도록 여기서 밝힌다(#117).
    // 판정은 조문 추출기와 같은 기준을 쓴다. `제`를 요구하면 #103이 새로 지원한
    // "44조"·"3조의3" 표기에서만 경고가 사라져, 정작 조문을 물은 질의가 무경고로 나간다(#140).
    if (relevance) {
      output += `✅ 조문 관련성 확인: ${relevance.confirmed.length}건 (본문에서 ${queryArticle} 인용 확인, 상위 ${relevance.checked}건 조회)\n`
      if (relevance.unconfirmed.length > 0) {
        output += `⚠️ 나머지 ${relevance.unconfirmed.length}건은 미확인입니다${relevance.skipped > 0 ? ` (본문 미조회 ${relevance.skipped}건 포함)` : ""} — 무관하다는 뜻이 아니라 확인하지 않았다는 뜻입니다.\n`
      }
    } else if (queryArticle !== undefined) {
      output += `⚠️ 자치법규 검색은 자치법규명만 대조하므로 질의의 조문 번호는 반영되지 않았습니다. 위 결과가 해당 조문과 관련된다는 보장이 없습니다.\n`
      output += `💡 verifyArticleRelevance=true 로 상위 후보 본문을 열어 ${queryArticle} 인용 여부를 확인할 수 있습니다(건당 약 1초).\n`
    }

    // 다음 단계 힌트 — 자치법규 ID로 본문 조회 유도
    if (ordinances.length > 0 && ordinances[0].자치법규일련번호) {
      output += `💡 다음: get_ordinance(id="${ordinances[0].자치법규일련번호}") 로 본문 조회. 원하는 규정 없으면 상위 법령 검색도 고려 (예: 휴직·복무·징계 → 지방공무원법).\n`
    }

    return {
      content: [{
        type: "text",
        text: truncateResponse(output)
      }]
    }
  } catch (error) {
    return formatToolError(error, "search_ordinance")
  }
}

