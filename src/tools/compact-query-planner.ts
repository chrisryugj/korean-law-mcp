import type { AiLawArticleSignal } from "./life-law.js"

export type CompactQuerySource =
  | "case_number"
  | "original_query"
  | "original_keyword"
  | "document_hint"
  | "ai_law_article_title"
  | "ai_law_law_article_title"
  | "router"

export type PrecedentSearchScope = 1 | 2

export type CompactQueryVariantKind =
  | "case_number"
  | "original_query"
  | "original_keyword"
  | "document_hint"
  | "raw"
  | "terminal_function_word_removed"
  | "terminal_function_word_spaced"
  | "law_title"
  | "router"

export interface CompactQueryCandidate {
  query: string
  source: CompactQuerySource
  score: number
  reason: string
  search: PrecedentSearchScope
  semanticAnchor?: string
  validationTermGroups?: string[][]
  variantKind: CompactQueryVariantKind
  requiresResultValidation: boolean
}

interface RouteLike {
  params?: Record<string, unknown>
  pipeline?: Array<{ params?: Record<string, unknown> }>
}

export interface CompactQueryInput {
  originalQuery: string
  includeOriginal?: boolean
  caseNumber?: string
  documentHints?: string[]
  aiLawArticles?: AiLawArticleSignal[]
  route?: RouteLike
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
const CASE_CODE_PATTERN = "(?:고합|고단|고정|고약|구합|구단|구|누|두|헌가|헌나|헌다|헌라|헌마|헌바|헌사|카합|카단|카기|회합|회단|[가나다라마바사아자차카타파하]|고|노|도|모|보|로|초)"
const COURT_CASE_RE = new RegExp(`(?:19|20)\\d{2}\\s*${CASE_CODE_PATTERN}\\s*\\d{1,8}`, "u")
const LEGAL_CORE_KEYWORDS = new Set([
  "근로", "종속", "지휘", "감독", "출퇴근", "전속", "도급", "위장", "프리랜서",
  "임금", "퇴직금", "해고", "부당", "계약", "고용", "근로자", "사용자",
  "법률", "법령", "조문", "항", "호", "목",
  "판례", "결정", "심판", "재판", "소송", "처분", "취소", "환급",
  "재산", "분할", "상속", "혼인", "이혼",
  "손해", "배상", "위약", "불법",
  "개인정보", "보호", "유출", "침해",
  "세금", "소득세", "양도소득세", "부가세", "법인세", "국세", "조세", "과세", "부과처분",
  "건설", "건설공사", "공사", "도급", "하도급", "발주자", "발주처", "원청", "원사업자", "수급인", "하수급인",
])
const TAX_DOMAIN_KEYWORDS = new Set([
  "양도소득세", "소득세", "부가세", "법인세", "국세", "조세", "세금", "과세", "부과처분",
])
const CONSTRUCTION_LEGAL_AXIS_KEYWORDS = new Set([
  "건설", "건설공사", "공사", "도급", "하도급", "발주자", "발주처", "원청", "원사업자", "수급인", "하수급인",
])
const GENERIC_LEGAL_ACTION_KEYWORDS = new Set([
  "처분", "취소", "환급", "결정", "심판", "재판", "소송",
])
const FACT_AXIS_PATTERNS = [
  "사기행위", "사기", "부정한 행위", "부정한행위", "허위계약서", "허위", "명의위장", "조세회피",
  "하자보수", "하자담보책임", "부실시공", "미시공", "하자",
  "지체상금", "지연손해금", "공사지연", "공기지연", "공기연장",
  "설계변경", "추가공사", "변경공사", "준공", "사용승인",
  "공사비", "공사대금", "기성금", "기성고", "추가공사비", "선급금",
  "대금직불", "계약금액조정", "물가변동", "감리",
  "프리랜서", "외주", "도급", "위탁", "계약직",
  "출퇴근", "근무시간", "근무장소", "통제",
  "전속", "배타적", "겸직",
  "월급", "고정급", "수수료", "성과급",
  "해고당함", "퇴직", "사직",
  "임금체불", "미지급", "체불",
  "이혼", "재산", "부동산",
  "자녀", "양육", "친권",
]
const FACT_AXIS_SYNONYMS: Record<string, string[]> = {
  "사기": ["사기행위", "부정한 행위", "허위"],
  "허위": ["허위계약서", "사기", "부정한 행위"],
  "하자보수": ["하자", "하자담보책임", "부실시공"],
  "하자": ["하자보수", "하자담보책임", "부실시공"],
  "지체상금": ["지연손해금", "공사지연", "공기지연", "공기연장"],
  "공기지연": ["지체상금", "지연손해금", "공사지연", "공기연장"],
  "설계변경": ["추가공사", "변경공사", "공사대금"],
  "공사비": ["공사대금", "기성금", "추가공사비"],
  "공사대금": ["공사비", "기성금", "추가공사비"],
}
const ORIGINAL_QUERY_STOPWORDS = new Set([
  "판례",
  "판결",
  "결정",
  "사례",
  "관련",
  "대한",
  "관한",
  "찾아줘",
  "찾아주세요",
  "알려줘",
  "알려주세요",
  "검색",
  "조회",
  "의무",
  "가능",
  "가능한",
  "가능한가",
  "가능한가요",
  "가능여부",
  "여부",
  "절차",
  "방법",
  "행위",
  "의해",
  "부과",
  "부과된",
])

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

function normalizeCaseNumber(caseNumber: string): string {
  return normalizeCandidate(caseNumber).replace(/\s+/g, "")
}

function extractCaseNumber(text: string): string | null {
  const match = normalizeCandidate(text).match(COURT_CASE_RE)
  return match ? normalizeCaseNumber(match[0]) : null
}

function normalizeOriginalPrecedentQuery(query: string): string {
  return normalizeCandidate(query)
    .replace(/<[^>]*>/g, " ")
    .replace(COURT_CASE_RE, match => normalizeCaseNumber(match))
    .replace(/(대법원|고등법원|지방법원|가정법원|행정법원|특허법원|법원)/g, " ")
    .replace(/(판례|판결|결정례|결정|사례)/g, " ")
    .replace(/(찾아주세요|찾아줘요|찾아줘|알려주세요|알려줘요|알려줘|검색해주세요|검색해줘요|검색해줘|조회해주세요|조회해줘요|조회해줘|검색|조회)/g, " ")
    .replace(/\s+[을를이가은는]\s+/g, " ")
    .replace(/\s+[을를이가은는]$/g, "")
    .replace(/\b(관련|대한|관한)\b/g, " ")
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

function normalizeAxisToken(token: string): string {
  return token
    .replace(/[?？!.,]/g, "")
    .replace(/(에서|에게|으로|로서|로써|부터|까지|입니다|합니다|했다|한다|해요)$/u, "")
    .replace(/(되었는지|되었는가|되는지|되는가|인가요|인지요|인가|인지)$/u, "")
    .replace(/(가|이|은|는|을|를|에|의|와|과)$/u, "")
    .replace(/된$/u, "")
    .trim()
}

function extractedOriginalKeywords(originalQuery: string): string[] {
  const words = normalizeOriginalPrecedentQuery(originalQuery)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .map(normalizeAxisToken)
    .filter(token => token.length >= 2 && !ORIGINAL_QUERY_STOPWORDS.has(token))

  const core: string[] = []
  const other: string[] = []
  const seen = new Set<string>()

  for (const word of words) {
    if (seen.has(word)) continue
    seen.add(word)
    const isCore = Array.from(LEGAL_CORE_KEYWORDS).some(keyword => keyword.includes(word) || word.includes(keyword))
    if (isCore) core.push(word)
    else other.push(word)
  }

  return [...core, ...other]
}

interface QueryAxes {
  legalAxis: string[]
  factAxis: string[]
  legalValidationTerms: string[]
  factValidationTerms: string[]
}

function addUnique(out: string[], value: string): void {
  const normalized = normalizeCandidate(value)
  if (normalized && !out.includes(normalized)) out.push(normalized)
}

function compactAxisTerm(term: string): string {
  return term.replace(/\s+/g, "")
}

function canonicalFactAxisTerm(term: string): string {
  const compact = compactAxisTerm(term)
  for (const axis of Object.keys(FACT_AXIS_SYNONYMS)) {
    if (compactAxisTerm(axis) === compact) return axis
  }
  for (const [axis, synonyms] of Object.entries(FACT_AXIS_SYNONYMS)) {
    if (synonyms.some(synonym => compactAxisTerm(synonym) === compact)) return axis
  }
  return term
}

function addLegalAxisForKeyword(axes: QueryAxes, keyword: string): void {
  const compact = keyword.replace(/\s+/g, "")
  if (!compact) return

  if (TAX_DOMAIN_KEYWORDS.has(compact) || compact.includes("소득세") || compact.includes("조세") || compact.includes("과세")) {
    if (compact.includes("양도소득세")) addUnique(axes.legalAxis, "양도소득세")
    if (compact.includes("소득세")) addUnique(axes.legalAxis, "소득세")
    if (compact.includes("조세")) addUnique(axes.legalAxis, "조세")
    if (compact.includes("과세")) addUnique(axes.legalAxis, "과세")
    addUnique(axes.legalValidationTerms, "양도소득세")
    addUnique(axes.legalValidationTerms, "소득세")
    addUnique(axes.legalValidationTerms, "조세")
    addUnique(axes.legalValidationTerms, "과세")
    return
  }

  if (CONSTRUCTION_LEGAL_AXIS_KEYWORDS.has(compact)) {
    if (compact.includes("건설공사")) addUnique(axes.legalAxis, "건설공사")
    else if (compact.includes("건설")) addUnique(axes.legalAxis, "건설공사")
    else addUnique(axes.legalAxis, compact)
    addUnique(axes.legalValidationTerms, "건설공사")
    addUnique(axes.legalValidationTerms, "건설")
    addUnique(axes.legalValidationTerms, "공사")
    addUnique(axes.legalValidationTerms, "도급")
    addUnique(axes.legalValidationTerms, "하도급")
    return
  }

  if (LEGAL_CORE_KEYWORDS.has(compact) || /[가-힣]+법$/u.test(compact)) {
    addUnique(axes.legalAxis, compact)
    addUnique(axes.legalValidationTerms, compact)
  }
}

function addFactAxisForKeyword(axes: QueryAxes, keyword: string): void {
  const compact = keyword.replace(/\s+/g, "")
  if (!compact) return
  if (CONSTRUCTION_LEGAL_AXIS_KEYWORDS.has(compact)) return

  const matchedPattern = FACT_AXIS_PATTERNS.find(pattern => {
    const normalizedPattern = pattern.replace(/\s+/g, "")
    return compact.includes(normalizedPattern) || normalizedPattern.includes(compact)
  })

  if (matchedPattern) {
    const fact = matchedPattern.replace(/\s+/g, "")
    const canonicalFact = canonicalFactAxisTerm(fact)
    addUnique(axes.factAxis, canonicalFact)
    addUnique(axes.factValidationTerms, fact)
    addUnique(axes.factValidationTerms, canonicalFact)
    for (const synonym of FACT_AXIS_SYNONYMS[canonicalFact] || FACT_AXIS_SYNONYMS[fact] || FACT_AXIS_SYNONYMS[keyword] || []) {
      addUnique(axes.factValidationTerms, synonym)
    }
    return
  }

  if (!LEGAL_CORE_KEYWORDS.has(compact)) {
    addUnique(axes.factAxis, compact)
  }
}

function isKnownFactAxis(term: string): boolean {
  const compact = term.replace(/\s+/g, "")
  return FACT_AXIS_PATTERNS.some(pattern => pattern.replace(/\s+/g, "") === compact)
}

function buildOriginalQueryAxes(originalQuery: string): QueryAxes {
  const axes: QueryAxes = {
    legalAxis: [],
    factAxis: [],
    legalValidationTerms: [],
    factValidationTerms: [],
  }
  const keywords = extractedOriginalKeywords(originalQuery)
  const normalizedOriginal = normalizeOriginalPrecedentQuery(originalQuery)
  const compactOriginal = normalizedOriginal.replace(/\s+/g, "")

  for (const keyword of keywords) {
    addLegalAxisForKeyword(axes, keyword)
  }

  for (const pattern of FACT_AXIS_PATTERNS) {
    if (compactOriginal.includes(pattern.replace(/\s+/g, ""))) {
      addFactAxisForKeyword(axes, pattern)
    }
  }
  for (const keyword of keywords) {
    addFactAxisForKeyword(axes, keyword)
  }

  const hasDomainLegalAxis = axes.legalValidationTerms.some(term => (
    TAX_DOMAIN_KEYWORDS.has(term) ||
    CONSTRUCTION_LEGAL_AXIS_KEYWORDS.has(term) ||
    term.includes("소득세") ||
    term.includes("조세") ||
    term.includes("과세") ||
    term.includes("건설") ||
    term.includes("하도급")
  ))
  if (hasDomainLegalAxis) {
    axes.legalAxis = axes.legalAxis.filter(term => !GENERIC_LEGAL_ACTION_KEYWORDS.has(term))
    axes.legalValidationTerms = axes.legalValidationTerms.filter(term => !GENERIC_LEGAL_ACTION_KEYWORDS.has(term))
  }
  axes.factAxis = axes.factAxis.filter(keyword => !axes.legalAxis.includes(keyword))
  return axes
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
    validationTermGroups?: string[][]
    variantKind?: CompactQueryVariantKind
    requiresResultValidation?: boolean
    allowSameAsOriginal?: boolean
  } = {}
): void {
  const normalized = normalizeCandidate(query)
  const search = options.search ?? 1
  if (options.allowSameAsOriginal) {
    if (!normalized || normalized.length < 2 || normalized.length > 40) return
  } else if (!isUsefulCandidate(normalized, originalQuery)) {
    return
  }
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
    validationTermGroups: options.validationTermGroups,
    variantKind: options.variantKind ?? (
      source === "case_number" ? "case_number" :
      source === "original_query" ? "original_query" :
      source === "original_keyword" ? "original_keyword" :
      source === "document_hint" ? "document_hint" :
      source === "router" ? "router" :
      "raw"
    ),
    requiresResultValidation: options.requiresResultValidation ?? false,
  })
}

function originalKeywordTokens(originalQuery: string): string[] {
  return extractedOriginalKeywords(originalQuery)
}

function addCaseNumberCandidate(
  out: CompactQueryCandidate[],
  seen: Set<string>,
  originalQuery: string,
  caseNumber?: string
): void {
  const explicit = caseNumber ? normalizeCaseNumber(caseNumber) : ""
  const detected = extractCaseNumber(originalQuery) || ""
  const candidate = explicit || detected
  if (!candidate) return

  pushCandidate(
    out,
    seen,
    originalQuery,
    candidate,
    "case_number",
    300,
    explicit ? "명시 사건번호" : "원질의 사건번호",
    {
      variantKind: "case_number",
      requiresResultValidation: false,
      allowSameAsOriginal: true,
    }
  )
}

function addOriginalQueryCandidate(
  out: CompactQueryCandidate[],
  seen: Set<string>,
  originalQuery: string
): void {
  const normalized = normalizeOriginalPrecedentQuery(originalQuery)
  if (!normalized) return
  const useful = normalized === normalizeCandidate(originalQuery)
    ? normalized.length >= 2 && normalized.length <= 40
    : true
  if (!useful) return

  pushCandidate(
    out,
    seen,
    originalQuery,
    normalized,
    "original_query",
    260,
    "원 자연어 질의 정규화",
    {
      variantKind: "original_query",
      requiresResultValidation: false,
      allowSameAsOriginal: true,
    }
  )
}

function addOriginalKeywordCandidates(
  out: CompactQueryCandidate[],
  seen: Set<string>,
  originalQuery: string
): void {
  const tokens = originalKeywordTokens(originalQuery)
  const axes = buildOriginalQueryAxes(originalQuery)
  if (tokens.length > 8) return
  if (tokens.length === 0) return

  if (axes.legalAxis.length > 0 && axes.factAxis.length > 0) {
    const legalPrimary = axes.legalAxis.find(term => !["소득세", "조세", "과세"].includes(term)) || axes.legalAxis[0]
    const factPrimary = axes.factAxis[0]
    const validationTermGroups = [
      axes.legalValidationTerms.length > 0 ? axes.legalValidationTerms : axes.legalAxis,
      axes.factValidationTerms.length > 0 ? axes.factValidationTerms : axes.factAxis,
    ]

    pushCandidate(
      out,
      seen,
      originalQuery,
      `${legalPrimary} ${factPrimary}`,
      "original_keyword",
      235,
      "원질의 법리축 + 사실축 결합",
      {
        variantKind: "original_keyword",
        requiresResultValidation: true,
        validationTermGroups,
      }
    )

    if (axes.legalAxis.length >= 2) {
      pushCandidate(
        out,
        seen,
        originalQuery,
        `${axes.legalAxis.slice(0, 2).join(" ")} ${factPrimary}`,
        "original_keyword",
        232,
        "원질의 법리축 확장 + 사실축 결합",
        {
          variantKind: "original_keyword",
          requiresResultValidation: true,
          validationTermGroups,
        }
      )
    }

    if (axes.factAxis.length >= 2 && isKnownFactAxis(axes.factAxis[1])) {
      pushCandidate(
        out,
        seen,
        originalQuery,
        `${legalPrimary} ${axes.factAxis[1]}`,
        "original_keyword",
        230,
        "원질의 법리축 + 보조 사실축 결합",
        {
          variantKind: "original_keyword",
          requiresResultValidation: true,
          validationTermGroups,
        }
      )
    }

    const factSynonym = (FACT_AXIS_SYNONYMS[factPrimary] || [])[0]
    if (factSynonym) {
      pushCandidate(
        out,
        seen,
        originalQuery,
        `${legalPrimary} ${factSynonym}`,
        "original_keyword",
        228,
        "원질의 법리축 + 사실축 유사표현 결합",
        {
          variantKind: "original_keyword",
          requiresResultValidation: true,
          validationTermGroups,
        }
      )
    }

    return
  }

  if (tokens.length >= 2) {
    pushCandidate(
      out,
      seen,
      originalQuery,
      tokens.slice(0, 3).join(" "),
      "original_keyword",
      165,
      "원질의 핵심 키워드 축약",
      {
        variantKind: "original_keyword",
        requiresResultValidation: true,
      }
    )
  }
}

function addDocumentHintCandidates(
  out: CompactQueryCandidate[],
  seen: Set<string>,
  originalQuery: string,
  hints: string[]
): void {
  for (const hint of hints) {
    pushCandidate(
      out,
      seen,
      originalQuery,
      hint,
      "document_hint",
      220,
      "문서/체인 쟁점 검색 hint",
      {
        variantKind: "document_hint",
        requiresResultValidation: false,
      }
    )
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
      200,
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

  addCaseNumberCandidate(candidates, seen, input.originalQuery, input.caseNumber)
  if (input.includeOriginal) {
    addOriginalQueryCandidate(candidates, seen, input.originalQuery)
    addOriginalKeywordCandidates(candidates, seen, input.originalQuery)
  }
  if (input.documentHints && input.documentHints.length > 0) {
    addDocumentHintCandidates(candidates, seen, input.originalQuery, input.documentHints)
  }
  if (input.route) {
    addRouteCandidates(candidates, seen, input.originalQuery, input.route)
  }
  if (input.aiLawArticles && input.aiLawArticles.length > 0) {
    addStructuredAiLawArticleCandidates(candidates, seen, input.originalQuery, input.aiLawArticles)
  }

  candidates.sort((a, b) => b.score - a.score)
  return candidates.slice(0, input.max ?? 5)
}
