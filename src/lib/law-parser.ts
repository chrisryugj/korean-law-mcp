/**
 * 법령 조문 번호 파싱 및 변환 유틸리티
 * LexDiff에서 이식 (debugLogger 제거)
 */

import { normalizeLawSearchText, resolveLawAlias } from "./search-normalizer.js"

interface ArticleComponents {
  articleNumber: number
  branchNumber: number
}

export interface ParsedSearchQuery {
  lawName: string
  article?: string
  jo?: string
  clause?: string
  item?: string
  subItem?: string
}

function stripClauseAndItem(raw: string): string {
  return raw
    .replace(/제?\d+항.*$/u, "")
    .replace(/제?\d+호.*$/u, "")
    .replace(/제?\d+목.*$/u, "")
}

function normalizeSeparators(raw: string): string {
  return raw
    .replace(/[‐‑‒–—―﹘﹣－]/gu, "-")
    .replace(/[·•]/gu, " ")
}

function parseArticleComponents(input: string): ArticleComponents {
  const sanitized = stripClauseAndItem(
    normalizeSeparators(input)
      .replace(/제|第/gu, "")
      .replace(/조문|條/gu, "조")
      .replace(/之/gu, "의")
      .replace(/[()]/gu, "")
      .replace(/\s+/gu, "")
      .trim(),
  )

  const match = sanitized.match(/(\d+)(?:조)?(?:(?:의|-)\s*(\d+))?/u)

  if (!match) {
    throw new Error(`조문 패턴을 인식할 수 없습니다: ${input}`)
  }

  const articleNumber = Number.parseInt(match[1], 10)
  const branchNumber = match[2] ? Number.parseInt(match[2], 10) : 0

  if (Number.isNaN(articleNumber) || Number.isNaN(branchNumber)) {
    throw new Error(`조문 번호를 해석할 수 없습니다: ${input}`)
  }

  return { articleNumber, branchNumber }
}

function formatArticleLabel({ articleNumber, branchNumber }: ArticleComponents): string {
  const base = `제${articleNumber}조`
  return branchNumber > 0 ? `${base}의${branchNumber}` : base
}

/**
 * Converts Korean law article notation to 6-digit JO code (법률/시행령/시행규칙용)
 * Format: AAAABB (AAAA=article, BB=branch)
 * Examples:
 *   "38조" → "003800"
 *   "10조의2" → "001002"
 *   "제5조" → "000500"
 */
export function buildJO(input: string): string {
  const components = parseArticleComponents(input)
  const articleNum = components.articleNumber.toString().padStart(4, "0")
  const branchNum = components.branchNumber.toString().padStart(2, "0")
  return `${articleNum}${branchNum}`
}

/**
 * Converts Korean ordinance article notation to 6-digit JO code (자치법규용)
 * Format: AABBCC (AA=article, BB=branch, CC=sub)
 * Examples:
 *   "제1조" → "010000"
 *   "제1조의1" → "010100"
 *   "제10조의2" → "100200"
 */
export function buildOrdinanceJO(input: string): string {
  const components = parseArticleComponents(input)
  const articleNum = components.articleNumber.toString().padStart(2, "0")
  const branchNum = components.branchNumber.toString().padStart(2, "0")
  return `${articleNum}${branchNum}00`
}

/**
 * Formats JO code back to readable Korean
 * Examples:
 *   Law format (AAAABB): "003800" → "제38조", "001002" → "제10조의2"
 *   Ordinance format (AABBCC): "010000" → "제1조", "010100" → "제1조의1"
 *   Legacy 8-digit (AAAABBCC): "00380001" → "제38조-1"
 */
export function formatJO(jo: string, isOrdinance = false): string {
  if (!jo) return ""

  if (jo.startsWith("제") && jo.includes("조")) {
    return jo
  }

  if (jo.length < 6) {
    const articleNum = Number.parseInt(jo, 10)
    if (!isNaN(articleNum)) {
      return `제${articleNum}조`
    }
    return jo
  }

  // Ordinance format: AABBCC (AA=article, BB=branch, CC=sub)
  if (isOrdinance && jo.length === 6 && /^\d{6}$/.test(jo)) {
    const articleNum = Number.parseInt(jo.substring(0, 2), 10)
    const branchNum = Number.parseInt(jo.substring(2, 4), 10)
    const subNum = Number.parseInt(jo.substring(4, 6), 10)

    let result = `제${articleNum}조`
    if (branchNum > 0) result += `의${branchNum}`
    if (subNum > 0) result += `-${subNum}`
    return result
  }

  // Law format: AAAABB (AAAA=article, BB=branch)
  if (!isOrdinance && jo.length === 6 && /^\d{6}$/.test(jo)) {
    const articleNum = Number.parseInt(jo.substring(0, 4), 10)
    const branchNum = Number.parseInt(jo.substring(4, 6), 10)

    if (branchNum === 0) {
      return `제${articleNum}조`
    }

    return `제${articleNum}조의${branchNum}`
  }

  // Legacy 8-digit format: AAAABBCC (AAAA=article, BB=branch, CC=sub)
  if (jo.length === 8 && /^\d{8}$/.test(jo)) {
    const articleNum = Number.parseInt(jo.substring(0, 4), 10)
    const branchNum = Number.parseInt(jo.substring(4, 6), 10)
    const subNum = Number.parseInt(jo.substring(6, 8), 10)

    let result = `제${articleNum}조`
    if (branchNum > 0) result += `의${branchNum}`
    if (subNum > 0) result += `-${subNum}`
    return result
  }

  return jo
}

/**
 * Normalizes law article notation
 */
export function normalizeArticle(article: string): string {
  const components = parseArticleComponents(article)
  return formatArticleLabel(components)
}

/**
 * Parses search query to extract law name and article
 */
export function parseSearchQuery(query: string): ParsedSearchQuery {
  const normalizedQuery = normalizeLawSearchText(query)
  const articlePattern =
    /\s*(제?\d+(?:조)?(?:[-의]\d+)?)(?:\s*제?\d+항)?(?:\s*제?\d+호)?(?:\s*제?\d+목)?$/u
  const match = articlePattern.exec(normalizedQuery)

  if (match && match.index !== undefined) {
    const rawLawName = normalizedQuery.slice(0, match.index).trim()
    const lawNameResolution = resolveLawAlias(rawLawName || normalizedQuery.trim())
    const lawName = lawNameResolution.canonical

    const fullArticleSegment = normalizedQuery.slice(match.index).trim()
    const articleLabel = normalizeArticle(match[1].trim())
    const jo = buildJO(articleLabel)

    const clauseMatch = fullArticleSegment.match(/제?\s*(\d+)\s*항/u)
    const itemMatch = fullArticleSegment.match(/제?\s*(\d+)\s*호/u)
    const subItemMatch = fullArticleSegment.match(/제?\s*(\d+)\s*목/u)

    const parsed: ParsedSearchQuery = {
      lawName,
      article: articleLabel,
      jo,
    }

    if (clauseMatch) parsed.clause = clauseMatch[1]
    if (itemMatch) parsed.item = itemMatch[1]
    if (subItemMatch) parsed.subItem = subItemMatch[1]

    return parsed
  }

  const trimmedLawName = normalizedQuery.trim()
  const lawNameResolution = resolveLawAlias(trimmedLawName)

  return { lawName: lawNameResolution.canonical }
}
