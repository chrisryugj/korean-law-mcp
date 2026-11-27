/**
 * 법령 기본정보 카드: 조문 본문 없이 소관부처·업무별 담당부서와 전화번호, 공포·시행, 조문별 시행일,
 * 이번 공포본의 제개정이유, 시행예정 개정. 법령 본문 JSON(기본정보.연락부서·조문시행일자문자열·제개정이유)에
 * 다 들어 있는데 get_law_text 는 이름·공포일·시행일만 냈다(법제처 law-mcp get_law_info 대조, 2026-11-28).
 */
import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { findLaws, resolvedLawMatches } from "../lib/law-search.js"
import { fetchUpcomingLaws, buildUpcomingNotes, UPCOMING_CHECK_FAILED_NOTE } from "../lib/upcoming-laws.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"
import { cleanHtml } from "../lib/article-parser.js"
import type { ToolResponse } from "../lib/types.js"

export const getLawInfoSchema = z.object({
  lawName: z.string().optional().describe("법령명 (예: '근로기준법', 공식 약칭도 받음)"),
  mst: z.string().optional().describe("법령일련번호(MST)"),
  lawId: z.string().optional().describe("법령ID"),
  includeReason: z.boolean().default(true).describe("이번 공포본의 제개정이유 포함 (기본 true, 법령 전문을 한 번 받는다)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
}).refine(v => Boolean(v.lawName || v.mst || v.lawId), { message: "lawName·mst·lawId 중 하나가 필요합니다" })

export type GetLawInfoInput = z.infer<typeof getLawInfoSchema>

const fmt = (d: unknown) => {
  const s = String(d ?? "")
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : s
}
const asArray = <T>(x: T | T[] | undefined): T[] => (Array.isArray(x) ? x : x ? [x] : [])
const text = (x: unknown): string => (typeof x === "object" && x ? String((x as { content?: unknown }).content ?? "") : String(x ?? ""))

/** "20261208:제13조,제101조20270101:제44조의4" → [["2026-12-08", "제13조, 제101조"], …] (날짜 사이 구분자가 없다) */
export function parseArticleEffDates(s: string): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const re = /(\d{8}):/g
  const marks = [...s.matchAll(re)]
  marks.forEach((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].index! : s.length
    const arts = s.slice(m.index! + m[0].length, end).split(",").map(a => a.trim()).filter(Boolean)
    if (arts.length) out.push([fmt(m[1]), arts.join(", ")])
  })
  return out
}

/** 제개정이유내용(배열 중첩) → 줄 목록. 맨 끝 "<법제처 제공>" 꼬리는 뺀다(원문에 "<법체저 제공>" 오타로도 온다, 근로기준법 2026-04-07 공포본) */
export function flattenReason(raw: unknown): string[] {
  const lines: string[] = []
  const walk = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(walk)
    else if (typeof x === "string") { const t = cleanHtml(x).trimEnd(); if (t.trim() && !/^<법[제체][처저] 제공>$/.test(t.trim())) lines.push(t) }
  }
  walk(raw)
  return lines
}

export function renderLawInfo(law: Record<string, any>, upcomingNote: string, mstUsed: string): string {
  const info = law.기본정보 ?? {}
  const name = info.법령명_한글 ?? ""
  const out: string[] = [`법령 기본정보: ${name} (${text(info.법종구분)}, 법령ID ${info.법령ID ?? ""}${mstUsed ? `, MST ${mstUsed}` : ""})`]
  if (info.법령명약칭) out.push(`약칭: ${info.법령명약칭}`)
  out.push(`소관부처: ${text(info.소관부처)}${info.전화번호 ? ` · 대표 전화 ${info.전화번호}` : ""}`)
  out.push(`공포: ${fmt(info.공포일자)} 제${info.공포번호 ?? ""}호 (${info.제개정구분 ?? ""}) · 시행: ${fmt(info.시행일자)}`)
  const byArticle = parseArticleEffDates(String(info.조문시행일자문자열 ?? ""))
  if (byArticle.length) {
    out.push("", "조문별 시행일(이 공포본 안에서 시행일이 다른 조):")
    for (const [d, arts] of byArticle) out.push(`- ${d}: ${arts}`)
  }
  const depts = asArray(info.연락부서?.부서단위)
  if (depts.length) {
    out.push("", "담당부서(업무별):")
    for (const d of depts) out.push(`- ${d.부서명 ?? ""}${d.부서연락처 ? `: ${d.부서연락처}` : ""}`)
  }
  const reason = flattenReason(law.제개정이유?.제개정이유내용)
  if (reason.length) {
    out.push("", "제개정이유(이 공포본):", ...reason)
  }
  if (upcomingNote) out.push("", upcomingNote.trimEnd())
  return out.join("\n")
}

export async function getLawInfo(apiClient: LawApiClient, input: GetLawInfoInput): Promise<ToolResponse> {
  try {
    let { mst, lawId } = input
    if (!mst && !lawId) {
      const hits = await findLaws(apiClient, input.lawName!, input.apiKey, 3)
      const hit = hits.find(h => resolvedLawMatches(input.lawName!, h.lawName)) ?? hits[0]
      if (!hit) {
        return { content: [{ type: "text", text: `[NOT_FOUND] '${input.lawName}' 법령을 찾지 못했습니다. 정식 법령명이나 공식 약칭으로 다시 찾으세요.` }], isError: true }
      }
      // 법령ID 로 받는다: MST 로 받으면 그 공포본의 시행예정 시점 기본정보가 왔다(도로교통법 MST 291133 → 시행 2027-04-14)
      lawId = hit.lawId
      mst = hit.mst
    }
    const json = JSON.parse(await apiClient.getLawText({ ...(lawId ? { lawId } : { mst }), jo: input.includeReason === false ? "000100" : undefined, apiKey: input.apiKey }))
    const law = json?.법령
    if (!law?.기본정보) {
      return { content: [{ type: "text", text: `[NOT_FOUND] 법령 기본정보를 받지 못했습니다(${mst ? `mst=${mst}` : `lawId=${lawId}`}).` }], isError: true }
    }
    const name = String(law.기본정보.법령명_한글 ?? "")
    const id = String(law.기본정보.법령ID ?? "")
    const upcoming = name ? await fetchUpcomingLaws(apiClient, name, input.apiKey) : []
    const note = upcoming === null
      ? UPCOMING_CHECK_FAILED_NOTE
      : buildUpcomingNotes([{ name, lawId: id }], upcoming.filter(u => u.lawId === id))
    return { content: [{ type: "text", text: truncateResponse(renderLawInfo(law, note, mst ?? "")) }] }
  } catch (error) {
    return formatToolError(error, "get_law_info")
  }
}
