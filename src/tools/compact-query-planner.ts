export type CompactQuerySource =
  | "ai_law_article_title"
  | "ai_law_law_article_title"
  | "search_retry_hint"
  | "router"

export interface CompactQueryCandidate {
  query: string
  source: CompactQuerySource
  score: number
  reason: string
}

interface RouteLike {
  params?: Record<string, unknown>
  pipeline?: Array<{ params?: Record<string, unknown> }>
}

export interface CompactQueryInput {
  originalQuery: string
  aiLawText?: string
  route?: RouteLike
  failedSearchText?: string
  max?: number
}

function normalizeArticleTitle(title: string): string {
  return title
    .replace(/등(?:의)?\s*(효과|제한|기준|방법|절차)?$/g, "")
    .replace(/의\s*(내용|효과|기준|범위)$/g, "")
    .trim()
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

function pushCandidate(
  out: CompactQueryCandidate[],
  seen: Set<string>,
  originalQuery: string,
  query: string,
  source: CompactQuerySource,
  score: number,
  reason: string
): void {
  const normalized = normalizeCandidate(query)
  if (!isUsefulCandidate(normalized, originalQuery)) return
  if (seen.has(normalized)) return
  seen.add(normalized)
  out.push({ query: normalized, source, score, reason })
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
    if (!title) continue

    pushCandidate(
      out,
      seen,
      originalQuery,
      title,
      "ai_law_article_title",
      100,
      "AI 법령검색 조문 제목"
    )

    if (currentLawName) {
      pushCandidate(
        out,
        seen,
        originalQuery,
        `${currentLawName} ${title}`,
        "ai_law_law_article_title",
        90,
        "AI 법령검색 법령명 + 조문 제목"
      )
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
        "검색 실패 응답의 재시도 제안"
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
      "query-router 후보"
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

  if (input.aiLawText) {
    addAiLawArticleCandidates(candidates, seen, input.originalQuery, input.aiLawText)
  }
  if (input.failedSearchText) {
    addRetrySuggestionCandidates(candidates, seen, input.originalQuery, input.failedSearchText)
  }
  if (input.route) {
    addRouteCandidates(candidates, seen, input.originalQuery, input.route)
  }

  return candidates.slice(0, input.max ?? 5)
}
