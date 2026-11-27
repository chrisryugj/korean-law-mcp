/**
 * 찾기 쉬운 생활법령정보(easylaw.go.kr, 법제처) 해설 검색.
 *
 * 법제처가 2026. 11. 23. 공개한 생활법령 MCP(https://open.easylaw.go.kr/mcp, 인증키 없음)의
 * search_life_law 를 호출한다. 원본 Open API(open.easylaw.go.kr:8181)는 기관별 인증키와 8181 포트가
 * 필요해 공개 MCP 를 거친다. 결과는 생활분야·관심규정해설·백문백답 등 쉬운 말 해설의 발췌와 원문 링크다.
 */
import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { fetchWithRetry } from "../lib/fetch-with-retry.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError, LawApiError, ErrorCodes } from "../lib/errors.js"
import { cleanHtml } from "../lib/article-parser.js"
import type { ToolResponse } from "../lib/types.js"

export const LIFE_LAW_MCP_URL = "https://open.easylaw.go.kr/mcp"

export const searchLifeLawSchema = z.object({
  question: z.string().min(1).describe("생활 속 법률 질문 원문 (예: '전세 보증금을 집주인이 안 돌려주면 어떻게 하나요?')"),
  keywords: z.array(z.string()).max(4).optional().describe(
    "선택. 자동 추출 대신 쓸 핵심 명사 2~4개. 본문 문자열 검색이라 결과가 없으면 같은 뜻의 다른 말(집주인→임대인, 월급→임금)로 바꿔 다시 찾는다"
  ),
  maxItems: z.number().min(1).max(10).default(3).describe("분류별 최대 건수 (1~10, 기본 3)"),
})

export type SearchLifeLawInput = z.infer<typeof searchLifeLawSchema>

/** 분류마다 필드 이름이 다르다(2026. 11. 28. 실응답): 관심규정해설 ov·tree, 백문백답 onhunqueCts(질문)·onhunansCts(답),
 *  대법원판례 judItm(판시사항)·precGst(판결요지), 헌법재판소결정례 dtmItm·detcGst, 백문백답 법령명 onhunqueConLsiNm, 카드뉴스 kwrdNm·easycsmlsNm */
type LifeLawItem = Record<string, unknown>
interface LifeLawSection { section?: string; count?: number; items?: LifeLawItem[] }
export interface LifeLawResult {
  query_used?: string
  broadened?: boolean
  note?: string
  sections?: LifeLawSection[]
}

/** SSE(text/event-stream) 또는 JSON 응답에서 JSON-RPC 결과를 꺼낸다 */
export function parseLifeLawResponse(body: string): LifeLawResult {
  const dataLines = body.split(/\r?\n/).filter(l => l.startsWith("data:")).map(l => l.slice(5).trim())
  const raw = dataLines.length ? dataLines[dataLines.length - 1] : body.trim()
  const rpc = JSON.parse(raw) as { result?: { structuredContent?: unknown; content?: Array<{ text?: string }>; isError?: boolean }; error?: { message?: string } }
  if (rpc.error) throw new LawApiError(`생활법령 MCP 오류: ${rpc.error.message ?? "알 수 없음"}`, ErrorCodes.API_ERROR)
  const result = rpc.result
  if (!result) throw new LawApiError("생활법령 MCP 응답에 결과가 없습니다", ErrorCodes.API_ERROR)
  const text = result.content?.[0]?.text ?? ""
  if (result.isError) throw new LawApiError(`생활법령 MCP 오류: ${text.slice(0, 200)}`, ErrorCodes.API_ERROR)
  const structured = result.structuredContent as LifeLawResult | undefined
  return structured && typeof structured === "object" ? structured : JSON.parse(text) as LifeLawResult
}

const QUESTION_FIELDS = ["onhunqueCts", "judItm", "dtmItm", "kwrdNm"]
const BODY_FIELDS = ["ov", "onhunansCts", "precGst", "detcGst"]
const str = (v: unknown): string => (typeof v === "string" ? v : "")
const firstField = (it: LifeLawItem, keys: string[]): string => keys.map(k => str(it[k])).find(Boolean) ?? ""

/** 발췌 정리: 태그·엔티티를 풀고 공백을 하나로. 업스트림 검색어 강조가 남긴 "보증금 을" 같은 조사 앞 공백은 원문 그대로 둔다 */
function excerpt(ov: string, max = 600): string {
  const text = cleanHtml(ov).replace(/\s+/g, " ").trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export function renderLifeLawResult(args: SearchLifeLawInput, r: LifeLawResult): ToolResponse {
  const sections = (r.sections ?? []).filter(s => (s.items ?? []).length > 0)
  if (sections.length === 0) {
    const lines = [
      `[NOT_FOUND] 생활법령 '${args.question}' 검색 결과가 없습니다.`,
      "",
      "⚠️ 이 도구는 실제 데이터를 찾지 못했습니다. 결과를 추측하거나 지어내지 마세요.",
      "힌트: 생활법령 검색은 키워드가 본문에 글자 그대로 있어야 찾는 문자열 검색입니다. keywords 에 같은 뜻의 다른 표현(갱신→적성검사, 집주인→임대인, 월급→임금)을 2~4개 넣어 다시 찾으세요.",
    ]
    if (r.query_used) lines.splice(1, 0, `실제 검색어: ${r.query_used}`)
    return { content: [{ type: "text", text: lines.join("\n") }], isError: true }
  }
  const out: string[] = [`찾기 쉬운 생활법령정보(법제처) 검색 결과${r.query_used ? ` · 실제 검색어: ${r.query_used}` : ""}`]
  if (r.broadened || r.note) out.push(`※ ${r.note ?? "질문 전체로는 결과가 없어 검색어를 줄이거나 넓혀 조회했습니다. 결과가 질문과 맞는지 확인하세요."}`)
  for (const s of sections) {
    out.push("", `## ${s.section ?? "기타"} (${s.count ?? s.items!.length}건 중 ${s.items!.length}건)`)
    s.items!.forEach((it, i) => {
      const path = str(it.tree).split(">").map(p => p.trim()).filter(Boolean).join(" > ")
      out.push(`${i + 1}. ${str(it.title) || str(it.easycsmlsNm) || "(제목 없음)"}${path ? ` [${path}]` : ""}`)
      const question = excerpt(firstField(it, QUESTION_FIELDS), 300)
      if (question) out.push(`   질문·쟁점: ${question}`)
      const body = excerpt(firstField(it, BODY_FIELDS))
      if (body) out.push(`   발췌: ${body}`)
      if (str(it.onhunqueConLsiNm)) out.push(`   관련 법령: ${str(it.onhunqueConLsiNm).split(",").join(", ")}`)
      if (str(it.link)) out.push(`   원문: ${str(it.link)}`)
    })
  }
  out.push("", "발췌문은 생활법령정보의 해설입니다. 답에 쓸 때는 원문 링크를 출처로 밝히고, 인용된 조문은 현행 법령 본문으로 확인하세요.")
  return { content: [{ type: "text", text: truncateResponse(out.join("\n")) }] }
}

export async function searchLifeLaw(_apiClient: LawApiClient, args: SearchLifeLawInput): Promise<ToolResponse> {
  try {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "search_life_law",
        arguments: { question: args.question, max_items: args.maxItems ?? 3, ...(args.keywords?.length ? { keywords: args.keywords } : {}) },
      },
    })
    const res = await fetchWithRetry(LIFE_LAW_MCP_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body,
      retries: 1,
    })
    if (!res.ok) throw new LawApiError(`생활법령 MCP HTTP ${res.status}`, ErrorCodes.API_ERROR, ["잠시 뒤 다시 시도하세요"])
    return renderLifeLawResult(args, parseLifeLawResponse(await res.text()))
  } catch (error) {
    return formatToolError(error, "search_life_law")
  }
}
