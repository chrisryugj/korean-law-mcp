/**
 * 신구조문대비표 — 현행 조문 원문 조회 (법제처 eflaw/law JSON → 조문 텍스트)
 *
 * get_law_text 의 표시용 출력(헤더 두 줄·안내문)이 아니라 조문 원문만 필요하다.
 * 조문내용(조 머리 + 항 없는 조의 본문) 뒤에 항·호·목 줄을 잇는다 — 대비표 파서가 읽는 모양.
 */
import type { LawApiClient } from "./api-client.js"
import { buildJO } from "./law-parser.js"
import { cleanHtml, extractHangContent, flattenContent } from "./article-parser.js"
import { findLaws } from "./law-search.js"
import { LawApiError, ErrorCodes } from "./errors.js"

export interface LawRef {
  lawName: string
  mst?: string
  lawId?: string
}

/** 법령명 → mst (정확히 같은 이름 우선). mst·lawId 가 있으면 조회하지 않는다 */
export async function resolveLaw(
  apiClient: LawApiClient,
  input: { lawName?: string; mst?: string; lawId?: string; apiKey?: string },
): Promise<LawRef> {
  if (input.mst || input.lawId) return { lawName: input.lawName ?? "", mst: input.mst, lawId: input.lawId }
  const name = input.lawName?.trim()
  if (!name) throw new LawApiError("lawName·mst·lawId 중 하나가 필요합니다.", ErrorCodes.INVALID_PARAM)
  const laws = await findLaws(apiClient, name, input.apiKey, 5)
  const strip = (s: string) => s.replace(/\s/g, "")
  const hit = laws.find(l => strip(l.lawName) === strip(name)) ?? laws[0]
  if (!hit) {
    throw new LawApiError(`법령을 찾지 못했습니다: ${name}`, ErrorCodes.NOT_FOUND, [
      "정확한 법령명(예: '건축법 시행령')으로 다시 호출하거나, 조례·행정규칙이면 amendments[].currentText 에 현행 원문을 넣으세요.",
    ])
  }
  return { lawName: hit.lawName, mst: hit.mst, lawId: hit.lawId }
}

interface RawArticle {
  조문여부?: string
  조문번호?: string | number
  조문가지번호?: string | number
  조문내용?: unknown
  항?: unknown
}

/** 현행 조문 텍스트. 그 조가 없으면 null(신설 조) */
export async function fetchCurrentArticle(
  apiClient: LawApiClient,
  law: LawRef,
  jo: string,
  apiKey?: string,
): Promise<string | null> {
  const code = buildJO(jo)
  const json = JSON.parse(await apiClient.getLawText({ mst: law.mst, lawId: law.lawId, jo: code, apiKey }))
  const raw = json?.법령?.조문?.조문단위
  const units: RawArticle[] = raw ? (Array.isArray(raw) ? raw : [raw]) : []
  // 업스트림이 JO 를 무시하고 다른 조(법령 전체)를 주는 일이 있다(law-text.ts) — 번호까지 맞는 조만 현행으로 쓴다
  const num = Number(code.slice(0, 4)), branch = Number(code.slice(4))
  const unit = units.find(u => u?.조문여부 === "조문" && Number(u.조문번호) === num && Number(u.조문가지번호 || 0) === branch)
  if (!unit) return null
  const head = flattenContent(unit.조문내용).trim()
  // "[제44조의2는 제43조로 이동]" 같은 자리표시 조문은 번호만 있고 본문이 없다 — 그 번호의 조는 없다
  if (/^제\d+조(?:의\d+)?$/.test(head) && !unit.항) return null
  const rest = unit.항 ? extractHangContent(unit.항) : ""
  return cleanHtml([head, rest].filter(Boolean).join("\n"))
}
