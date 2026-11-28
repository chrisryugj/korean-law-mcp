/**
 * get_delegated_ordinances: 법령이 조례로 정하도록 위임한 조문('…조례로 정한다')과, 그 법령에 연결된 조례 조문.
 * 위임 문구는 법령 전문에서 "조례로 정" 이 든 항·호를 뽑고(조 번호·문장), 연결 조례는 법령-자치법규 조문 연계(lnkLsOrdJo)를
 * 지자체(region)로 거른다.
 */
import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { findLaws, resolvedLawMatches } from "../lib/law-search.js"
import { cleanHtml } from "../lib/article-parser.js"
import { toArray } from "../lib/xml-parser.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"
import { rethrowIfFatal } from "../lib/fatal-errors.js"
import { formatItems, parseLinkageXML } from "./law-linkage.js"
import type { ToolResponse } from "../lib/types.js"

export const GetDelegatedOrdinancesSchema = z.object({
  lawName: z.string().optional().describe("법령명 (예: '주차장법')"),
  lawId: z.string().optional().describe("법령ID"),
  jo: z.string().optional().describe("이 조만 (예: '제12조')"),
  region: z.string().optional().describe("연결 조례를 이 지자체로 거름 (예: '광진구', '서울특별시')"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
}).refine(v => Boolean(v.lawName || v.lawId), { message: "lawName 또는 lawId 가 필요합니다" })
export type GetDelegatedOrdinancesInput = z.infer<typeof GetDelegatedOrdinancesSchema>

const DELEGATION_RE = /조례로\s*(?:정|定)/

export async function getDelegatedOrdinances(apiClient: LawApiClient, input: GetDelegatedOrdinancesInput): Promise<ToolResponse> {
  try {
    let lawId = input.lawId
    let name = input.lawName ?? ""
    if (!lawId) {
      const hits = await findLaws(apiClient, name, input.apiKey, 3)
      const hit = hits.find(h => resolvedLawMatches(name, h.lawName)) ?? hits[0]
      if (!hit) return { content: [{ type: "text", text: `[NOT_FOUND] '${name}' 법령을 찾지 못했습니다.` }], isError: true }
      lawId = hit.lawId
      name = hit.lawName
    }
    const json = JSON.parse(await apiClient.getLawText({ lawId, apiKey: input.apiKey }))
    name = String(json?.법령?.기본정보?.법령명_한글 ?? name)
    const want = input.jo?.replace(/\s+/g, "").match(/^(?:제)?(\d+)(?:조)?(?:의(\d+))?$/)
    const delegations: string[] = []
    for (const u of toArray<any>(json?.법령?.조문?.조문단위)) {
      if (u?.조문여부 !== "조문") continue
      const no = Number(u.조문번호), br = Number(u.조문가지번호 || 0) || 0
      if (want && (no !== Number(want[1]) || br !== (want[2] ? Number(want[2]) : 0))) continue
      const parts = [String(u.조문내용 ?? ""), ...toArray<any>(u.항).flatMap(h => [String(h?.항내용 ?? ""), ...toArray<any>(h?.호).map(ho => String(ho?.호내용 ?? ""))])]
      const hits = parts.map(p => cleanHtml(p).replace(/\s+/g, " ").trim()).filter(p => DELEGATION_RE.test(p))
      if (!hits.length) continue
      delegations.push(`- 제${no}조${br ? `의${br}` : ""}${u.조문제목 ? `(${u.조문제목})` : ""}\n${hits.map(h => `  ${h.length > 300 ? `${h.slice(0, 300)}…` : h}`).join("\n")}`)
    }
    const out: string[] = [`${name}: 조례로 정하도록 위임한 조 ${delegations.length}개${want ? ` (${input.jo})` : ""}`, ...delegations]
    if (!delegations.length) out.push("본문에 '조례로 정한다' 위임 문구가 없습니다.")

    // 연결 조례 조문 (법령-자치법규 조문 연계)
    try {
      const xml = await apiClient.fetchApi({ endpoint: "lawSearch.do", target: "lnkLsOrdJo", extraParams: { query: name, display: "100", page: "1" }, apiKey: input.apiKey })
      let rows = parseLinkageXML(xml, "lnkOrdJoSearch", "law").items
      const total = rows.length
      const key = (s: string) => s.replace(/\s+/g, "")
      if (input.region) rows = rows.filter(r => Object.values(r).some(v => key(v).includes(key(input.region!))))
      if (want) rows = rows.filter(r => Object.values(r).some(v => new RegExp(`제\\s*${Number(want[1])}\\s*조${want[2] ? `의\\s*${Number(want[2])}` : "(?!의)"}`).test(v)))
      out.push("", `▶ 연결된 조례 조문 ${rows.length}건${input.region ? ` (${input.region})` : ""}${total >= 100 ? " · 연계 목록 첫 100건 안에서" : ""}`)
      out.push(rows.length ? formatItems(rows.slice(0, 50)) : "연결된 조례 조문을 찾지 못했습니다 (연계 정보가 없는 지자체일 수 있다).")
    } catch (error) {
      rethrowIfFatal(error)
      out.push("", "▶ 연결된 조례 조문: 연계 조회 실패 (잠시 뒤 다시)")
    }
    return { content: [{ type: "text", text: truncateResponse(out.join("\n")) }] }
  } catch (error) {
    return formatToolError(error, "get_delegated_ordinances")
  }
}
