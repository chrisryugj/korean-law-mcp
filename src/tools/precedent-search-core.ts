import type { LawApiClient } from "../lib/api-client.js"
import { parsePrecedentXML, type PrecedentItem } from "../lib/xml-parser.js"
import { buildCompactLegalQueries } from "./compact-query-planner.js"
import type { AiLawArticleSignal } from "./life-law.js"
import type { SearchPrecedentsInput } from "./precedents.js"

export type PrecedentSearchMode = 1 | 2

export interface PrecedentSearchAttempt {
  query?: string
  caseNumber?: string
  search?: PrecedentSearchMode
  fromDate?: string
  toDate?: string
  reason: string
  totalCount: number
  hitCount: number
  success: boolean
  outOfRequestedDateRange?: boolean
  semanticAnchor?: string
  validationTermGroups?: string[][]
  requiresResultValidation?: boolean
  validationFailed?: boolean
  error?: string
}

export interface PrecedentHit {
  id: string
  title: string
  caseNumber?: string
  court?: string
  date?: string
  decisionType?: string
  link?: string
  sourceQuery?: string
  semanticAnchor?: string
  searchMode: PrecedentSearchMode
  outOfRequestedDateRange?: boolean
}

export interface StructuredPrecedentSearchResult {
  originalArgs: SearchPrecedentsInput
  totalCount: number
  page: number
  hits: PrecedentHit[]
  attempts: PrecedentSearchAttempt[]
  fallbackUsed: boolean
  successfulAttempt?: PrecedentSearchAttempt
}

export interface PrecedentSearchContext {
  aiLawArticles?: AiLawArticleSignal[]
  route?: {
    params?: Record<string, unknown>
    pipeline?: Array<{ params?: Record<string, unknown> }>
  }
  documentHints?: string[]
  fallbackPolicy?: "full" | "body" | "none"
  maxFallbackAttempts?: number
  validateResult?: (input: PrecedentSearchValidationInput) => boolean | Promise<boolean>
}

export interface PrecedentSearchValidationInput {
  originalArgs: SearchPrecedentsInput
  attempt: PrecedentSearchAttempt
  hits: PrecedentHit[]
}

interface SearchOnceInput {
  query?: string
  caseNumber?: string
  search: PrecedentSearchMode
  reason: string
  semanticAnchor?: string
  validationTermGroups?: string[][]
  requiresResultValidation?: boolean
  relaxDateRange?: boolean
}

interface SearchOnceResult {
  attempt: PrecedentSearchAttempt
  page: number
  hits: PrecedentHit[]
  rawHits: PrecedentHit[]
}

function cleanDate(date?: string): string | undefined {
  const value = (date || "").replace(/[.\-\s]/g, "")
  return value || undefined
}

function isDateInRange(date: string | undefined, fromDate?: string, toDate?: string): boolean {
  const normalized = cleanDate(date)
  if (!normalized) return true
  if (fromDate && normalized < fromDate) return false
  if (toDate && normalized > toDate) return false
  return true
}

function hasDateRange(args: SearchPrecedentsInput): boolean {
  return !!(args.fromDate || args.toDate)
}

function resultTotalCount(args: SearchPrecedentsInput, attempt: PrecedentSearchAttempt, hits: PrecedentHit[]): number {
  return hasDateRange(args) ? hits.length : attempt.totalCount
}

function toHit(
  item: PrecedentItem,
  sourceQuery: string | undefined,
  searchMode: PrecedentSearchMode,
  semanticAnchor?: string
): PrecedentHit {
  return {
    id: item.판례일련번호,
    title: item.판례명,
    caseNumber: item.사건번호 || undefined,
    court: item.법원명 || undefined,
    date: cleanDate(item.선고일자) || item.선고일자 || undefined,
    decisionType: item.판결유형 || undefined,
    link: item.판례상세링크 || undefined,
    sourceQuery,
    semanticAnchor,
    searchMode,
  }
}

function attemptKey(input: SearchOnceInput): string {
  if (input.caseNumber) return `case:${input.caseNumber}`
  return `query:${input.search}:${input.query || ""}`
}

function markDateRelaxed(hits: PrecedentHit[], args: SearchPrecedentsInput): PrecedentHit[] {
  return hits.map(hit => ({
    ...hit,
    outOfRequestedDateRange: !isDateInRange(hit.date, args.fromDate, args.toDate),
  }))
}

async function runPrecedentSearchOnce(
  apiClient: LawApiClient,
  args: SearchPrecedentsInput,
  input: SearchOnceInput
): Promise<SearchOnceResult> {
  const extraParams: Record<string, string> = {
    display: String(args.display || 20),
    page: String(args.page || 1),
  }
  if (input.query) extraParams.query = input.query
  if (input.search === 2) extraParams.search = "2"
  if (input.caseNumber) extraParams.nb = input.caseNumber
  if (args.court) extraParams.curt = args.court
  if (args.sort) extraParams.sort = args.sort

  const xmlText = await apiClient.fetchApi({
    endpoint: "lawSearch.do",
    target: "prec",
    extraParams,
    apiKey: args.apiKey,
  })
  const parsed = parsePrecedentXML(xmlText)
  const rawHits = parsed.items.map(item => toHit(item, input.query, input.search, input.semanticAnchor))
  const hits = input.relaxDateRange || !hasDateRange(args)
    ? markDateRelaxed(rawHits, args)
    : rawHits.filter(hit => isDateInRange(hit.date, args.fromDate, args.toDate))

  const attempt: PrecedentSearchAttempt = {
    query: input.query,
    caseNumber: input.caseNumber,
    search: input.search,
    fromDate: args.fromDate,
    toDate: args.toDate,
    reason: input.reason,
    totalCount: parsed.totalCnt,
    hitCount: hits.length,
    success: hits.length > 0,
    outOfRequestedDateRange: input.relaxDateRange ? hits.some(hit => hit.outOfRequestedDateRange) : undefined,
    semanticAnchor: input.semanticAnchor,
    validationTermGroups: input.validationTermGroups,
    requiresResultValidation: input.requiresResultValidation,
  }

  return {
    attempt,
    page: parsed.page,
    hits,
    rawHits,
  }
}

function firstAttempt(args: SearchPrecedentsInput): SearchOnceInput {
  if (args.caseNumber) {
    return {
      caseNumber: args.caseNumber,
      search: (args.search || 1) as PrecedentSearchMode,
      reason: "case_number",
    }
  }

  return {
    query: args.query,
    search: (args.search || 1) as PrecedentSearchMode,
    reason: "original_query",
  }
}

function fallbackInputs(args: SearchPrecedentsInput, context: PrecedentSearchContext): SearchOnceInput[] {
  const originalQuery = args.query || args.caseNumber || ""
  const inputs: SearchOnceInput[] = []
  const fallbackPolicy = context.fallbackPolicy ?? "full"

  if (fallbackPolicy === "none") return inputs

  if (args.query && (args.search || 1) === 1) {
    inputs.push({
      query: args.query,
      search: 2,
      reason: "body_search",
    })
  }

  if (fallbackPolicy === "body") return inputs

  const candidates = buildCompactLegalQueries({
    originalQuery,
    includeOriginal: true,
    caseNumber: args.caseNumber,
    documentHints: context.documentHints,
    aiLawArticles: context.aiLawArticles,
    route: context.route,
    max: context.maxFallbackAttempts ?? 5,
  })

  for (const candidate of candidates) {
    const requiresResultValidation = candidate.requiresResultValidation ||
      candidate.source === "ai_law_article_title" ||
      candidate.source === "ai_law_law_article_title"
    if (candidate.source === "case_number") {
      inputs.push({
        caseNumber: candidate.query,
        search: candidate.search,
        reason: "case_number",
        semanticAnchor: candidate.semanticAnchor,
        validationTermGroups: candidate.validationTermGroups,
        requiresResultValidation,
      })
    } else {
      inputs.push({
        query: candidate.query,
        search: candidate.search,
        reason: candidate.source,
        semanticAnchor: candidate.semanticAnchor,
        validationTermGroups: candidate.validationTermGroups,
        requiresResultValidation,
      })
    }
  }

  return inputs
}

export async function searchPrecedentsStructured(
  apiClient: LawApiClient,
  args: SearchPrecedentsInput,
  context: PrecedentSearchContext = {}
): Promise<StructuredPrecedentSearchResult> {
  const attempts: PrecedentSearchAttempt[] = []
  const seen = new Set<string>()
  let page = args.page || 1
  const dateRelaxationCandidates: SearchOnceResult[] = []

  const run = async (input: SearchOnceInput): Promise<SearchOnceResult | null> => {
    const key = attemptKey(input)
    if (seen.has(key)) return null
    seen.add(key)

    const result = await runPrecedentSearchOnce(apiClient, args, input)
    attempts.push(result.attempt)
    page = result.page

    if (result.attempt.success && result.attempt.requiresResultValidation && context.validateResult) {
      try {
        const accepted = await context.validateResult({
          originalArgs: args,
          attempt: result.attempt,
          hits: result.hits,
        })
        if (!accepted) {
          result.attempt.success = false
          result.attempt.hitCount = 0
          result.attempt.validationFailed = true
          result.attempt.error = "validation_failed"
          result.hits = []
        }
      } catch (error) {
        result.attempt.success = false
        result.attempt.hitCount = 0
        result.attempt.validationFailed = true
        result.attempt.error = error instanceof Error ? error.message : String(error)
        result.hits = []
      }
    }

    if (
      hasDateRange(args) &&
      result.rawHits.length > 0 &&
      result.hits.length === 0 &&
      !result.attempt.validationFailed &&
      dateRelaxationCandidates.length === 0
    ) {
      dateRelaxationCandidates.push(result)
    }
    return result
  }

  const initial = await run(firstAttempt(args))
  if (initial?.attempt.success) {
    return {
      originalArgs: args,
      totalCount: resultTotalCount(args, initial.attempt, initial.hits),
      page,
      hits: initial.hits,
      attempts,
      fallbackUsed: false,
      successfulAttempt: initial.attempt,
    }
  }

  for (const input of fallbackInputs(args, context)) {
    const result = await run(input)
    if (result?.attempt.success) {
      return {
        originalArgs: args,
        totalCount: resultTotalCount(args, result.attempt, result.hits),
        page,
        hits: result.hits,
        attempts,
        fallbackUsed: true,
        successfulAttempt: result.attempt,
      }
    }
  }

  const dateRelaxationCandidate = dateRelaxationCandidates[0]
  if (dateRelaxationCandidate) {
    const relaxedHits = markDateRelaxed(dateRelaxationCandidate.rawHits, args)
    const relaxedAttempt: PrecedentSearchAttempt = {
      ...dateRelaxationCandidate.attempt,
      reason: "date_relaxed",
      hitCount: relaxedHits.length,
      success: relaxedHits.length > 0,
      outOfRequestedDateRange: relaxedHits.some(hit => hit.outOfRequestedDateRange),
    }
    attempts.push(relaxedAttempt)
    return {
      originalArgs: args,
      totalCount: resultTotalCount(args, relaxedAttempt, relaxedHits),
      page,
      hits: relaxedHits,
      attempts,
      fallbackUsed: true,
      successfulAttempt: relaxedAttempt,
    }
  }

  return {
    originalArgs: args,
    totalCount: 0,
    page,
    hits: [],
    attempts,
    fallbackUsed: attempts.length > 1,
  }
}
