import type { AiLawArticleSignal } from "./life-law.js"

export type CompactQuerySource =
  | "ai_law_article_title"
  | "ai_law_law_article_title"
  | "search_retry_hint"
  | "router"

export type PrecedentSearchScope = 1 | 2

export type CompactQueryVariantKind =
  | "raw"
  | "terminal_function_word_removed"
  | "terminal_function_word_spaced"
  | "law_title"
  | "retry_hint"
  | "router"

export interface CompactQueryCandidate {
  query: string
  source: CompactQuerySource
  score: number
  reason: string
  search: PrecedentSearchScope
  semanticAnchor?: string
  variantKind: CompactQueryVariantKind
  requiresResultValidation: boolean
}

interface RouteLike {
  params?: Record<string, unknown>
  pipeline?: Array<{ params?: Record<string, unknown> }>
}

export interface CompactQueryInput {
  originalQuery: string
  aiLawArticles?: AiLawArticleSignal[]
  aiLawText?: string
  route?: RouteLike
  failedSearchText?: string
  max?: number
}

const LOW_INFORMATION_ARTICLE_TITLES = new Set([
  "목적",
  "정의",
  "용어의 정의",
  "적용 범위",
  "적용범위",
  "다른 법률과의 관계",
  "다른 법률과의 관계 등",
  "벌칙",
  "과태료",
  "시행일",
])

const MIN_AI_ARTICLE_SCORE = 90

function normalizeArticleTitle(title: string): string {
  return normalizeCandidate(title)
}

function normalizeCandidate(query: string): string {
  return query
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
}

function isUsefulCandidate(candidate: string, originalQuery: string): boolean {
  const normalized = normalizeCandidate(candidate)
  if (!normalized || normalized === normalizeCandidate(originalQuery)) return false
  if (normalized.length < 2 || normalized.length > 40) return false

  const tokens = normalized.split(/\s+/)
  if (/^(관한|대한|위한|따른|해당|관련)\s/.test(normalized)) return false
  if (tokens.some(token => /(에서|에게|으로|로서|로써|부터|까지)$/.test(token))) return false

  return true
}

function isGenericArticleTitle(title: string): boolean {
  const normalized = normalizeCandidate(title)
  return LOW_INFORMATION_ARTICLE_TITLES.has(normalized)
}

function supportTokens(text: string): string[] {
  return Array.from(new Set(
    normalizeCandidate(text)
      .replace(/<[^>]*>/g, " ")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(/\s+/)
      .map(token => token.replace(/(에서|에게|으로|로서|로써|부터|까지|합니다|해달라고)$/u, ""))
      .filter(token => token.length >= 2)
  ))
}

function scoreAiLawArticleCandidate(
  article: AiLawArticleSignal,
  originalQuery: string,
  query: string,
  source: CompactQuerySource
): number {
  let score = source === "ai_law_article_title" ? 100 : 85
  const title = normalizeCandidate(query.replace(article.lawName, "").trim() || query)
  const normalizedOriginal = normalizeCandidate(originalQuery)
  const queryTokens = supportTokens(originalQuery)
  const content = normalizeCandidate(article.articleContent)

  if (title.length >= 2 && title.length <= 12) score += 10
  else if (title.length > 12) score += 15

  if (normalizedOriginal.includes(title)) {
    score += 35
  } else if (queryTokens.some(token => title.includes(token) || token.includes(title))) {
    score += 20
  }

  if (article.lawName && normalizedOriginal.includes(article.lawName)) {
    score += 20
  }

  const contentHits = queryTokens.filter(token => content.includes(token)).length
  if (contentHits >= 2 && content.includes(title)) score += 15
  else if (contentHits >= 2) score += 10
  else if (contentHits === 1) score += 5

  if (isGenericArticleTitle(title)) score -= 80

  score += Math.max(0, 8 - article.sourceIndex)

  return score
}

interface TitleVariant {
  query: string
  search: PrecedentSearchScope
  variantKind: CompactQueryVariantKind
  scoreDelta: number
  requiresResultValidation: boolean
}

function titleVariants(title: string): TitleVariant[] {
  const normalized = normalizeArticleTitle(title)
  if (!normalized) return []
  const compactTerminalDeung = normalized.match(/^([가-힣A-Za-z0-9]{4,})등$/u)
  const spacedTerminalDeung = normalized.match(/^([가-힣A-Za-z0-9]{4,})\s+등$/u)
  const terminalStem = compactTerminalDeung?.[1] || spacedTerminalDeung?.[1]

  const variants: TitleVariant[] = [{
    query: normalized,
    search: spacedTerminalDeung ? 2 : 1,
    variantKind: "raw",
    scoreDelta: -5,
    requiresResultValidation: !!spacedTerminalDeung,
  }]

  if (terminalStem) {
    variants.push({
      query: terminalStem,
      search: 1,
      variantKind: "terminal_function_word_removed",
      scoreDelta: 18,
      requiresResultValidation: true,
    })
    if (!spacedTerminalDeung) {
      variants.push({
        query: `${terminalStem} 등`,
        search: 2,
        variantKind: "terminal_function_word_spaced",
        scoreDelta: 8,
        requiresResultValidation: true,
      })
    }
  }

  return variants
}

function pushCandidate(
  out: CompactQueryCandidate[],
  seen: Set<string>,
  originalQuery: string,
  query: string,
  source: CompactQuerySource,
  score: number,
  reason: string,
  options: {
    search?: PrecedentSearchScope
    semanticAnchor?: string
    variantKind?: CompactQueryVariantKind
    requiresResultValidation?: boolean
  } = {}
): void {
  const normalized = normalizeCandidate(query)
  const search = options.search ?? 1
  if (!isUsefulCandidate(normalized, originalQuery)) return
  const key = `${search}:${normalized}`
  if (seen.has(key)) return
  seen.add(key)
  out.push({
    query: normalized,
    source,
    score,
    reason,
    search,
    semanticAnchor: options.semanticAnchor,
    variantKind: options.variantKind ?? (source === "router" ? "router" : source === "search_retry_hint" ? "retry_hint" : "raw"),
    requiresResultValidation: options.requiresResultValidation ?? false,
  })
}

function addAiLawArticleCandidates(
  out: CompactQueryCandidate[],
  seen: Set<string>,
  originalQuery: string,
  aiLawText: string
): void {
  let currentLawName = ""

  for (const line of aiLawText.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (/^[가-힣A-Za-z0-9\s·ㆍ]+(법|법률|시행령|시행규칙|규칙|규정|령)$/.test(trimmed)) {
      currentLawName = trimmed
      continue
    }

    const titleMatch = trimmed.match(/제\d+조(?:의\d+)?\s*\(([^)]+)\)/)
    if (!titleMatch) continue

    const title = normalizeArticleTitle(titleMatch[1])
    const variants = titleVariants(title)
    for (const variant of variants) {
      pushCandidate(
        out,
        seen,
        originalQuery,
        variant.query,
        "ai_law_article_title",
        100 + variant.scoreDelta,
        "AI 법령검색 조문 제목",
        {
          search: variant.search,
          semanticAnchor: title,
          variantKind: variant.variantKind,
          requiresResultValidation: variant.requiresResultValidation,
        }
      )

      if (currentLawName && variant.search === 1) {
        pushCandidate(
          out,
          seen,
          originalQuery,
          `${currentLawName} ${variant.query}`,
          "ai_law_law_article_title",
          90 + variant.scoreDelta,
          "AI 법령검색 법령명 + 조문 제목",
          {
            search: 1,
            semanticAnchor: title,
            variantKind: "law_title",
            requiresResultValidation: variant.requiresResultValidation,
          }
        )
      }
    }
  }
}

function addStructuredAiLawArticleCandidates(
  out: CompactQueryCandidate[],
  seen: Set<string>,
  originalQuery: string,
  articles: AiLawArticleSignal[]
): void {
  for (const article of articles) {
    const title = normalizeArticleTitle(article.articleTitle)
    if (!title) continue
    for (const variant of titleVariants(title)) {
      const score = scoreAiLawArticleCandidate(article, originalQuery, variant.query, "ai_law_article_title") + variant.scoreDelta
      if (score < MIN_AI_ARTICLE_SCORE) continue

      pushCandidate(
        out,
        seen,
        originalQuery,
        variant.query,
        "ai_law_article_title",
        score,
        "AI 법령검색 raw 조문 제목",
        {
          search: variant.search,
          semanticAnchor: title,
          variantKind: variant.variantKind,
          requiresResultValidation: variant.requiresResultValidation,
        }
      )

      if (article.lawName && variant.search === 1) {
        const lawTitle = `${article.lawName} ${variant.query}`
        const lawTitleScore = scoreAiLawArticleCandidate(article, originalQuery, lawTitle, "ai_law_law_article_title") + variant.scoreDelta
        if (lawTitleScore < MIN_AI_ARTICLE_SCORE) continue
        pushCandidate(
          out,
          seen,
          originalQuery,
          lawTitle,
          "ai_law_law_article_title",
          lawTitleScore,
          "AI 법령검색 raw 법령명 + 조문 제목",
          {
            search: 1,
            semanticAnchor: title,
            variantKind: "law_title",
            requiresResultValidation: variant.requiresResultValidation,
          }
        )
      }
    }
  }
}

function addRetrySuggestionCandidates(
  out: CompactQueryCandidate[],
  seen: Set<string>,
  originalQuery: string,
  failedSearchText: string
): void {
  for (const line of failedSearchText.split("\n")) {
    if (!line.includes("재시도 제안")) continue
    for (const match of line.matchAll(/"([^"]+)"/g)) {
      pushCandidate(
        out,
        seen,
        originalQuery,
        match[1],
        "search_retry_hint",
        80,
        "검색 실패 응답의 재시도 제안",
        { variantKind: "retry_hint" }
      )
    }
  }
}

function addRouteCandidates(
  out: CompactQueryCandidate[],
  seen: Set<string>,
  originalQuery: string,
  route: RouteLike
): void {
  const addParamCandidate = (value: unknown): void => {
    if (typeof value !== "string") return
    pushCandidate(
      out,
      seen,
      originalQuery,
      value,
      "router",
      70,
      "query-router 후보",
      { variantKind: "router" }
    )
  }

  addParamCandidate(route.params?.query)
  addParamCandidate(route.params?.lawName)
  for (const step of route.pipeline || []) {
    addParamCandidate(step.params?.query)
    addParamCandidate(step.params?.lawName)
  }
}

export function buildCompactLegalQueries(input: CompactQueryInput): CompactQueryCandidate[] {
  const seen = new Set<string>()
  const candidates: CompactQueryCandidate[] = []

  if (input.aiLawArticles && input.aiLawArticles.length > 0) {
    addStructuredAiLawArticleCandidates(candidates, seen, input.originalQuery, input.aiLawArticles)
  } else if (input.aiLawText) {
    addAiLawArticleCandidates(candidates, seen, input.originalQuery, input.aiLawText)
  }
  if (input.failedSearchText) {
    addRetrySuggestionCandidates(candidates, seen, input.originalQuery, input.failedSearchText)
  }
  if (input.route) {
    addRouteCandidates(candidates, seen, input.originalQuery, input.route)
  }

  candidates.sort((a, b) => b.score - a.score)
  return candidates.slice(0, input.max ?? 5)
}
