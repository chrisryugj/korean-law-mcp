/**
 * compare_ordinance_with_law: 조례·규칙 조문과, 그 조문이 인용한 근거법 조문(오늘 시행본)을 나란히.
 * 근거법은 제1조(목적)가 「」로 인용한 법령이고, 조례 조문의 「법 제N조」·「영 제N조」·「같은 법 시행령 제N조」 인용을 그 법령 조로 푼다.
 * 내용이 맞는지(의무·재량, 대상·수치 범위)는 판정하지 않는다. 나란히 놓아 사람이 대조하게 한다.
 */
import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { cleanHtml } from "../lib/article-parser.js"
import { toArray, parseSearchXML, extractTag } from "../lib/xml-parser.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"
import { extractOrdinanceCites } from "../lib/ordinance-cite-check.js"
import { extractBasisLaws, fetchLawStatus, findPurposeArticle } from "./ordinance-radar.js"
import type { ToolResponse } from "../lib/types.js"

export const CompareOrdinanceWithLawSchema = z.object({
  query: z.string().optional().describe("조례명 (지자체명 포함, 예: '서울특별시 광진구 주차장 설치 및 관리 조례')"),
  ordinSeq: z.string().optional().describe("자치법규 일련번호"),
  jo: z.string().optional().describe("조례의 이 조만 (예: '제15조', '15'). 비우면 근거법 조를 인용한 조례 조 전부(앞 15개)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
}).refine(v => Boolean(v.query || v.ordinSeq), { message: "query 또는 ordinSeq 가 필요합니다" })
export type CompareOrdinanceWithLawInput = z.infer<typeof CompareOrdinanceWithLawSchema>

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"

function lawArticle(lawJson: any, jo: number, branch: number, hang?: number): string | undefined {
  const u = toArray<any>(lawJson?.법령?.조문?.조문단위).find(x => x?.조문여부 === "조문" && Number(x.조문번호) === jo && (Number(x.조문가지번호 || 0) || 0) === branch)
  if (!u) return undefined
  const hangs = toArray<any>(u.항)
  const pick = hang ? hangs.filter(h => String(h?.항번호 ?? "").trim().startsWith(CIRCLED[hang - 1])) : hangs
  const lines = [String(u.조문내용 ?? ""), ...(pick.length ? pick : hangs).flatMap(h => [String(h?.항내용 ?? ""), ...toArray<any>(h?.호).map(ho => String(ho?.호내용 ?? ""))])]
  return lines.map(l => cleanHtml(l).trim()).filter(Boolean).join("\n")
}

export async function compareOrdinanceWithLaw(apiClient: LawApiClient, input: CompareOrdinanceWithLawInput): Promise<ToolResponse> {
  try {
    let seq = input.ordinSeq
    if (!seq) {
      const xml = await apiClient.searchOrdinance({ query: input.query!.replace(/\s+/g, " ").trim(), display: 10, apiKey: input.apiKey })
      const rows = parseSearchXML(xml, "OrdinSearch", "law", c => ({ seq: extractTag(c, "자치법규일련번호"), name: extractTag(c, "자치법규명") })).items
      const k = (x: string) => x.replace(/\s+/g, "")
      seq = (rows.find(r => k(r.name) === k(input.query!)) ?? rows[0])?.seq
      if (!seq) return { content: [{ type: "text", text: `[NOT_FOUND] '${input.query}' 자치법규를 찾지 못했습니다.` }], isError: true }
    }
    const svc = JSON.parse(await apiClient.getOrdinance(seq, undefined, input.apiKey))?.LawService
    if (!svc) return { content: [{ type: "text", text: "[NOT_FOUND] 자치법규 본문을 받지 못했습니다." }], isError: true }
    const ordName = String(svc.자치법규기본정보?.자치법규명 ?? "")
    const articles = toArray<any>(svc.조문?.조) as Array<Record<string, unknown>>
    const parents = extractBasisLaws(findPurposeArticle(articles), ordName)
    const baseLaw = parents.find(n => /(법|법률)$/.test(n))
    const want = input.jo?.replace(/\s+/g, "").match(/^(?:제)?(\d+)(?:조)?(?:의(\d+))?$/)
    const wantLabel = want ? `제${Number(want[1])}조${want[2] ? `의${Number(want[2])}` : ""}` : undefined
    const cites = extractOrdinanceCites(articles, baseLaw, "").filter(c => parents.includes(c.lawName) && (!wantLabel || c.ordArticle === wantLabel))
    if (!cites.length) {
      return { content: [{ type: "text", text: `${ordName}: ${wantLabel ?? "조례 조문"}에서 근거법(${parents.join(", ") || "제1조에 없음"}) 조 인용을 찾지 못했습니다. 조례 본문은 get_ordinance 로 보세요.` }] }
    }
    // 근거법 전문은 법령마다 한 번
    const lawJson = new Map<string, any>()
    for (const name of [...new Set(cites.map(c => c.lawName))].slice(0, 4)) {
      const st = await fetchLawStatus(apiClient, name, input.apiKey)
      if (st?.lawId) lawJson.set(name, JSON.parse(await apiClient.getLawText({ lawId: st.lawId, apiKey: input.apiKey })))
    }
    const ordText = (label: string) => {
      const a = articles.find(x => cleanHtml(String(x.조내용 ?? "")).replace(/\s+/g, "").startsWith(label))
      return a ? cleanHtml(String(a.조내용 ?? "")).trim() : ""
    }
    const byArticle = new Map<string, typeof cites>()
    for (const c of cites) byArticle.set(c.ordArticle, [...(byArticle.get(c.ordArticle) ?? []), c])
    const out: string[] = [`${ordName}: 조례 조문과 근거법 조문(오늘 시행본) 대조. 내용이 맞는지는 판정하지 않았다. 의무·재량, 대상·수치 범위를 직접 견줄 것`]
    for (const [label, list] of [...byArticle].slice(0, 15)) {
      out.push("", `━ 조례 ${label}`, ordText(label))
      for (const c of list) {
        const t = lawJson.has(c.lawName) ? lawArticle(lawJson.get(c.lawName), c.jo, c.branch, c.hang) : undefined
        out.push("", `  ↔ ${c.lawName} 제${c.jo}조${c.branch ? `의${c.branch}` : ""}${c.hang ? `제${c.hang}항` : ""}`, t ? t.split("\n").map(l => `  ${l}`).join("\n") : "  (오늘 시행본에 없음: 삭제됐거나 조 번호가 바뀌었다)")
      }
    }
    if (byArticle.size > 15) out.push("", `… 외 ${byArticle.size - 15}개 조례 조. jo 로 골라 보세요.`)
    return { content: [{ type: "text", text: truncateResponse(out.join("\n")) }] }
  } catch (error) {
    return formatToolError(error, "compare_ordinance_with_law")
  }
}
