/**
 * explain_legal_term: 일상어와 법령용어를 서로 바꾸고 뜻과 쓰인 조문을 한 번에. 용어 도구 넷(일상→법령, 법령→일상, 용어 뜻,
 * 쓰인 조문)을 같이 불러 묶는다. 하나가 실패해도 나머지는 낸다.
 */
import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { searchLegalTerms } from "./legal-terms.js"
import { getDailyToLegal, getLegalToDaily, getTermArticles } from "./knowledge-base.js"
import { truncateResponse } from "../lib/schemas.js"
import { rethrowIfFatal } from "../lib/fatal-errors.js"
import type { ToolResponse } from "../lib/types.js"

export const ExplainLegalTermSchema = z.object({
  term: z.string().describe("일상어나 법령용어 (예: '월세', '차임', '선의')"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
})
export type ExplainLegalTermInput = z.infer<typeof ExplainLegalTermSchema>

export async function explainLegalTerm(apiClient: LawApiClient, input: ExplainLegalTermInput): Promise<ToolResponse> {
  const term = input.term.trim()
  type Loose = { content: Array<{ type: string; text: string }>; isError?: boolean }
  const run = async (label: string, f: () => Promise<Loose>): Promise<string> => {
    try {
      const r = await f()
      const t = r.content.map(c => c.text).join("\n").trim()
      return r.isError || !t ? "" : `▶ ${label}\n${t}`
    } catch (error) {
      rethrowIfFatal(error)
      return ""
    }
  }
  const parts = await Promise.all([
    run("일상어 → 법령용어", () => getDailyToLegal(apiClient, { dailyTerm: term, apiKey: input.apiKey })),
    run("법령용어 → 일상어", () => getLegalToDaily(apiClient, { legalTerm: term, apiKey: input.apiKey })),
    run("법령용어 뜻", () => searchLegalTerms(apiClient, { query: term, display: 5, page: 1, apiKey: input.apiKey })),
    run("이 용어가 쓰인 조문", () => getTermArticles(apiClient, { term, display: 10, apiKey: input.apiKey })),
  ])
  const found = parts.filter(Boolean)
  if (!found.length) return { content: [{ type: "text", text: `[NOT_FOUND] '${term}' 를 용어사전·일상용어 사전에서 찾지 못했습니다. 법령 본문에 쓰였는지는 search_law_text 로 보세요.` }] }
  return { content: [{ type: "text", text: truncateResponse(`'${term}' 용어 풀이\n\n${found.join("\n\n")}`) }] }
}
