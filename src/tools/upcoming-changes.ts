/**
 * get_upcoming_changes: 공포됐지만 아직 시행되지 않은 개정(시행예정)과, 그 시행일에 무엇이 바뀌는지.
 * 시행예정 목록(eflaw nw=2)에서 가장 이른 시행일(또는 고른 efYd)의 시행본을 오늘 시행본과 조·항·호 줄 단위로 맞댄다.
 * 개정 날짜 표시(<개정 …>)만 바뀐 줄은 바뀐 것으로 세지 않는다.
 */
import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { findLaws, resolvedLawMatches } from "../lib/law-search.js"
import { fetchUpcomingLaws } from "../lib/upcoming-laws.js"
import { sameLawName } from "../lib/law-lineage.js"
import { cleanHtml } from "../lib/article-parser.js"
import { toArray } from "../lib/xml-parser.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"
import type { ToolResponse } from "../lib/types.js"

export const GetUpcomingChangesSchema = z.object({
  lawName: z.string().optional().describe("법령명 (예: '도로교통법')"),
  lawId: z.string().optional().describe("법령ID"),
  efYd: z.string().optional().describe("볼 시행일 (YYYYMMDD). 비우면 가장 이른 시행예정일"),
  jo: z.string().optional().describe("이 조만 (예: '제2조')"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
}).refine(v => Boolean(v.lawName || v.lawId), { message: "lawName 또는 lawId 가 필요합니다" })
export type GetUpcomingChangesInput = z.infer<typeof GetUpcomingChangesSchema>

const fmt = (d: string) => (d.length === 8 ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}` : d)
const stripMarks = (t: string) => cleanHtml(t).replace(/<(?:개정|신설|전문개정|타법개정|본조신설)[^>]*>/g, "").replace(/\s+/g, " ").trim()

/** 법령 전문 JSON → 조 키("2"·"5의2") → { 머리, 줄들(조 본문·항·호·목) } */
function articleLines(lawJson: any): Map<string, { label: string; lines: string[] }> {
  const out = new Map<string, { label: string; lines: string[] }>()
  for (const u of toArray<any>(lawJson?.법령?.조문?.조문단위)) {
    if (u?.조문여부 !== "조문") continue
    const br = Number(u.조문가지번호 || 0) || 0
    const key = `${Number(u.조문번호)}${br ? `의${br}` : ""}`
    const lines = [stripMarks(String(u.조문내용 ?? ""))]
    for (const h of toArray<any>(u.항)) {
      lines.push(stripMarks(String(h?.항내용 ?? "")))
      for (const ho of toArray<any>(h?.호)) {
        lines.push(stripMarks(String(ho?.호내용 ?? "")))
        for (const mok of toArray<any>(ho?.목)) lines.push(stripMarks(String(mok?.목내용 ?? "")))
      }
    }
    out.set(key, { label: `제${Number(u.조문번호)}조${br ? `의${br}` : ""}${u.조문제목 ? `(${u.조문제목})` : ""}`, lines: lines.filter(Boolean) })
  }
  return out
}

export async function getUpcomingChanges(apiClient: LawApiClient, input: GetUpcomingChangesInput): Promise<ToolResponse> {
  try {
    let { lawId } = input
    let name = input.lawName ?? ""
    if (!lawId) {
      const hits = await findLaws(apiClient, name, input.apiKey, 3)
      const hit = hits.find(h => resolvedLawMatches(name, h.lawName)) ?? hits[0]
      if (!hit) return { content: [{ type: "text", text: `[NOT_FOUND] '${name}' 법령을 찾지 못했습니다.` }], isError: true }
      lawId = hit.lawId
      name = hit.lawName
    }
    const current = JSON.parse(await apiClient.getLawText({ lawId, apiKey: input.apiKey }))
    name = String(current?.법령?.기본정보?.법령명_한글 ?? name)
    const todayEf = String(current?.법령?.기본정보?.시행일자 ?? "")
    const upcoming = ((await fetchUpcomingLaws(apiClient, name, input.apiKey)) ?? []).filter(u => sameLawName(u.name, name))
    const dates = [...new Set(upcoming.flatMap(u => u.effDates.map(d => ({ d, u }))).filter(x => x.d > todayEf).map(x => x.d))].sort()
    if (!dates.length) {
      return { content: [{ type: "text", text: `${name}: 공포됐지만 아직 시행되지 않은 개정이 없습니다 (오늘 시행본 ${fmt(todayEf)}).` }] }
    }
    const target = input.efYd?.replace(/\D/g, "") || dates[0]
    const owner = upcoming.find(u => u.effDates.includes(target)) ?? upcoming[0]
    const out: string[] = [`${name} 시행예정 개정 (오늘 시행본 ${fmt(todayEf)})`]
    for (const u of upcoming) out.push(`- 시행 ${u.effDates.map(fmt).join(", ")} · ${u.revisionType || "개정"} (공포 ${fmt(u.promDate)}${u.promNo ? ` 제${u.promNo}호` : ""}, MST ${u.mst})`)
    const next = JSON.parse(await apiClient.getLawText({ mst: owner.mst, efYd: target, apiKey: input.apiKey }))
    const before = articleLines(current), after = articleLines(next)
    const want = input.jo?.replace(/\s+/g, "").match(/^(?:제)?(\d+)(?:조)?(?:의(\d+))?$/)
    const wantKey = want ? `${Number(want[1])}${want[2] ? `의${Number(want[2])}` : ""}` : undefined
    const keys = [...new Set([...before.keys(), ...after.keys()])].filter(k => !wantKey || k === wantKey)
      .sort((a, b) => parseFloat(a.replace("의", ".")) - parseFloat(b.replace("의", ".")))
    const changes: string[] = []
    for (const k of keys) {
      const a = before.get(k), b = after.get(k)
      if (a && b && a.lines.join("\n") === b.lines.join("\n")) continue
      if (!a) { changes.push(`\n${b!.label} 신설\n${b!.lines.map(l => `+ ${l}`).join("\n")}`); continue }
      if (!b) { changes.push(`\n${a.label} 삭제`); continue }
      const removed = a.lines.filter(l => !b.lines.includes(l)), added = b.lines.filter(l => !a.lines.includes(l))
      changes.push(`\n${b.label}\n${[...removed.map(l => `- ${l}`), ...added.map(l => `+ ${l}`)].join("\n")}`)
    }
    out.push("", `▶ ${fmt(target)} 시행본에서 바뀌는 조 ${changes.length}개${wantKey ? ` (제${wantKey.replace("의", "조의")}${wantKey.includes("의") ? "" : "조"}만)` : ""} (- 오늘 문구, + 그날 문구. 개정 날짜 표시만 바뀐 줄은 뺐다)`)
    out.push(...(changes.length ? changes.slice(0, 40) : ["바뀌는 조가 없습니다 (다른 조의 시행일만 그날일 수 있다)."]))
    if (changes.length > 40) out.push(`\n… 외 ${changes.length - 40}개 조. jo 로 골라 보세요.`)
    if (dates.length > 1) out.push("", `다른 시행예정일: ${dates.filter(d => d !== target).map(fmt).join(", ")} (efYd 로 고른다)`)
    return { content: [{ type: "text", text: truncateResponse(out.join("\n")) }] }
  } catch (error) {
    return formatToolError(error, "get_upcoming_changes")
  }
}
