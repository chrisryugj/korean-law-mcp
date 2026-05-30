import type { LawApiClient } from "../lib/api-client.js"
import { getPrecedentText } from "./precedents.js"
import type {
  PrecedentHit,
  PrecedentSearchValidationInput,
  StructuredPrecedentSearchResult,
} from "./precedent-search-core.js"

export const DEFAULT_PRECEDENT_DETAIL_LIMIT = 2
export const MAX_PRECEDENT_DETAIL_LIMIT = 5

export interface PrecedentEvidenceOptions {
  apiKey?: string
  detailLimit?: number
  full?: boolean
}

export interface PrecedentEvidenceItem {
  hit: PrecedentHit
  text: string
  isError: boolean
  detailError?: string
}

export interface PrecedentEvidenceResult {
  text: string
  isError: boolean
  items: PrecedentEvidenceItem[]
}

function normalizeRelevanceText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
}

function validationTerms(input: PrecedentSearchValidationInput): string[] {
  return Array.from(new Set([
    input.attempt.semanticAnchor,
    input.attempt.query,
  ].filter((term): term is string => typeof term === "string" && normalizeRelevanceText(term).length >= 2)))
}

function validationTermGroups(input: PrecedentSearchValidationInput): string[][] {
  return (input.attempt.validationTermGroups || [])
    .map(group => Array.from(new Set(group.filter(term => normalizeRelevanceText(term).length >= 2))))
    .filter(group => group.length > 0)
}

function containsAnyTerm(text: string, terms: string[]): boolean {
  const haystack = normalizeRelevanceText(text)
  return terms.some(term => haystack.includes(normalizeRelevanceText(term)))
}

function containsEveryTermGroup(text: string, groups: string[][]): boolean {
  return groups.every(group => containsAnyTerm(text, group))
}

function clampDetailLimit(limit?: number): number {
  const value = Math.trunc(limit ?? DEFAULT_PRECEDENT_DETAIL_LIMIT)
  if (!Number.isFinite(value) || value < 1) return DEFAULT_PRECEDENT_DETAIL_LIMIT
  return Math.min(value, MAX_PRECEDENT_DETAIL_LIMIT)
}

function renderHeader(count: number, full: boolean): string {
  return `자동 상세조회: search_precedents -> get_precedent_text (상위 ${count}건, full=${full ? "true" : "false"})`
}

async function fetchOnePrecedentDetail(
  apiClient: LawApiClient,
  hit: PrecedentHit,
  options: PrecedentEvidenceOptions
): Promise<PrecedentEvidenceItem> {
  try {
    const result = await getPrecedentText(apiClient, {
      id: hit.id,
      full: options.full ?? false,
      apiKey: options.apiKey,
    })
    const text = result.content?.map(item => item.text).join("\n") || ""
    if (result.isError) {
      return {
        hit,
        text,
        isError: true,
        detailError: text || "상세조회 결과가 비어 있습니다.",
      }
    }
    return {
      hit,
      text,
      isError: false,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      hit,
      text: "",
      isError: true,
      detailError: message,
    }
  }
}

function renderEvidenceItem(item: PrecedentEvidenceItem): string {
  const title = item.hit.title ? ` ${item.hit.title}` : ""
  if (item.isError) {
    return `[${item.hit.id}]${title}\n상세조회 실패: ${item.detailError || "원인을 확인할 수 없습니다."}`
  }
  return `[${item.hit.id}]${title}\n${item.text || "상세조회 결과가 비어 있습니다."}`
}

function validationSearchResult(input: PrecedentSearchValidationInput): StructuredPrecedentSearchResult {
  return {
    originalArgs: input.originalArgs,
    totalCount: input.hits.length,
    page: 1,
    hits: input.hits,
    attempts: [input.attempt],
    fallbackUsed: true,
    successfulAttempt: input.attempt,
  }
}

export async function validatePrecedentSearchResult(
  apiClient: LawApiClient,
  input: PrecedentSearchValidationInput,
  options: PrecedentEvidenceOptions = {}
): Promise<boolean> {
  const groups = validationTermGroups(input)
  const terms = validationTerms(input)
  if (groups.length === 0 && terms.length === 0) return true

  const listText = input.hits
    .map(hit => [hit.title, hit.caseNumber, hit.court, hit.date, hit.decisionType].filter(Boolean).join(" "))
    .join("\n")
  if (groups.length > 0 && containsEveryTermGroup(listText, groups)) return true
  if (groups.length > 0) {
    const evidence = await fetchPrecedentEvidence(
      apiClient,
      validationSearchResult(input),
      {
        apiKey: options.apiKey,
        detailLimit: 1,
        full: input.attempt.search === 2 || options.full === true,
      }
    )
    if (!evidence || evidence.isError) return false

    return evidence.items.some(item => !item.isError && containsEveryTermGroup(item.text, groups))
  }
  if (containsAnyTerm(listText, terms)) return true

  const evidence = await fetchPrecedentEvidence(
    apiClient,
    validationSearchResult(input),
    {
      apiKey: options.apiKey,
      detailLimit: 1,
      full: input.attempt.search === 2 || options.full === true,
    }
  )
  if (!evidence || evidence.isError) return false

  return evidence.items.some(item => !item.isError && containsAnyTerm(item.text, terms))
}

export async function fetchPrecedentEvidence(
  apiClient: LawApiClient,
  searchResult: StructuredPrecedentSearchResult,
  options: PrecedentEvidenceOptions = {}
): Promise<PrecedentEvidenceResult | null> {
  const hits = searchResult.hits
    .filter(hit => !!hit.id)
    .slice(0, clampDetailLimit(options.detailLimit))

  if (hits.length === 0) return null

  const items = await Promise.all(
    hits.map(hit => fetchOnePrecedentDetail(apiClient, hit, options))
  )
  const failures = items.filter(item => item.isError).length
  const blocks = [
    renderHeader(items.length, options.full ?? false),
    ...items.map(renderEvidenceItem),
  ]

  return {
    text: blocks.join("\n\n"),
    isError: failures === items.length,
    items,
  }
}
