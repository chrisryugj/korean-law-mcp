/**
 * get_penalties: 법령을 어기면 어떤 제재가 있는지. 벌칙 장 조문(벌칙·과태료·양벌규정), 의무 조문(duty)을 지목한 항·호,
 * 시행령 부과기준 별표(과태료·과징금)에서 그 의무 조문이 나오는 행 묶음을 한 번에 낸다.
 * 처분근거 체인은 별표 목록과 벌칙 장 전체만 실어 「임금명세서를 안 주면 과태료 얼마」에 금액 행이 없었다(법제처 law-mcp 대조, 2026-11-28).
 */
import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { findLaws, resolvedLawMatches, type LawInfo } from "../lib/law-search.js"
import { formatArticleUnit } from "../lib/article-parser.js"
import { parseArticleNo, filterPenaltyBody, dutyIndex, annexRowsFor } from "../lib/penalty-map.js"
import { pickPenaltyUnits } from "./scenarios/penalty.js"
import { getAnnexes } from "./annex.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"
import { rethrowIfFatal } from "../lib/fatal-errors.js"
import type { ToolResponse } from "../lib/types.js"

export const getPenaltiesSchema = z.object({
  lawName: z.string().optional().describe("법률명 (예: '근로기준법'). 시행령·시행규칙 이름을 주면 그 상위 법률로 본다"),
  mst: z.string().optional().describe("법률의 법령일련번호(MST)"),
  duty: z.string().optional().describe("어긴 의무 조문 번호 (예: '48', '제48조', '44의2'). 주면 그 조를 지목한 벌칙 항·호와 부과기준 별표의 해당 행만 낸다"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
}).refine(v => Boolean(v.lawName || v.mst), { message: "lawName 또는 mst 가 필요합니다" })

export type GetPenaltiesInput = z.infer<typeof getPenaltiesSchema>

const ANNEX_KEYWORDS = ["과태료", "과징금", "범칙금"]
const FEE_TITLE_RE = /과태료|과징금|범칙금|이행강제금/
/** 한 검색어에 별표가 여럿이면 목록이 온다: 별표번호로 하나씩 받는 상한 */
const MAX_ANNEX_PER_KEYWORD = 3
const parentName = (n: string) => n.replace(/\s*(시행령|시행규칙)$/, "").trim()

async function resolveLaw(apiClient: LawApiClient, input: GetPenaltiesInput): Promise<LawInfo | undefined> {
  if (input.mst) return { lawName: "", lawId: "", mst: input.mst, lawType: "" }
  // 이름으로 찾았으면 법령ID 로 본문을 받는다: MST 로 받으면 그 공포본의 시행예정 시점 본문이 왔다(도로교통법 MST 291133 → 시행 2027-04-14)
  const name = parentName(input.lawName!)
  const hits = await findLaws(apiClient, name, input.apiKey, 5)
  return hits.find(h => resolvedLawMatches(name, h.lawName) && !/시행령|시행규칙/.test(h.lawName)) ?? hits.find(h => !/시행령|시행규칙/.test(h.lawName))
}

/** 시행령 부과기준 별표: 없거나 실패하면 빈 목록(벌칙 조문 응답을 막지 않는다) */
async function feeAnnexes(apiClient: LawApiClient, lawName: string, apiKey?: string): Promise<Array<{ title: string; text: string }>> {
  const decree = `${lawName} 시행령`
  const fetchOne = async (args: { query?: string; bylSeq?: string }): Promise<string | undefined> => {
    try {
      const r = await getAnnexes(apiClient, { lawName: decree, ...args, apiKey })
      return r.isError ? undefined : r.content[0]?.text
    } catch (error) {
      rethrowIfFatal(error)
      return undefined
    }
  }
  const isBody = (t: string) => /<table|\n\|/.test(t)
  const results = (await Promise.all(ANNEX_KEYWORDS.map(async query => {
    const text = await fetchOne({ query })
    if (!text) return []
    if (isBody(text)) return [text]
    // 목록("1. [000600] 과태료의 부과기준(…) (별표)"): 별표(서식 아님)만 번호로 다시 받는다
    const seqs = [...text.matchAll(/^\d+\.\s*\[(\d{6})\][^\n]*\(별표\)\s*$/gm)].map(m => m[1]).slice(0, MAX_ANNEX_PER_KEYWORD)
    return (await Promise.all(seqs.map(bylSeq => fetchOne({ bylSeq })))).filter((t): t is string => !!t && isBody(t))
  }))).flat()
  const seen = new Set<string>()
  // 제목이 부과기준(과태료·과징금·범칙금·이행강제금)인 별표만: 검색어가 「업무정지 기준」·「상시 4명 이하 사업장」 별표에도 걸렸다
  return results.map(text => ({ title: text.split("\n")[0].trim(), text }))
    .filter(a => FEE_TITLE_RE.test(a.title) && !seen.has(a.title) && seen.add(a.title))
}

export async function getPenalties(apiClient: LawApiClient, input: GetPenaltiesInput): Promise<ToolResponse> {
  try {
    const duty = input.duty ? parseArticleNo(input.duty) : undefined
    if (input.duty && !duty) {
      return { content: [{ type: "text", text: `[INVALID_PARAMETER] duty='${input.duty}' 를 조 번호로 읽지 못했습니다 (예: '48', '제48조', '44의2').` }], isError: true }
    }
    const law = await resolveLaw(apiClient, input)
    if (!law) return { content: [{ type: "text", text: `[NOT_FOUND] '${input.lawName}' 법률을 찾지 못했습니다. 정식 법률명으로 다시 찾으세요.` }], isError: true }
    const json = JSON.parse(await apiClient.getLawText(law.lawId ? { lawId: law.lawId, apiKey: input.apiKey } : { mst: law.mst, apiKey: input.apiKey }))
    const info = json?.법령?.기본정보 ?? {}
    const lawName = String(info.법령명_한글 ?? law.lawName)
    const units = pickPenaltyUnits(json).map(u => formatArticleUnit(u)).filter((f): f is NonNullable<typeof f> => !!f)
    const out: string[] = [`벌칙·제재 조회: ${lawName} (MST ${law.mst}, 시행 ${info.시행일자 ?? ""})`]
    if (!units.length) {
      out.push("", "[NOT_FOUND] 벌칙 장이나 벌칙·과태료·양벌규정 제목의 조문을 찾지 못했습니다. 제재가 없다고 단정하지 말고 법령 본문을 확인하세요.")
      return { content: [{ type: "text", text: out.join("\n") }], isError: true }
    }
    const annexesP = feeAnnexes(apiClient, lawName, input.apiKey)

    if (duty) {
      out.push(`의무 조문: 제${duty.replace("의", "조의")}${duty.includes("의") ? "" : "조"}`, "", "▶ 그 조를 지목한 벌칙 항·호")
      let found = 0
      for (const u of units) {
        const picked = filterPenaltyBody(u.body, duty)
        if (!picked) continue
        found++
        out.push("", u.header, picked)
      }
      if (!found) out.push("", `벌칙 조문에서 제${duty}조를 지목한 항·호를 찾지 못했습니다. "위반" 이 아닌 표현이나 다른 법률로 정한 제재일 수 있으니 없다고 단정하지 마세요.`)
      const joint = units.filter(u => /양벌/.test(u.header)).map(u => u.header)
      if (joint.length) out.push("", `함께 적용될 수 있는 조: ${joint.join(", ")}`)
    } else {
      const index = new Map<string, string[]>()
      for (const u of units) {
        const label = u.header.match(/^제\d+조(?:의\d+)?/)?.[0] ?? ""
        for (const [k, v] of dutyIndex(label, u.body)) index.set(k, [...(index.get(k) ?? []), ...v])
      }
      const keys = [...index.keys()].sort((a, b) => parseFloat(a.replace("의", ".")) - parseFloat(b.replace("의", ".")))
      if (keys.length) {
        out.push("", "▶ 의무 조문 → 벌칙 위치 (\"…를 위반한\" 나열에서 뽑음)")
        for (const k of keys) out.push(`- 제${k.replace("의", "조의")}${k.includes("의") ? "" : "조"} → ${[...new Set(index.get(k))].join(", ")}`)
      }
      out.push("", "▶ 벌칙 조문", ...units.map(u => `${u.header}\n${u.body}`))
    }

    const annexes = await annexesP
    if (annexes.length) {
      out.push("", "▶ 부과기준 별표 (시행령)")
      let shown = 0
      for (const a of annexes) {
        if (!duty) { out.push(`- ${a.title}`); shown++; continue }
        const rows = annexRowsFor(a.text, duty)
        if (!rows) continue
        out.push("", a.title, rows)
        shown++
      }
      if (duty && !shown) out.push(`부과기준 별표 ${annexes.length}개(${annexes.map(a => a.title.split(" - ").pop()).join(", ")})의 표에서 제${duty}조가 나오는 행을 찾지 못했습니다. 별표 전문은 get_annexes 로 확인하세요.`)
      out.push("", "※ 별표 금액은 부과기준상 금액입니다. 별표 일반기준의 감경·가중(위반 횟수·사정)에 따라 달라질 수 있습니다.")
    } else {
      out.push("", "※ 시행령에서 과태료·과징금 부과기준 별표를 찾지 못했습니다. 시행규칙·다른 이름의 하위법령에 있을 수 있습니다.")
    }
    return { content: [{ type: "text", text: truncateResponse(out.join("\n")) }] }
  } catch (error) {
    return formatToolError(error, "get_penalties")
  }
}
