/**
 * advanced_search Tool - 고급 검색 (기간, 부처, 복합 검색)
 */

import { z } from "zod"
import { DOMParser } from "@xmldom/xmldom"
import type { LawApiClient } from "../lib/api-client.js"
import { truncateResponse, optionalDateSchema } from "../lib/schemas.js"
import { formatToolError, noResultHint } from "../lib/errors.js"
import { rethrowIfFatal } from "../lib/fatal-errors.js"
import { maskSensitiveUrl } from "../lib/fetch-with-retry.js"

const TARGET_LABELS: Record<string, string> = { law: "법령", admin_rule: "행정규칙", ordinance: "자치법규" }

export const AdvancedSearchSchema = z.object({
  query: z.string().describe("검색 키워드"),
  searchType: z.enum(["law", "admin_rule", "ordinance", "all"]).optional().default("law").describe(
    "검색 대상: law (법령), admin_rule (행정규칙), ordinance (자치법규), all (전체)"
  ),
  // 검색 응답에는 제정일이 없다. 법령·자치법규는 공포일자(최신 공포본), 행정규칙은 발령일자로 거른다 (2026-09-23 리뷰 D3).
  fromDate: optionalDateSchema.describe("공포일(행정규칙은 발령일) 시작 (YYYYMMDD). 최신 공포본 기준이며 제정일이 아님"),
  toDate: optionalDateSchema.describe("공포일(행정규칙은 발령일) 종료 (YYYYMMDD). 최신 공포본 기준이며 제정일이 아님"),
  org: z.string().optional().describe("소관부처코드"),
  operator: z.enum(["AND", "OR"]).optional().default("AND").describe("키워드 결합 연산자"),
  display: z.number().optional().default(20).describe("최대 결과 개수"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
})

export type AdvancedSearchInput = z.infer<typeof AdvancedSearchSchema>

export async function advancedSearch(
  apiClient: LawApiClient,
  input: AdvancedSearchInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    // 키워드 분리 (공백 기준)
    const keywords = input.query.split(/\s+/).filter(k => k.length > 0)

    let results: Array<{ name: string, id: string, type: string, date: string }> = []

    // 검색 대상별로 실행 (병렬)
    const searchTargets = input.searchType === "all"
      ? ["law", "admin_rule", "ordinance"]
      : [input.searchType]

    // 대상별 실패를 모은다. 종전엔 429/401/403 외 오류(5xx·타임아웃·HTML·빈 본문)를 대상별 빈 배열로 삼켜
    // "고급 검색 결과 (0건)"을 성공으로 냈다. 업스트림 장애가 "해당 법령 없음"으로 읽혔다 (2026-09-23 리뷰 D3).
    const settled = await Promise.allSettled(
      searchTargets.map(target => searchByType(apiClient, target, keywords, input, input.apiKey))
    )
    const failures: Array<{ label: string, error: unknown }> = []
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") {
        results.push(...r.value)
        return
      }
      rethrowIfFatal(r.reason)
      failures.push({ label: TARGET_LABELS[searchTargets[i]] || searchTargets[i], error: r.reason })
    })
    if (failures.length === searchTargets.length) {
      return formatToolError(
        failures.length === 1
          ? failures[0].error
          : new Error(failures.map(f => `${f.label} 검색 실패: ${errorMessage(f.error)}`).join(" / ")),
        "advanced_search"
      )
    }
    const failureNote = failures.length > 0
      ? `⚠️ 아래 대상은 검색에 실패해 결과에 없습니다. 해당 자료가 없다는 뜻이 아닙니다.\n` +
        failures.map(f => `  - ${f.label}: ${errorMessage(f.error)}`).join("\n") + `\n`
      : ""
    const fetchedCount = results.length

    // AND/OR 연산 적용
    if (input.operator === "AND" && keywords.length > 1) {
      results = filterByAnd(results, keywords)
    }

    // 기간 필터링
    if (input.fromDate || input.toDate) {
      results = filterByDate(results, input.fromDate, input.toDate)
    }

    // 상위 N개만
    results = results.slice(0, input.display)

    // OR은 키워드별 개별 조회를 하지 않는다: 전체 검색어 1회 조회 결과다. 묵시적으로 OR인 척하지 않게 밝힌다.
    const orNote = input.operator === "OR" && keywords.length > 1
      ? `⚠️ OR 연산은 키워드별로 따로 조회하지 않습니다. 전체 검색어로 한 번 조회한 결과입니다. 키워드마다 따로 검색하세요.\n`
      : ""

    if (results.length === 0) {
      const hint = noResultHint(input.query, "고급 검색")
      const extra: string[] = []
      if (fetchedCount > 0) extra.push(`필터 적용 전 ${fetchedCount}건이 AND/기간 필터에서 모두 제외됐습니다.`)
      if (orNote) extra.push(orNote.trimEnd())
      if (failureNote) extra.push(failureNote.trimEnd())
      if (extra.length > 0) hint.content[0].text += `\n\n${extra.join("\n")}`
      return hint
    }

    // 결과 포맷
    let resultText = `고급 검색 결과 (${results.length}건)\n\n`
    resultText += `검색어: ${input.query}\n`
    resultText += `연산자: ${input.operator}\n`
    if (input.fromDate || input.toDate) {
      resultText += `기간(공포·발령일 기준): ${input.fromDate || "시작"} ~ ${input.toDate || "종료"}\n`
    }
    resultText += orNote
    resultText += failureNote
    resultText += `\n`

    results.forEach((result, idx) => {
      resultText += `${idx + 1}. ${result.name}\n`
      resultText += `   - ID: ${result.id}\n`
      resultText += `   - 유형: ${result.type}\n`
      resultText += `   - 날짜: ${result.date}\n\n`
    })

    return {
      content: [{
        type: "text",
        text: truncateResponse(resultText)
      }]
    }
  } catch (error) {
    return formatToolError(error, "advanced_search")
  }
}

/**
 * 검색 대상별 검색 실행
 */
async function searchByType(
  apiClient: LawApiClient,
  type: string,
  keywords: string[],
  input: AdvancedSearchInput,
  apiKey?: string
): Promise<Array<{ name: string, id: string, type: string, date: string }>> {
  const query = keywords.join(" ")
  const results: Array<{ name: string, id: string, type: string, date: string }> = []

  // 오류는 삼키지 않고 호출부로 올린다. 대상별 성패는 advancedSearch가 allSettled로 가른다 (리뷰 D3).
  let xmlText = ""

  if (type === "law") {
    xmlText = await apiClient.searchLaw(query, apiKey)
  } else if (type === "admin_rule") {
    xmlText = await apiClient.searchAdminRule({ query, apiKey })
  } else if (type === "ordinance") {
    xmlText = await apiClient.searchOrdinance({ query, display: 100, apiKey })
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, "text/xml")

  // 검색 대상별 XML 태그명 매핑. 자치법규 검색 항목도 <OrdinSearch> 아래 <law>로 온다(ordinance-search.ts와 같은
  // 실측 형상). <ordin>을 찾던 종전 코드는 자치법규 대상을 매번 조용히 0건으로 만들었다 (2026-09-23 리뷰 D3).
  const tagMap: Record<string, string> = { law: "law", admin_rule: "admrul", ordinance: "law" }
  const tagName = tagMap[type] || "law"
  const items = doc.getElementsByTagName(tagName)

  for (let i = 0; i < items.length; i++) {
    const item = items[i]

    // 검색 대상별 필드명 매핑
    const name = item.getElementsByTagName("법령명한글")[0]?.textContent ||
      item.getElementsByTagName("행정규칙명")[0]?.textContent ||
      item.getElementsByTagName("자치법규명")[0]?.textContent ||
      "알 수 없음"

    // 자치법규는 get_ordinance 가 받는 자치법규일련번호를 싣는다. 자치법규ID 를 넘기면 "일치하는
    // 자치법규가 없습니다"로 없는 것처럼 답한다(2026-09-23 독립 리뷰, 실측 2184570 대 1378089).
    const id = item.getElementsByTagName("법령ID")[0]?.textContent ||
      item.getElementsByTagName("행정규칙일련번호")[0]?.textContent ||
      item.getElementsByTagName("자치법규일련번호")[0]?.textContent ||
      item.getElementsByTagName("자치법규ID")[0]?.textContent ||
      ""

    // 행정규칙 검색은 공포일자 대신 발령일자를 준다. 시행일자보다 먼저 봐야 기간 필터가 같은 축(공포·발령)에 선다.
    const date = item.getElementsByTagName("공포일자")[0]?.textContent ||
      item.getElementsByTagName("발령일자")[0]?.textContent ||
      item.getElementsByTagName("시행일자")[0]?.textContent ||
      item.getElementsByTagName("제정일자")[0]?.textContent ||
      ""

    results.push({ name, id, type, date })
  }

  return results
}

function errorMessage(error: unknown): string {
  return maskSensitiveUrl(error instanceof Error ? error.message : String(error))
}

/**
 * AND 연산 필터링 (모든 키워드 포함 여부)
 */
function filterByAnd(
  results: Array<{ name: string, id: string, type: string, date: string }>,
  keywords: string[]
): Array<{ name: string, id: string, type: string, date: string }> {
  // 안전: includes() 사용 (regex가 아님) → injection 위험 없음
  return results.filter(result => {
    const name = (result.name || "").toLowerCase()
    return keywords.every(keyword => name.includes(keyword.toLowerCase()))
  })
}

/**
 * 날짜 필터링
 */
function filterByDate(
  results: Array<{ name: string, id: string, type: string, date: string }>,
  fromDate?: string,
  toDate?: string
): Array<{ name: string, id: string, type: string, date: string }> {
  return results.filter(result => {
    if (!result.date) return false

    const dateStr = result.date.replace(/-/g, "")

    if (fromDate && dateStr < fromDate) return false
    if (toDate && dateStr > toDate) return false

    return true
  })
}
