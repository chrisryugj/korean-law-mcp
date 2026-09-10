/**
 * search_law_bulk — 법규 등록부 감시용 대량 조회 (#157)
 *
 * ISO 준법 등록부(수백 건)의 개정 여부를 주간 확인하려면 search_law 를 건당 호출해야 했고,
 * 응답에서 실제로 쓰는 값은 법령ID·MST·시행일·시행예정 넷뿐인데 부분매칭 목록·안내문이
 * 함께 실려 왔다(실측: 98회 호출 / 회당 수천 자).
 *
 * 여기서는 쿼리 배열을 받아 건당 한 줄로 돌려주고, previous 맵({법령ID: 직전 MST})을 주면
 * MST 가 달라진 것만 돌려준다 — MST 는 개정마다 바뀌므로 그 자체가 변경 감지 키다.
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"
import { ExecutionLimitError } from "../lib/execution-limits.js"
import { throwIfRequestCancelled } from "../lib/session-state.js"
import { parseLawsXml, sortCurrentFirst, splitExactPartial, type LawHit } from "./search-hits.js"
import { fetchUpcomingLaws, type UpcomingLaw } from "../lib/upcoming-laws.js"

/**
 * 한 번에 받을 쿼리 수 상한.
 *
 * 요청 단위 업스트림 예산(MCP_MAX_UPSTREAM_REQUESTS, 기본 48)을 쿼리당 1~2회 소비한다
 * (includeUpcoming=true 면 eflaw 보조검색 1회 추가). 상한을 넘겨 받아 봐야 예산에서
 * 잘리므로, 잘릴 자리를 스키마에서 먼저 말한다. 등록부가 더 크면 나눠 호출한다.
 */
const MAX_QUERIES = 40

/** 업스트림 동시 호출 수 — 법제처 쪽 부담과 응답 시간의 절충 */
const CONCURRENCY = 5

export const SearchLawBulkSchema = z.object({
  queries: z.array(z.string().min(1).max(200)).min(1).max(MAX_QUERIES)
    .describe(`법령명 배열 (최대 ${MAX_QUERIES}건). 건당 법령ID·MST·시행일·시행예정만 컴팩트 반환`),
  previous: z.record(z.string(), z.string()).optional()
    .describe('[diff 모드] {법령ID: 직전 MST} 맵. 주면 MST가 달라진 법령만 반환하고 나머지는 건수만 보고 — 등록부 정기 감시용. 직전 호출 응답 말미의 스냅샷 JSON을 그대로 넣으면 된다'),
  includeUpcoming: z.boolean().optional().default(true)
    .describe("시행예정 개정(공포됐으나 미시행)을 함께 확인할지. false면 업스트림 호출이 절반으로 준다"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
})

export type SearchLawBulkInput = z.infer<typeof SearchLawBulkSchema>

interface BulkRow {
  query: string
  hit?: LawHit
  /** 정확매칭이 없어 부분매칭 첫 항목을 집은 경우 — 다른 법령일 수 있다 */
  looseMatch: boolean
  upcoming: UpcomingLaw[]
  error?: string
}

const fmtDate = (d: string) => (d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d || "?")

async function lookupOne(
  apiClient: LawApiClient,
  query: string,
  includeUpcoming: boolean,
  apiKey?: string,
): Promise<BulkRow> {
  const xml = await apiClient.searchLaw(query, apiKey, 50)
  const laws = parseLawsXml(xml)
  if (laws.length === 0) return { query, looseMatch: false, upcoming: [] }

  const { exact, partial } = splitExactPartial(sortCurrentFirst(laws), query)
  const hit = exact[0] || partial[0]
  if (!hit) return { query, looseMatch: false, upcoming: [] }

  // 같은 법령ID의 시행예정만 — 등록부 감시에서 알고 싶은 건 "이 법령이 곧 바뀌는가"다
  const upcoming = includeUpcoming
    ? (await fetchUpcomingLaws(apiClient, query, apiKey)).filter(u => u.lawId === hit.lawId)
    : []
  return { query, hit, looseMatch: exact.length === 0, upcoming }
}

function upcomingLine(u: UpcomingLaw): string {
  const eff = u.effDates.map(fmtDate).join(" · ")
  return `   🔜 ${u.revisionType || "개정"} 시행예정 ${eff} (MST ${u.mst}, ${fmtDate(u.promDate)} 공포)`
}

/** 다음 호출에 그대로 넣을 수 있는 {법령ID: MST} 스냅샷 */
function snapshot(rows: BulkRow[]): string {
  const map: Record<string, string> = {}
  for (const r of rows) if (r.hit?.lawId) map[r.hit.lawId] = r.hit.mst
  return JSON.stringify(map)
}

function renderFull(rows: BulkRow[]): string {
  let out = ""
  let n = 0
  for (const r of rows) {
    if (!r.hit) continue
    n++
    const status = r.hit.statusCode === "연혁" ? " ⚠️[연혁-과거버전]" : r.hit.statusCode === "현행" ? " [현행]" : ""
    const loose = r.looseMatch ? " ⚠️[부분매칭 — 다른 법령일 수 있음]" : ""
    out += `${n}. ${r.hit.name}${status}${loose}\n`
    out += `   ID ${r.hit.lawId} | MST ${r.hit.mst} | 시행 ${fmtDate(r.hit.effDate)}\n`
    for (const u of r.upcoming) out += upcomingLine(u) + "\n"
  }
  return out
}

function renderDiff(rows: BulkRow[], previous: Record<string, string>): string {
  const changed: string[] = []
  let same = 0
  for (const r of rows) {
    if (!r.hit) continue
    const prev = previous[r.hit.lawId]
    if (prev === r.hit.mst) {
      // MST 동일 = 본문 개정 없음. 다만 공포됐으나 미시행인 개정은 MST가 아직 안 바뀌므로
      // 여기서 침묵하면 등록부가 시행일을 놓친다.
      if (r.upcoming.length > 0) {
        changed.push(`🔜 ${r.hit.name} | ID ${r.hit.lawId} | 본문 동일(MST ${r.hit.mst}) — 시행예정 있음\n`
          + r.upcoming.map(upcomingLine).join("\n") + "\n")
      } else same++
      continue
    }
    if (prev === undefined) {
      changed.push(`＋ ${r.hit.name} | ID ${r.hit.lawId} | MST ${r.hit.mst} | 시행 ${fmtDate(r.hit.effDate)} — previous 에 없던 법령\n`)
      continue
    }
    changed.push(`△ ${r.hit.name} | ID ${r.hit.lawId} | MST ${prev} → ${r.hit.mst} | 시행 ${fmtDate(r.hit.effDate)}\n`
      + r.upcoming.map(upcomingLine).join("\n") + (r.upcoming.length > 0 ? "\n" : ""))
  }
  return (changed.length > 0 ? changed.join("") : "변경 없음 — MST가 달라진 법령이 없습니다.\n")
    + `\n(본문 동일 ${same}건은 생략)\n`
}

export async function searchLawBulk(
  apiClient: LawApiClient,
  input: SearchLawBulkInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const rows: BulkRow[] = []
    let budgetHit = false

    for (let i = 0; i < input.queries.length && !budgetHit; i += CONCURRENCY) {
      throwIfRequestCancelled()
      const chunk = input.queries.slice(i, i + CONCURRENCY)
      const settled = await Promise.allSettled(
        chunk.map(q => lookupOne(apiClient, q, input.includeUpcoming, input.apiKey))
      )
      for (let k = 0; k < settled.length; k++) {
        const r = settled[k]
        if (r.status === "fulfilled") { rows.push(r.value); continue }
        // 한 건의 실패로 나머지를 버리지 않는다 — 등록부 감시는 부분 결과가 무결과보다 낫다
        if (r.reason instanceof ExecutionLimitError) budgetHit = true
        rows.push({
          query: chunk[k], looseMatch: false, upcoming: [],
          error: r.reason instanceof Error ? r.reason.message : "조회 실패",
        })
      }
    }

    const done = rows.filter(r => r.hit).length
    const missed = rows.filter(r => !r.hit && !r.error)
    const failed = rows.filter(r => r.error)
    const notRun = input.queries.length - rows.length

    let text = input.previous
      ? `법령 변경 감지 (요청 ${input.queries.length}건 / 확인 ${done}건)\n\n`
      : `법령 대량 조회 (요청 ${input.queries.length}건 / 확인 ${done}건)\n\n`
    text += input.previous ? renderDiff(rows, input.previous) : renderFull(rows)

    if (missed.length > 0) {
      text += `\n⚠️ 검색 0건 ${missed.length}건: ${missed.map(r => `「${r.query}」`).join(", ")}\n`
      text += `   정식 법령명이 아니거나 폐지됐을 수 있습니다 — search_law 로 개별 확인하세요(폐지 감지가 붙습니다).\n`
    }
    if (failed.length > 0) {
      text += `\n⚠️ 조회 실패 ${failed.length}건: ${failed.map(r => `「${r.query}」(${r.error})`).join(", ")}\n`
    }
    if (notRun > 0) {
      text += `\n⚠️ 미실행 ${notRun}건 — 요청 단위 업스트림 예산 소진. 남은 쿼리로 다시 호출하거나 includeUpcoming=false 로 호출당 비용을 절반으로 줄이세요.\n`
      text += `   남은 쿼리: ${input.queries.slice(rows.length).map(q => `「${q}」`).join(", ")}\n`
    }
    if (done > 0) {
      text += `\n📌 다음 감시용 스냅샷 (previous 에 그대로 전달):\n${snapshot(rows)}\n`
    }

    return { content: [{ type: "text", text: truncateResponse(text) }] }
  } catch (error) {
    return formatToolError(error, "search_law_bulk")
  }
}
