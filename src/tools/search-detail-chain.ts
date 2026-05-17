import type { LawApiClient } from "../lib/api-client.js"
import { SEARCH_DETAIL_CHAINS } from "../lib/tool-chain-config.js"
import type { LooseToolResponse } from "../lib/types.js"
import { getPrecedentText } from "./precedents.js"
import { getInterpretationText } from "./interpretations.js"
import { getTaxTribunalDecisionText } from "./tax-tribunal-decisions.js"
import { getCustomsInterpretationText } from "./customs-interpretations.js"
import { getConstitutionalDecisionText } from "./constitutional-decisions.js"
import { getAdminAppealText } from "./admin-appeals.js"
import { getFtcDecisionText, getPipcDecisionText, getNlrcDecisionText } from "./committee-decisions.js"
import { getEnglishLawText } from "./english-law.js"
import { getAdminRule } from "./admin-rule.js"
import { getOrdinance } from "./ordinance.js"

export interface SearchDetailCallResult {
  text: string
  isError: boolean
}

export interface SearchDetailOptions {
  apiKey?: string
  limit?: number
}

type DetailHandler = (
  apiClient: LawApiClient,
  input: Record<string, unknown>
) => Promise<LooseToolResponse>

const DETAIL_HANDLERS: Record<string, DetailHandler> = {
  get_precedent_text: getPrecedentText as DetailHandler,
  get_interpretation_text: getInterpretationText as DetailHandler,
  get_tax_tribunal_decision_text: getTaxTribunalDecisionText as DetailHandler,
  get_customs_interpretation_text: getCustomsInterpretationText as DetailHandler,
  get_constitutional_decision_text: getConstitutionalDecisionText as DetailHandler,
  get_admin_appeal_text: getAdminAppealText as DetailHandler,
  get_ftc_decision_text: getFtcDecisionText as DetailHandler,
  get_pipc_decision_text: getPipcDecisionText as DetailHandler,
  get_nlrc_decision_text: getNlrcDecisionText as DetailHandler,
  get_english_law_text: getEnglishLawText as DetailHandler,
  get_admin_rule: getAdminRule as DetailHandler,
  get_ordinance: getOrdinance as DetailHandler,
}

const FULL_FALSE_DETAIL_TOOLS = new Set([
  "get_precedent_text",
  "get_constitutional_decision_text",
  "get_admin_appeal_text",
])

function defaultLimit(searchTool: string): number {
  return searchTool === "search_precedents" ? 2 : 1
}

function makeGlobalRegex(regex: RegExp): RegExp {
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`
  return new RegExp(regex.source, flags)
}

export function extractDetailIds(searchTool: string, output: string, limit?: number): string[] {
  const chain = SEARCH_DETAIL_CHAINS[searchTool]
  if (!chain || !output.trim()) return []

  const max = limit ?? defaultLimit(searchTool)
  const regex = makeGlobalRegex(chain.idRegex)
  const seen = new Set<string>()
  const ids: string[] = []

  let match: RegExpExecArray | null
  while ((match = regex.exec(output)) !== null) {
    const id = match[1]?.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
    if (ids.length >= max) break
  }

  return ids
}

async function callDetailTool(
  apiClient: LawApiClient,
  searchTool: string,
  id: string,
  options: SearchDetailOptions
): Promise<SearchDetailCallResult> {
  const chain = SEARCH_DETAIL_CHAINS[searchTool]
  const handler = chain ? DETAIL_HANDLERS[chain.detailTool] : undefined
  if (!chain || !handler) {
    return { text: `상세조회 도구를 찾을 수 없습니다: ${searchTool}`, isError: true }
  }

  const input: Record<string, unknown> = { [chain.detailParam]: id }
  if (options.apiKey) input.apiKey = options.apiKey
  if (FULL_FALSE_DETAIL_TOOLS.has(chain.detailTool)) input.full = false

  try {
    const result = await handler(apiClient, input)
    return {
      text: result.content?.map(item => item.text).join("\n") || "",
      isError: !!result.isError,
    }
  } catch (error) {
    return {
      text: `오류: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    }
  }
}

function header(searchTool: string, count: number): string {
  const chain = SEARCH_DETAIL_CHAINS[searchTool]
  const fullSuffix = searchTool === "search_precedents" ? ", full=false" : ""
  return `자동 상세조회: ${searchTool} -> ${chain.detailTool} (상위 ${count}건${fullSuffix})`
}

export async function fetchSearchDetailChain(
  apiClient: LawApiClient,
  searchTool: string,
  searchResult: SearchDetailCallResult,
  options: SearchDetailOptions = {}
): Promise<SearchDetailCallResult | null> {
  const chain = SEARCH_DETAIL_CHAINS[searchTool]
  if (!chain || searchResult.isError) return null

  const ids = extractDetailIds(searchTool, searchResult.text, options.limit)
  if (ids.length === 0) return null

  const blocks: string[] = [header(searchTool, ids.length)]
  let failures = 0

  for (const id of ids) {
    const detail = await callDetailTool(apiClient, searchTool, id, options)
    if (detail.isError) failures += 1
    blocks.push(`[${id}]\n${detail.text || "상세조회 결과가 비어 있습니다."}`)
  }

  return {
    text: blocks.join("\n\n"),
    isError: failures === ids.length,
  }
}

export async function fetchCombinedSearchDetailChain(
  apiClient: LawApiClient,
  searchTool: string,
  searchResults: SearchDetailCallResult[],
  options: SearchDetailOptions = {}
): Promise<SearchDetailCallResult | null> {
  const combined = searchResults
    .filter(result => !result.isError && result.text.trim())
    .map(result => result.text)
    .join("\n")

  if (!combined.trim()) return null

  return fetchSearchDetailChain(
    apiClient,
    searchTool,
    { text: combined, isError: false },
    options
  )
}
