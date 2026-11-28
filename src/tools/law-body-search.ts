/**
 * 법령 본문 검색 두 가지
 * - search_law_text: 조문 본문에 낱말이 나오는 법령 목록 (lawSearch search=2). 법령명 검색(search_law)과 달리 이름에 없는 낱말로 찾는다
 * - search_articles_in_law: 한 법령 안에서 낱말이 나오는 조문 (제목·본문·항·호·목)
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"
import { cleanHtml } from "../lib/article-parser.js"
import { toArray } from "../lib/xml-parser.js"
import { findLaws, resolvedLawMatches } from "../lib/law-search.js"
import { formatHit, parseLawsXml } from "./search-hits.js"
import type { ToolResponse } from "../lib/types.js"

export const SearchLawTextSchema = z.object({
  query: z.string().describe("조문 본문에서 찾을 낱말 (예: '전동킥보드', '개인형 이동장치')"),
  display: z.number().min(1).max(100).optional().default(20).describe("결과 개수 (기본 20)"),
  page: z.number().min(1).optional().default(1).describe("페이지 (기본 1)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
})
export type SearchLawTextInput = z.infer<typeof SearchLawTextSchema>

export async function searchLawText(apiClient: LawApiClient, input: SearchLawTextInput): Promise<ToolResponse> {
  try {
    const xml = await apiClient.fetchApi({
      endpoint: "lawSearch.do", target: "law",
      extraParams: { query: input.query, search: "2", display: String(input.display ?? 20), page: String(input.page ?? 1) },
      apiKey: input.apiKey,
    })
    const total = Number(xml.match(/<totalCnt>(\d+)<\/totalCnt>/)?.[1] ?? 0)
    const hits = parseLawsXml(xml)
    if (!hits.length) {
      return { content: [{ type: "text", text: `[NOT_FOUND] 조문 본문에 '${input.query}' 가 나오는 현행 법령이 없습니다. 법령 이름으로 찾으려면 search_law, 자연어 질문이면 search_ai_law.` }] }
    }
    let out = `본문 검색 '${input.query}': ${total}건 (법령명 가나다순이라 관련도 순이 아니다. 페이지 ${input.page ?? 1})\n\n`
    hits.forEach((h, i) => { out += formatHit((Number(input.page ?? 1) - 1) * Number(input.display ?? 20) + i + 1, h) })
    out += `조문은 execute_tool(tool_name="search_articles_in_law", params={lawId, query}) 로 그 법령 안에서 찾는다.\n`
    return { content: [{ type: "text", text: truncateResponse(out) }] }
  } catch (error) {
    return formatToolError(error, "search_law_text")
  }
}

export const SearchArticlesInLawSchema = z.object({
  query: z.string().describe("찾을 낱말 (공백으로 나눈 낱말이 모두 들어간 조문)"),
  lawId: z.string().optional().describe("법령ID"),
  mst: z.string().optional().describe("법령일련번호"),
  lawName: z.string().optional().describe("법령명 (lawId·mst 대신)"),
  titleOnly: z.boolean().optional().default(false).describe("조문 제목에서만 찾기"),
  limit: z.number().min(1).max(100).optional().default(30).describe("최대 조문 수 (기본 30)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
}).refine(v => Boolean(v.lawId || v.mst || v.lawName), { message: "lawId·mst·lawName 중 하나가 필요합니다" })
export type SearchArticlesInLawInput = z.infer<typeof SearchArticlesInLawSchema>

/** 조문 단위 → [제목, 전문] */
function unitText(u: any): { title: string; body: string } {
  const parts = [String(u?.조문내용 ?? "")]
  for (const h of toArray<any>(u?.항)) {
    parts.push(String(h?.항내용 ?? ""))
    for (const ho of toArray<any>(h?.호)) {
      parts.push(String(ho?.호내용 ?? ""))
      for (const mok of toArray<any>(ho?.목)) parts.push(String(mok?.목내용 ?? ""))
    }
  }
  return { title: String(u?.조문제목 ?? ""), body: cleanHtml(parts.join("\n")) }
}

export async function searchArticlesInLaw(apiClient: LawApiClient, input: SearchArticlesInLawInput): Promise<ToolResponse> {
  try {
    let { lawId, mst } = input
    if (!lawId && !mst) {
      const hits = await findLaws(apiClient, input.lawName!, input.apiKey, 3)
      const hit = hits.find(h => resolvedLawMatches(input.lawName!, h.lawName)) ?? hits[0]
      if (!hit) return { content: [{ type: "text", text: `[NOT_FOUND] '${input.lawName}' 법령을 찾지 못했습니다.` }], isError: true }
      // 법령ID 로 받는다. MST 는 그 공포본의 시행예정 시점 본문이 올 수 있다
      lawId = hit.lawId
      mst = lawId ? undefined : hit.mst
    }
    const json = JSON.parse(await apiClient.getLawText({ ...(lawId ? { lawId } : { mst }), apiKey: input.apiKey }))
    const law = json?.법령
    const name = String(law?.기본정보?.법령명_한글 ?? input.lawName ?? "")
    const words = input.query.trim().split(/\s+/).filter(Boolean)
    const norm = (s: string) => s.replace(/\s+/g, "")
    const limit = input.limit ?? 30
    const found: string[] = []
    let total = 0
    for (const u of toArray<any>(law?.조문?.조문단위)) {
      if (u?.조문여부 !== "조문") continue
      const { title, body } = unitText(u)
      const hay = norm(input.titleOnly ? title : `${title}\n${body}`)
      if (!words.every(w => hay.includes(norm(w)))) continue
      total++
      if (found.length >= limit) continue
      const branch = parseInt(String(u.조문가지번호 ?? "0"), 10) || 0
      const label = `제${parseInt(String(u.조문번호), 10)}조${branch ? `의${branch}` : ""}${title ? `(${title})` : ""}`
      // 첫 낱말 둘레 발췌
      const flat = body.replace(/\s+/g, " ")
      const at = flat.indexOf(words[0])
      const snippet = at >= 0 ? `${at > 40 ? "…" : ""}${flat.slice(Math.max(0, at - 40), at + 80)}${at + 80 < flat.length ? "…" : ""}` : flat.slice(0, 120)
      found.push(`- ${label}\n  ${snippet}`)
    }
    if (!total) {
      return { content: [{ type: "text", text: `[NOT_FOUND] ${name} 조문에 '${input.query}' 가 없습니다${input.titleOnly ? " (제목만 찾음)" : ""}.` }] }
    }
    let out = `${name} 안에서 '${input.query}': 조문 ${total}개${total > found.length ? ` (앞 ${found.length}개)` : ""}\n\n${found.join("\n")}\n\n전문은 get_law_text(jo) 로 받는다.\n`
    return { content: [{ type: "text", text: truncateResponse(out) }] }
  } catch (error) {
    return formatToolError(error, "search_articles_in_law")
  }
}
