/**
 * Chain Tools -- 질문 유형별 다단계 자동 체이닝
 * 7개 체인 + 키워드 트리거 확장
 */
import { z } from "zod"
import { truncateSections } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"
import type { LawApiClient } from "../lib/api-client.js"
import type { ToolResponse, LooseToolResponse } from "../lib/types.js"
import {
  findLaws,
  NON_LAW_NAME_RE,
  scoreLawRelevance,
  type LawInfo,
} from "../lib/law-search.js"
import { routeQuery } from "../lib/query-router.js"
import { resolveChainBaseLaw } from "./chain-law-lookup.js"
import {
  startChainDeadline,
  raceDeadline,
  timedOutSection,
  timedOutChainNotice,
  type ChainDeadline,
  type LegOutcome,
} from "./chain-deadline.js"
import { runScenario, detectScenario, scenarioProvides, formatSections, formatSuggestedActions } from "./scenarios/index.js"
import type { ScenarioType, ScenarioContext, ScenarioResult } from "./scenarios/index.js"

// Tool handler imports
import { analyzeDocument } from "./document-analysis.js"
import { getThreeTier } from "./three-tier.js"
import { getBatchArticles } from "./batch-articles.js"
import { renderPrecedentSearchResult, searchPrecedents, type SearchPrecedentsInput } from "./precedents.js"
import { searchInterpretations } from "./interpretations.js"
import { searchAdminAppeals } from "./admin-appeals.js"
import { compareOldNew } from "./comparison.js"
import { getArticleHistory } from "./article-history.js"
import { searchOrdinance } from "./ordinance-search.js"
import { getOrdinance } from "./ordinance.js"
import { getAnnexes } from "./annex.js"
import { searchAiLaw, searchAiLawStructured, type AiLawArticleSignal, type SearchAiLawInput } from "./life-law.js"
import { getLawText } from "./law-text.js"
import { searchTaxTribunalDecisions } from "./tax-tribunal-decisions.js"
import { searchNlrcDecisions, searchPipcDecisions } from "./committee-decisions.js"
import { fetchSearchDetailChain } from "./search-detail-chain.js"
import {
  searchPrecedentsStructured,
  type PrecedentSearchContext,
  type StructuredPrecedentSearchResult,
} from "./precedent-search-core.js"
import { fetchPrecedentEvidence, validatePrecedentSearchResult, type PrecedentDetailMemo } from "./precedent-evidence.js"
import { getRequestSignal, throwIfRequestCancelled, runWithRequestContext } from "../lib/session-state.js"

/**
 * 체인 query 길이 상한 (#121).
 *
 * 체인 query 는 "법령명 + 키워드"라 짧다. 평가 세트(R/B 케이스 76건)의 최장 정상 질의가
 * 145자(인용 검증용 붙여넣기)이므로 그 13배가 넘는 여유를 뒀다.
 * 상한이 없으면 무제한 사용자 텍스트가 routeQuery 의 O(n²) 패턴에 그대로 들어가
 * 이벤트 루프를 장기 점유한다(8.5k자 476ms, HTTP body 한도 100kb 안에서도 통과).
 */
export const MAX_CHAIN_QUERY = 2000
const chainQuery = (desc: string) => z.string().max(MAX_CHAIN_QUERY).describe(desc)

// ========================================
// Types
// ========================================

interface CallResult {
  text: string
  isError: boolean
  aiLawArticles?: AiLawArticleSignal[]
}

type DomainType = "customs" | "tax" | "labor" | "privacy" | "competition"

type ExpansionType = "annex_fee" | "annex_form" | "annex_table" | "precedent" | "interpretation"

// ========================================
// Helpers
// ========================================

const PRECEDENT_FALLBACK_LIMIT = 5

function emptyStructuredPrecedentResult(args: SearchPrecedentsInput): StructuredPrecedentSearchResult {
  return {
    originalArgs: args,
    totalCount: 0,
    page: args.page || 1,
    hits: [],
    attempts: [],
    fallbackUsed: false,
  }
}

function errorCallResult(error: unknown, toolName: string): CallResult {
  const response = formatToolError(error, toolName)
  return {
    text: response.content?.[0]?.text || (error instanceof Error ? error.message : String(error)),
    isError: true,
  }
}

async function safeSearchPrecedentsStructured(
  apiClient: LawApiClient,
  args: SearchPrecedentsInput,
  context: PrecedentSearchContext = {}
): Promise<{ result: StructuredPrecedentSearchResult; error?: CallResult }> {
  try {
    throwIfRequestCancelled()
    return {
      result: await searchPrecedentsStructured(apiClient, args, context),
    }
  } catch (error) {
    if (getRequestSignal()?.aborted) throw error
    return {
      result: emptyStructuredPrecedentResult(args),
      error: errorCallResult(error, "search_precedents"),
    }
  }
}

async function callTool(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (apiClient: LawApiClient, input: any) => Promise<LooseToolResponse>,
  apiClient: LawApiClient,
  input: Record<string, unknown>
): Promise<CallResult> {
  try {
    throwIfRequestCancelled()
    const result = await handler(apiClient, input)
    throwIfRequestCancelled()
    return { text: result.content?.[0]?.text || "", isError: !!result.isError }
  } catch (e) {
    if (getRequestSignal()?.aborted) throw e
    return { text: `오류: ${e instanceof Error ? e.message : String(e)}`, isError: true }
  }
}

async function callAiLaw(
  apiClient: LawApiClient,
  input: SearchAiLawInput
): Promise<CallResult> {
  try {
    throwIfRequestCancelled()
    const result = await searchAiLawStructured(apiClient, input)
    throwIfRequestCancelled()
    return {
      text: result.response.content?.[0]?.text || "",
      isError: !!result.response.isError,
      aiLawArticles: result.articleSignals,
    }
  } catch (e) {
    if (getRequestSignal()?.aborted) throw e
    return { text: `오류: ${e instanceof Error ? e.message : String(e)}`, isError: true }
  }
}

/**
 * 체인이 별표를 따로 받아야 하는가 (#131).
 *
 * 별표를 싣는 시나리오가 붙으면 체인은 받지 않는다 — 또 받으면 같은 파일을 두 번
 * 내려받아 파싱하고(실측 3.0초) 같은 표가 두 번 나온다.
 * 어느 시나리오가 무엇을 싣는지는 **시나리오가 선언**한다(scenarios/*.ts 의 PROVIDES).
 * 여기에 이름을 하드코딩하면 별표를 싣는 새 시나리오가 생길 때마다 중복이 되살아난다.
 */
export function shouldFetchAnnexSeparately(
  expansions: ExpansionType[],
  scenario: ScenarioType | null
): boolean {
  const wanted = expansions.includes("annex_fee") || expansions.includes("annex_table")
  return wanted && !scenarioProvides(scenario).includes("annex")
}

function detectExpansions(query: string): ExpansionType[] {
  const exp: ExpansionType[] = []
  // 환불/반환/배상/수강료 등 소비자분쟁 관련 금액 키워드 확장
  // 헬스장 환불 케이스(trace ld-1775959823220)에서 "환불"·"120만원"이 미매치로 별표 누락 → 추가
  // 과매칭 방지: "\d+원"과 "기준/요율/비율/산정" 같은 광범위 키워드는 제외
  if (/수수료|과태료|요금|금액|벌금|과징금|벌칙|환불|반환|환급|배상|보상|수강료|이용료|회비|\d+\s*만\s*원/.test(query)) exp.push("annex_fee")
  if (/서식|신청서|양식|별지|신고서/.test(query)) exp.push("annex_form")
  if (/별표|기준표|산정기준/.test(query)) exp.push("annex_table")
  if (/판례|사례|판결|대법원/.test(query)) exp.push("precedent")
  if (/해석|유권해석|질의회신/.test(query)) exp.push("interpretation")
  return exp
}

/** 조례 쿼리에서 지역명·조례 키워드 제거 → 상위법 검색용 */
function stripOrdinanceKeywords(query: string): string {
  return query
    .replace(/(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)(?:시|도|특별시|광역시|특별자치시|특별자치도)?/g, "")
    .replace(/\s*(조례|규칙|자치법규)\s*/g, " ")
    .trim()
}

function detectDomain(query: string): DomainType | null {
  if (/관세|수출|수입|통관|FTA|원산지/.test(query)) return "customs"
  if (/세금|세무|소득세|법인세|부가세|취득세|재산세|지방세|국세/.test(query)) return "tax"
  if (/근로|노동|임금|해고|산재|산업안전|기간제|퇴직/.test(query)) return "labor"
  if (/개인정보|정보보호|CCTV|정보공개/.test(query)) return "privacy"
  if (/공정거래|독점|담합|불공정/.test(query)) return "competition"
  return null
}

function sec(title: string, content: string): string {
  if (!content || !content.trim()) return ""
  return `\n▶ ${title}\n${content}\n`
}

/** 부분 실패 시 사용자에게 왜 빠졌는지 알림 — LLM 환각 방지용 명시적 NOT_FOUND 마커 */
function secOrSkip(title: string, result: CallResult): string {
  if (!result.isError) return sec(title, result.text)
  // 에러인 경우 왜 빠졌는지 표시 (200자까지 노출, LLM이 원인 파악 가능하게)
  if (result.text && result.text.trim()) {
    const snippet = result.text.length > 200 ? result.text.slice(0, 200) + "..." : result.text
    return `\n▶ ${title} [NOT_FOUND / FAILED]\n   ⚠️ 이 섹션은 조회 실패 — LLM은 내용을 추측/생성하지 마세요.\n   사유: ${snippet}\n`
  }
  return `\n▶ ${title} [NOT_FOUND / FAILED]\n   ⚠️ 이 섹션은 조회 실패 — LLM은 내용을 추측/생성하지 마세요.\n`
}

function noResult(query: string, attempts: string[] = []): ToolResponse {
  const keywords = query.trim().split(/\s+/)
  const lines = [`[NOT_FOUND] '${query}' 관련 법령을 찾을 수 없습니다.`]
  lines.push("")
  lines.push("⚠️ 이 체인은 기반 법령을 찾지 못해 실행을 중단했습니다. LLM은 법령·조문·판례를 추측/생성하지 마세요. 사용자에게 '검색 실패'를 명시 보고하세요.")
  // 무엇으로 찾아봤는지 밝힌다 — 안 밝히면 이용자는 다르게 물을 방법을 모른다(#105)
  if (attempts.length) {
    lines.push("")
    lines.push(`시도한 검색어: ${attempts.map(a => `"${a}"`).join(" → ")}`)
  }
  if (keywords.length >= 2) {
    lines.push("")
    lines.push("힌트: 법제처 API는 공백 구분 키워드를 AND 조건으로 처리합니다. 키워드가 많을수록 결과가 줄어듭니다.")
    lines.push(`재시도 제안: "${keywords[0]}" 또는 "${keywords.slice(0, 2).join(" ")}"`)
  } else {
    lines.push("검색어를 확인해주세요.")
  }
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    isError: true,
  }
}

function filterReliableLawResults(laws: LawInfo[], query: string): LawInfo[] {
  const queryWords = query.replace(NON_LAW_NAME_RE, " ")
    .trim()
    .split(/\s+/)
    .filter(word => word.length > 0)

  return laws.filter(law => scoreLawRelevance(law.lawName, query, queryWords) > 5)
}

function selectLawTextSource(laws: LawInfo[], query: string): { reliableLaws: LawInfo[], textLaw?: LawInfo, lowConfidence: boolean } {
  const reliableLaws = filterReliableLawResults(laws, query)
  if (reliableLaws.length > 0) {
    return { reliableLaws, textLaw: reliableLaws[0], lowConfidence: false }
  }
  return { reliableLaws, textLaw: laws[0], lowConfidence: laws.length > 0 }
}

async function searchPrecedentsForChain(
  apiClient: LawApiClient,
  input: { query: string; display: number; apiKey?: string },
  context: PrecedentSearchContext = {},
  detailLimit = 2
): Promise<{ structuredResult: StructuredPrecedentSearchResult; searchResult: CallResult; detailResult: CallResult | null }> {
  const args: SearchPrecedentsInput = {
    query: input.query,
    display: input.display,
    page: 1,
    apiKey: input.apiKey,
  }
  // 검증이 받은 상위 판례 상세를 아래 근거 조회가 다시 받지 않게 한 호출 안에서 공유한다 (B#10)
  const detailMemo: PrecedentDetailMemo = new Map()
  const { result: search, error } = await safeSearchPrecedentsStructured(apiClient, args, {
    ...context,
    maxFallbackAttempts: context.maxFallbackAttempts ?? PRECEDENT_FALLBACK_LIMIT,
    validateResult: validation => validatePrecedentSearchResult(apiClient, validation, { apiKey: input.apiKey, detailMemo }),
  })

  if (error) {
    return {
      structuredResult: search,
      searchResult: error,
      detailResult: null,
    }
  }

  const searchResult: CallResult = {
    text: renderPrecedentSearchResult(search),
    isError: search.hits.length === 0,
  }
  const evidence = await fetchPrecedentEvidence(apiClient, search, {
    apiKey: input.apiKey,
    detailLimit,
    full: false,
    detailMemo,
  })

  return {
    structuredResult: search,
    searchResult,
    detailResult: evidence ? { text: evidence.text, isError: evidence.isError } : null,
  }
}

function combineStructuredPrecedentResults(
  results: StructuredPrecedentSearchResult[]
): StructuredPrecedentSearchResult | null {
  const nonEmpty = results.filter(result => result.hits.length > 0)
  if (nonEmpty.length === 0) return null

  const seen = new Set<string>()
  const hits = nonEmpty.flatMap(result => result.hits)
    .filter(hit => {
      if (seen.has(hit.id)) return false
      seen.add(hit.id)
      return true
    })

  return {
    originalArgs: nonEmpty[0].originalArgs,
    totalCount: hits.length,
    page: 1,
    hits,
    attempts: results.flatMap(result => result.attempts),
    fallbackUsed: results.some(result => result.fallbackUsed),
    successfulAttempt: nonEmpty[0].successfulAttempt,
  }
}

function wrapResult(text: string): ToolResponse {
  return { content: [{ type: "text", text: truncateSections(text) }] }
}

function wrapError(error: unknown, toolName?: string): ToolResponse {
  const resp = formatToolError(error, toolName)
  return {
    content: [{ type: "text", text: resp.content[0].type === "text" ? resp.content[0].text : String(error) }],
    isError: true,
  }
}

/**
 * 프리픽스(기반 탐색) 단계에서 데드라인이 만료된 체인의 부분 반환 (#150).
 * 그 시점까지 모은 섹션을 그대로 싣고 말미에 만료를 밝힌다 — 부분 결과는 유효한
 * 답이므로 isError 가 아니다(#131과 같은 계약).
 */
function expiredChainResult(parts: string[]): ToolResponse {
  return wrapResult([...parts, "", timedOutChainNotice()].join("\n"))
}

/**
 * 검색 → 상세조회 2단 갈래를 단계별로 데드라인과 경주시킨다 (#150).
 * 갈래 전체를 하나로 race 하면 상세 단계 만료가 이미 받은 검색 결과까지 폐기한다 —
 * 검색이 시간 안에 왔으면 싣고, 상세만 마커로 남긴다.
 * 검색 자체가 만료면 상세는 {ok:true, null}로 둔다 — 검색 마커가 이미 사유를 말하므로
 * 상세 마커까지 겹치면 같은 원인을 두 번 보고하게 된다.
 */
async function searchThenDetail(
  deadline: ChainDeadline,
  apiClient: LawApiClient,
  searchTool: string,
  search: () => Promise<CallResult>,
  apiKey?: string
): Promise<{ searchO: LegOutcome<CallResult>; detailO: LegOutcome<CallResult | null> }> {
  const searchO = await raceDeadline(deadline, search())
  if (!searchO.ok) return { searchO, detailO: { ok: true, value: null } }
  const detailO = await raceDeadline(
    deadline,
    fetchSearchDetailChain(apiClient, searchTool, searchO.value, { apiKey })
  )
  return { searchO, detailO }
}

/**
 * 체인 데드라인 틀 (2026-09-23 리뷰 B#13).
 * 데드라인 체인마다 같은 try/finally 사본이 있었고, 그 안에 #150 규칙이 담겨 있다: 기반 탐색(프리픽스)부터
 * 시계 안에서 돈다, 만료 뒤 던져진 오류는 그때까지 모은 섹션의 부분 반환으로 바꾼다, env 오류
 * (resolveChainDeadlineMs throw)도 wrapError 로 형식화한다, 타이머는 반드시 해제한다.
 * 체인을 늘릴 때 사본마다 어긋나지 않게 한 곳에 둔다.
 *
 * @param expiredParts 만료 시 싣는 머리글·섹션. 호출부가 채워 나가면 채운 만큼 실린다.
 */
async function withChainDeadline(
  expiredParts: string[],
  body: (deadline: ChainDeadline) => Promise<ToolResponse>
): Promise<ToolResponse> {
  let deadline: ChainDeadline | undefined
  try {
    deadline = startChainDeadline()
    const dl = deadline
    // 체인 전체를 데드라인 신호 아래에서 실행한다 — 만료 시 진행 중 업스트림
    // 요청이 함께 끊긴다. race 는 신호를 무시하는 업스트림에서도 벽시계를 묶는다.
    return await runWithRequestContext({ signal: dl.signal }, () => body(dl))
  } catch (error) {
    if (deadline?.expired()) return expiredChainResult(expiredParts)
    return wrapError(error)
  } finally {
    deadline?.dispose()
  }
}

/**
 * 데드라인과 경주한 갈래 하나를 싣는다 (#131·#150 규칙, 2026-09-23 리뷰 B#13).
 * 시간 안에 받았으면 싣고(실패면 secOrSkip 이 사유를 남긴다), 못 받았으면 마커를 단다.
 * 요청하지 않은 갈래(Promise.resolve(null))도 만료 뒤에 race 되면 {ok:false}가 되므로
 * requested 로 가린다: 안 시킨 조회에 타임아웃 마커를 달지 않는다.
 */
function pushLeg(
  parts: string[],
  outcome: LegOutcome<CallResult | null>,
  title: string,
  toolHint: string,
  requested = true
): void {
  if (!outcome.ok) {
    if (requested) parts.push(timedOutSection(title, toolHint))
    return
  }
  if (outcome.value) parts.push(secOrSkip(title, outcome.value))
}

/** 시나리오 갈래 조립. 규칙은 pushLeg 와 같다 (시나리오가 없으면 마커도 없다). */
function pushScenarioLeg(
  parts: string[],
  outcome: LegOutcome<ScenarioResult | null>,
  scenario: ScenarioType | null
): void {
  if (!outcome.ok) {
    if (scenario) parts.push(timedOutSection(`시나리오(${scenario})`, "legal_research"))
    return
  }
  if (outcome.value) {
    parts.push(formatSections(outcome.value.sections))
    parts.push(formatSuggestedActions(outcome.value.suggestedActions))
  }
}

// ========================================
// 1. chain_law_system -- 법체계 파악
// ========================================

export const chainLawSystemSchema = z.object({
  query: chainQuery("법령명 또는 키워드 (예: '관세법', '건축법 허가')"),
  articles: z.array(z.string()).optional().describe("조회할 조문 번호 (예: ['제38조', '제39조'])"),
  scenario: z.enum(["delegation", "impact"]).optional()
    .describe("확장 시나리오. delegation=위임입법 미이행 감시, impact=개정 영향도 분석. 미지정 시 쿼리에서 자동 감지."),
  apiKey: z.string().optional(),
})

export async function chainLawSystem(
  apiClient: LawApiClient,
  input: z.infer<typeof chainLawSystemSchema>
): Promise<ToolResponse> {
  // 기반 법령이 정해지면 네 갈래(3단비교·조문·별표·시나리오)는 서로를 기다릴 이유가 없는데 순차였고,
  // 데드라인도 없어 한 갈래가 매달리면(재시도 포함 최악 약 122초) 60초 클라이언트 한도 안에 아무것도
  // 못 받았다. action_basis 와 같은 데드라인+동시 갈래+부분 결과로 바꾼다 (2026-09-23 리뷰 B#7).
  // 출력 순서는 그대로다.
  const expiredHeader = [`═══ 법체계 확인: ${input.query} ═══`]
  return withChainDeadline(expiredHeader, async dl => {
    const baseO = await raceDeadline(dl, resolveChainBaseLaw(apiClient, input.query, input.apiKey))
    if (!baseO.ok) return expiredChainResult(expiredHeader)
    const laws = baseO.value.laws
    if (laws.length === 0) {
      // 만료로 탐색이 끊겨 비었을 수 있다. 그때 NOT_FOUND 는 "없다"는 거짓말이 된다
      if (dl.expired()) return expiredChainResult(expiredHeader)
      return noResult(input.query, baseO.value.attempts)
    }

    const p = laws[0]
    const parts = [
      `═══ 법체계 확인: ${p.lawName} ═══`,
      `법령ID: ${p.lawId} | MST: ${p.mst} | 구분: ${p.lawType}`,
    ]

    // 키워드 확장: 별표
    const exp = detectExpansions(input.query)
    const wantsAnnex = exp.includes("annex_fee") || exp.includes("annex_table") || exp.includes("annex_form")
    const wantsArticles = Boolean(input.articles?.length)
    // Scenario 확장
    const scenario = (input.scenario || detectScenario(input.query, "chain_law_system")) as ScenarioType | null

    const [threeTier, batch, annexes, sr] = await Promise.all([
      // 3단 비교
      raceDeadline(dl, callTool(getThreeTier, apiClient, { mst: p.mst, apiKey: input.apiKey })),
      // 조문 조회
      raceDeadline(dl, wantsArticles
        ? callTool(getBatchArticles, apiClient, { mst: p.mst, articles: input.articles, apiKey: input.apiKey })
        : Promise.resolve(null)),
      raceDeadline(dl, wantsAnnex
        ? callTool(getAnnexes, apiClient, { lawName: p.lawName, apiKey: input.apiKey })
        : Promise.resolve(null)),
      raceDeadline(dl, scenario
        ? runScenario(scenario, { apiClient, query: input.query, law: p, apiKey: input.apiKey } as ScenarioContext)
        : Promise.resolve(null)),
    ])

    pushLeg(parts, threeTier, "3단 비교 (법률·시행령·시행규칙)", "get_three_tier")
    pushLeg(parts, batch, "핵심 조문", "get_batch_articles", wantsArticles)
    pushLeg(parts, annexes, "별표/서식", "get_annexes", wantsAnnex)
    pushScenarioLeg(parts, sr, scenario)

    return wrapResult(parts.join("\n"))
  })
}

// ========================================
// 2. chain_action_basis -- 처분/허가 근거 확인
// ========================================

export const chainActionBasisSchema = z.object({
  query: chainQuery("처분 유형 + 키워드 (예: '건축허가 거부 근거', '보조금 환수')"),
  scenario: z.enum(["penalty"]).optional()
    .describe("확장 시나리오. penalty=처분·벌칙 기준 종합 (별표 처분기준표 + 감경 판례 + 개정이력). 미지정 시 쿼리에서 자동 감지."),
  apiKey: z.string().optional(),
})

export async function chainActionBasis(
  apiClient: LawApiClient,
  input: z.infer<typeof chainActionBasisSchema>
): Promise<ToolResponse> {
  // 데드라인은 기반 법령 탐색부터 묶는다 — 프리픽스가 시계 밖이면 5초 설정에
  // 19.5초를 실측했다(#150). 시계·만료·env 오류 형식화는 withChainDeadline 한 벌이 맡는다.
  const expiredHeader = [`═══ 처분 근거 확인: ${input.query} ═══`]
  return withChainDeadline(expiredHeader, async dl => {
    const baseO = await raceDeadline(dl, resolveChainBaseLaw(apiClient, input.query, input.apiKey))
    if (!baseO.ok) return expiredChainResult(expiredHeader)
    const laws = baseO.value.laws
    if (laws.length === 0) {
      // 만료로 탐색이 끊겨 비었을 수 있다 — 그때 NOT_FOUND 는 "없다"는 거짓말이 된다
      if (dl.expired()) return expiredChainResult(expiredHeader)
      return noResult(input.query, baseO.value.attempts)
    }

    const p = laws[0]
    const parts = [`═══ 처분 근거 확인: ${p.lawName} ═══`]

    const exp = detectExpansions(input.query)
    const scenario = (input.scenario || detectScenario(input.query, "chain_action_basis")) as ScenarioType | null
    const wantsAnnex = shouldFetchAnnexSeparately(exp, scenario)

    // 기반 법령이 정해지면 이후 4갈래는 서로를 기다릴 이유가 없다 — 전에는 순차라
    // 왕복이 그대로 누적됐다(실측 35초, 클라이언트 기본 타임아웃 60초에 근접)(#131).
    // 출력 순서는 조립 단계에서 그대로 지킨다.
    const searchQuery = p.lawName  // input.query는 AND 키워드 과다로 결과 없을 수 있음

    // 업스트림 꼬리는 병렬화로 못 막는다 — 시간이 다하면 받은 것까지 조립하고
    // 못 받은 자리는 마커로 남긴다(#131). 근거 갈래(검색→상세)는 단계별로 race —
    // 통짜로 race 하면 상세 만료가 이미 받은 검색 3종까지 폐기한다(#150).
    const [threeTier, interp, prec, appeal, annexes, sr] = await Promise.all([
      raceDeadline(dl, callTool(getThreeTier, apiClient, { mst: p.mst, apiKey: input.apiKey })),
      searchThenDetail(dl, apiClient, "search_interpretations",
        () => callTool(searchInterpretations, apiClient, { query: searchQuery, display: 5, apiKey: input.apiKey }),
        input.apiKey),
      searchThenDetail(dl, apiClient, "search_precedents",
        () => callTool(searchPrecedents, apiClient, { query: searchQuery, display: 5, apiKey: input.apiKey }),
        input.apiKey),
      searchThenDetail(dl, apiClient, "search_admin_appeals",
        () => callTool(searchAdminAppeals, apiClient, { query: searchQuery, display: 5, apiKey: input.apiKey }),
        input.apiKey),
      raceDeadline(dl, wantsAnnex
        ? callTool(getAnnexes, apiClient, { lawName: p.lawName, apiKey: input.apiKey })
        : Promise.resolve(null)),
      raceDeadline(dl, scenario
        ? runScenario(scenario, { apiClient, query: input.query, law: p, apiKey: input.apiKey } as ScenarioContext)
        : Promise.resolve(null)),
    ])

    pushLeg(parts, threeTier, "법령 체계 (법률·시행령·시행규칙)", "get_three_tier")

    pushLeg(parts, interp.searchO, "법령 해석례", "search_interpretations")
    pushLeg(parts, prec.searchO, "관련 판례", "search_decisions")
    pushLeg(parts, appeal.searchO, "행정심판례", "search_decisions")

    pushLeg(parts, interp.detailO, "법령 해석례 상세", "search_interpretations")
    pushLeg(parts, prec.detailO, "관련 판례 상세", "get_decision_text")
    pushLeg(parts, appeal.detailO, "행정심판례 상세", "get_decision_text")

    pushLeg(parts, annexes, "별표 (과태료/기준표)", "get_annexes", wantsAnnex)
    pushScenarioLeg(parts, sr, scenario)

    return wrapResult(parts.join("\n"))
  })
}

// ========================================
// 3. chain_dispute_prep -- 불복/쟁송 대비
// ========================================

export const chainDisputePrepSchema = z.object({
  query: chainQuery("분쟁 키워드 (예: '건축허가 취소 행정심판', '징계처분 감경')"),
  domain: z.enum(["tax", "labor", "privacy", "competition", "general"]).optional()
    .describe("전문 분야 (tax=조세심판, labor=노동위, privacy=개인정보위, competition=공정위). 미지정 시 쿼리에서 자동 감지"),
  apiKey: z.string().optional(),
})

/** 쟁송 대비 체인의 도메인별 전문 결정례 갈래 — 검색 핸들러·상세조회 도구·표시명 한 벌 */
const DISPUTE_DOMAIN_SEARCH: Partial<Record<DomainType | "general", {
  handler: Parameters<typeof callTool>[0]
  searchTool: string
  label: string
}>> = {
  tax: { handler: searchTaxTribunalDecisions, searchTool: "search_tax_tribunal_decisions", label: "조세심판원 결정" },
  labor: { handler: searchNlrcDecisions, searchTool: "search_nlrc_decisions", label: "중앙노동위 결정" },
  privacy: { handler: searchPipcDecisions, searchTool: "search_pipc_decisions", label: "개인정보위 결정" },
}

export async function chainDisputePrep(
  apiClient: LawApiClient,
  input: z.infer<typeof chainDisputePrepSchema>
): Promise<ToolResponse> {
  // 이 체인은 검색 뒤 상세조회가 순차 사다리라 한 갈래의 꼬리가 전체를 인질로 잡았다 —
  // action_basis·full_research 와 같은 데드라인+부분 결과 패턴을 적용한다(#150)
  const parts = [`═══ 쟁송 대비: ${input.query} ═══`]
  return withChainDeadline(parts, async dl => {
    const domain = input.domain || detectDomain(input.query) || "general"
    const domainSearch = DISPUTE_DOMAIN_SEARCH[domain]
    const exp = detectExpansions(input.query)

    // 판례는 구조화 hit 기반 상세조회까지 한 경로(searchPrecedentsForChain)라 통짜로,
    // 나머지 검색→상세 갈래는 단계별로 race 한다. 출력 순서는 조립에서 지킨다.
    const [precedentO, appeal, domainR, interp] = await Promise.all([
      raceDeadline(dl, searchPrecedentsForChain(
        apiClient,
        { query: input.query, display: 8, apiKey: input.apiKey },
        { route: routeQuery(input.query) }
      )),
      searchThenDetail(dl, apiClient, "search_admin_appeals",
        () => callTool(searchAdminAppeals, apiClient, { query: input.query, display: 8, apiKey: input.apiKey }),
        input.apiKey),
      domainSearch
        ? searchThenDetail(dl, apiClient, domainSearch.searchTool,
            () => callTool(domainSearch.handler, apiClient, { query: input.query, display: 5, apiKey: input.apiKey }),
            input.apiKey)
        : Promise.resolve(null),
      exp.includes("interpretation")
        ? searchThenDetail(dl, apiClient, "search_interpretations",
            () => callTool(searchInterpretations, apiClient, { query: input.query, display: 5, apiKey: input.apiKey }),
            input.apiKey)
        : Promise.resolve(null),
    ])

    if (precedentO.ok) parts.push(secOrSkip("대법원 판례", precedentO.value.searchResult))
    else parts.push(timedOutSection("대법원 판례", "search_decisions"))
    pushLeg(parts, appeal.searchO, "행정심판례", "search_decisions")

    if (precedentO.ok && precedentO.value.detailResult) {
      parts.push(secOrSkip("대법원 판례 상세", precedentO.value.detailResult))
    }
    pushLeg(parts, appeal.detailO, "행정심판례 상세", "get_decision_text")

    if (domainR && domainSearch) {
      pushLeg(parts, domainR.searchO, domainSearch.label, domainSearch.searchTool)
      pushLeg(parts, domainR.detailO, `${domainSearch.label} 상세`, "get_decision_text")
    }

    if (interp) {
      pushLeg(parts, interp.searchO, "법령 해석례", "search_interpretations")
      pushLeg(parts, interp.detailO, "법령 해석례 상세", "search_interpretations")
    }

    return wrapResult(parts.join("\n"))
  })
}

// ========================================
// 4. chain_amendment_track -- 개정 추적
// ========================================

export const chainAmendmentTrackSchema = z.object({
  query: chainQuery("법령명 (예: '관세법', '지방세특례제한법')"),
  mst: z.string().optional().describe("법령일련번호 (알고 있으면)"),
  lawId: z.string().optional().describe("법령ID (알고 있으면)"),
  scenario: z.enum(["timeline", "time_travel"]).optional()
    .describe("확장 시나리오. timeline=시계열 타임라인(판례·해석례 매핑) | time_travel=두 시점 본문 자동 diff(v4.0, fromDate/toDate 필요). 미지정 시 쿼리에서 자동 감지."),
  fromDate: z.string().regex(/^\d{8}$/).optional()
    .describe("[time_travel 전용] 비교 시작 시점 YYYYMMDD (예: '20240101')"),
  toDate: z.string().regex(/^\d{8}$/).optional()
    .describe("[time_travel 전용] 비교 종료 시점 YYYYMMDD (예: '20251101')"),
  includeHistory: z.boolean().optional().default(false)
    .describe("조문별 개정 이력(제정 시점부터 조문×개정 전건)을 함께 실을지. 기본 false — 실무에서 필요한 건 대개 최근 개정의 신구대조인데, 이 섹션이 응답 상한을 먼저 소진해 신구대조표가 잘린다 (#158)"),
  apiKey: z.string().optional(),
})

export async function chainAmendmentTrack(
  apiClient: LawApiClient,
  input: z.infer<typeof chainAmendmentTrackSchema>
): Promise<ToolResponse> {
  // 신구대조·이력·시나리오는 법령이 정해지면 서로 독립인데 순차였고 데드라인도 없었다.
  // 데드라인+동시 갈래+부분 결과로 바꾼다 (2026-09-23 리뷰 B#7). 출력 순서는 그대로다.
  const expiredHeader = [`═══ 개정 추적: ${input.query} ═══`]
  return withChainDeadline(expiredHeader, async dl => {
    let mst = input.mst
    let lawId = input.lawId
    let lawName = input.query

    // 법령 검색 (MST 모르면)
    if (!mst && !lawId) {
      const baseO = await raceDeadline(dl, resolveChainBaseLaw(apiClient, input.query, input.apiKey, 1))
      if (!baseO.ok) return expiredChainResult(expiredHeader)
      const laws = baseO.value.laws
      if (laws.length === 0) {
        if (dl.expired()) return expiredChainResult(expiredHeader)
        return noResult(input.query, baseO.value.attempts)
      }
      mst = laws[0].mst
      lawId = laws[0].lawId
      lawName = laws[0].lawName
    }

    const parts = [`═══ 개정 추적: ${lawName} ═══`]
    const id: Record<string, string> = mst ? { mst } : { lawId: lawId! }

    // 조문별 개정 이력 (lawId 필요, opt-in)
    // 제정 시점부터 전건을 나열해 5만 자 상한을 혼자 소진한다(산업안전보건법 1981~ = 4.9만 자
    // → 2.4만 자로 절단). 등록부를 연속 처리하는 준법 감시에서는 대개 잉여라 기본은 끈다 (#158).
    const wantsHistory = Boolean(lawId && input.includeHistory)

    // Scenario 확장
    const scenario = (input.scenario || detectScenario(input.query, "chain_amendment_track")) as ScenarioType | null
    const law = mst ? { lawName, lawId: lawId || "", mst, lawType: "" } : undefined
    const extras: Record<string, unknown> = {}
    if (input.fromDate) extras.fromDate = input.fromDate
    if (input.toDate) extras.toDate = input.toDate

    const [oldNew, history, sr] = await Promise.all([
      raceDeadline(dl, callTool(compareOldNew, apiClient, { ...id, apiKey: input.apiKey })),
      raceDeadline(dl, wantsHistory
        ? callTool(getArticleHistory, apiClient, { lawId, apiKey: input.apiKey })
        : Promise.resolve(null)),
      raceDeadline(dl, scenario
        ? runScenario(scenario, { apiClient, query: input.query, law, apiKey: input.apiKey, extras } as ScenarioContext)
        : Promise.resolve(null)),
    ])

    // Step 1: 신구대조표
    pushLeg(parts, oldNew, "신구대조표 (최근 개정)", "compare_old_new")

    // Step 2: 조문별 개정 이력
    if (lawId) {
      if (input.includeHistory) {
        pushLeg(parts, history, "조문별 개정 이력", "get_article_history")
      } else {
        parts.push(`\n[조문별 개정 이력 생략] 제정 시점부터의 조문×개정 전건이라 응답 상한을 소진합니다. ` +
          `필요하면 includeHistory=true 또는 get_article_history(lawId="${lawId}").`)
      }
    }

    pushScenarioLeg(parts, sr, scenario)

    return wrapResult(parts.join("\n"))
  })
}

// ========================================
// 5. chain_ordinance_compare -- 조례 비교 연구
// ========================================

export const chainOrdinanceCompareSchema = z.object({
  query: chainQuery("조례 관련 키워드 (예: '주민자치회', '개발행위 허가 기준')"),
  parentLaw: z.string().optional().describe("상위 법령명 (예: '지방자치법'). 미지정 시 자동 검색."),
  scenario: z.enum(["compliance"]).optional()
    .describe("확장 시나리오. compliance=조례 상위법 적합성 검증 (헌재·행심 위법 판결 + 상위법 근거 분석). 미지정 시 쿼리에서 자동 감지."),
  apiKey: z.string().optional(),
})

export async function chainOrdinanceCompare(
  apiClient: LawApiClient,
  input: z.infer<typeof chainOrdinanceCompareSchema>
): Promise<ToolResponse> {
  // 상위법·조례·해석례·시나리오 갈래는 서로 독립인데 순차였고 데드라인도 없었다.
  // 데드라인+동시 갈래+부분 결과로 바꾼다 (2026-09-23 리뷰 B#7). 출력 순서는 그대로다.
  const parts = [`═══ 조례 비교 연구: ${input.query} ═══`]
  return withChainDeadline(parts, async dl => {
    // Step 1: 상위 법령 확인 (조례/지역명은 법령 검색에서 제거)
    const parentQuery = input.parentLaw || stripOrdinanceKeywords(input.query)
    // 상위 법령은 보조 갈래다. 검색 장애가 던지면 조례 검색까지 체인 전체가 wrapError 로 죽던 것을
    // 이 섹션의 실패 마커로 가둔다 (2026-09-23 리뷰 B#11)
    const parentP = (async (): Promise<{ laws: LawInfo[]; failure?: CallResult }> => {
      if (!parentQuery) return { laws: [] }
      try {
        return { laws: await findLaws(apiClient, parentQuery, input.apiKey, 2) }
      } catch (error) {
        if (getRequestSignal()?.aborted) throw error
        return { laws: [], failure: errorCallResult(error, "search_law") }
      }
    })()

    // Step 2: 조례 검색 — "조례"/"규칙" 제거 (이미 조례 DB에서 검색하므로)
    const ordinanceQuery = input.query.replace(/\s*(조례|규칙|자치법규)\s*/g, " ").trim() || input.query

    // 키워드 확장
    const exp = detectExpansions(input.query)
    const wantsInterp = exp.includes("interpretation")

    // Scenario 확장 (ctx.law 는 상위 법령 결과를 받아 넘긴다)
    const scenario = (input.scenario || detectScenario(input.query, "chain_ordinance_compare")) as ScenarioType | null

    const [parentO, threeTierO, ordinance, interpO, srO] = await Promise.all([
      raceDeadline(dl, parentP),
      // 3단 비교 (위임 근거 확인)
      raceDeadline(dl, parentP.then(r => r.laws.length > 0
        ? callTool(getThreeTier, apiClient, { mst: r.laws[0].mst, apiKey: input.apiKey })
        : null)),
      (async () => {
        const none: LegOutcome<CallResult | null> = { ok: true, value: null }
        const searchO = await raceDeadline(dl,
          callTool(searchOrdinance, apiClient, { query: ordinanceQuery, display: 20, apiKey: input.apiKey }))
        if (!searchO.ok || searchO.value.isError) return { searchO, detailO: none }
        // Step 3: 상위 1건 전문 자동 조회
        // 자치법규일련번호 추출: "[숫자]" 패턴 (search_ordinance 출력의 "[일련번호] 법규명" 형식)
        const seqMatch = searchO.value.text.match(/\[(\d{5,})\]/)
        if (!seqMatch) return { searchO, detailO: none }
        const detailO = await raceDeadline(dl,
          callTool(getOrdinance, apiClient, { ordinSeq: seqMatch[1], apiKey: input.apiKey }))
        return { searchO, detailO }
      })(),
      raceDeadline(dl, wantsInterp
        ? callTool(searchInterpretations, apiClient, { query: input.query, display: 5, apiKey: input.apiKey })
        : Promise.resolve(null)),
      raceDeadline(dl, scenario
        ? parentP.then(r => runScenario(scenario, {
            apiClient,
            query: input.query,
            law: r.laws.length > 0 ? r.laws[0] : undefined,
            apiKey: input.apiKey,
          } as ScenarioContext))
        : Promise.resolve(null)),
    ])

    if (!parentO.ok) {
      if (parentQuery) parts.push(timedOutSection("상위 법령", "search_law"))
    } else if (parentO.value.failure) {
      parts.push(secOrSkip("상위 법령", parentO.value.failure))
    } else if (parentO.value.laws.length > 0) {
      const p = parentO.value.laws[0]
      parts.push(sec("상위 법령", `${p.lawName} (${p.lawType}) | MST: ${p.mst}`))
      pushLeg(parts, threeTierO, "위임 체계 (법률·시행령·시행규칙)", "get_three_tier")
    }

    pushLeg(parts, ordinance.searchO, "전국 자치법규 검색 결과", "search_ordinance")
    pushLeg(parts, ordinance.detailO, "조례 전문 (상위 1건)", "get_ordinance")
    pushLeg(parts, interpO, "법령 해석례", "search_interpretations", wantsInterp)
    pushScenarioLeg(parts, srO, scenario)

    return wrapResult(parts.join("\n"))
  })
}

// ========================================
// 6. chain_full_research -- 종합 리서치
// ========================================

export const chainFullResearchSchema = z.object({
  query: chainQuery("자연어 질문 (예: '기간제 근로자 2년 초과 사용', '음주운전 처벌 기준', '전세금 못 받았어')"),
  scenario: z.enum(["customs", "action_plan"]).optional()
    .describe("확장 시나리오. customs=관세·통관 종합 | action_plan=이럴 땐 이렇게, 5단계 안내(v4.0, 진단→권리→기관/기한→서류→함정). 미지정 시 쿼리에서 자동 감지."),
  apiKey: z.string().optional(),
})

export async function chainFullResearch(
  apiClient: LawApiClient,
  input: z.infer<typeof chainFullResearchSchema>
): Promise<ToolResponse> {
  // 체인 전체를 덮는 시계 — Step 1(기반 검색)부터 신호 아래 묶는다. 프리픽스가 시계
  // 밖이면 5초 설정에 19.5초를 실측했고, 만료 뒤에 시작한 tail race 가 요청도 안 한
  // 갈래에 가짜 마커를 달았다(#150). 만료 시 그때까지 모은 섹션으로 부분 반환한다.
  const parts = [`═══ 종합 리서치: ${input.query} ═══`]
  return withChainDeadline(parts, async dl => {
    // Step 1: AI 검색 + 법령 검색 + 해석례를 병렬 실행하고, 판례는 AI 구조화 신호를 받은 뒤 공통 core로 검색한다.
    // AI 검색은 한 번만 친다. 기반 법령 탐색 3단계(의미검색)가 같은 질의로 다시 치던 것을 이 결과로
    // 넘겨받는다 (2026-09-23 리뷰 B#10). 그 단계는 종전처럼 상위 5건의 법령명만 본다.
    const aiP = callAiLaw(apiClient, { query: input.query, search: "0", display: 10, page: 1, apiKey: input.apiKey })
    const aiSignals = aiP.then(r => (r.aiLawArticles || []).filter(s => s.sourceIndex < 5), () => [])
    // 기반 법령 검색 장애를 "관련 법령 없음"으로 삼키지 않는다. 본문·별표 갈래가 조용히 빠지던 것을
    // 실패 마커로 밝힌다 (B#11). throw 는 Promise.all 전체를 죽이므로 결과로 돌려준다.
    const findBaseLaws = async (): Promise<{ laws: LawInfo[]; failure?: CallResult }> => {
      try {
        return { laws: (await resolveChainBaseLaw(apiClient, input.query, input.apiKey, 2, { aiSignals })).laws }
      } catch (error) {
        if (getRequestSignal()?.aborted) throw error
        return { laws: [], failure: errorCallResult(error, "search_law") }
      }
    }
    const step1 = await raceDeadline(dl, Promise.all([
      aiP,
      findBaseLaws(),
      callTool(searchInterpretations, apiClient, { query: input.query, display: 5, apiKey: input.apiKey }),
    ]))
    if (!step1.ok) return expiredChainResult(parts)
    const [aiResult, base, interpResult] = step1.value
    const { reliableLaws: lawsResult, textLaw, lowConfidence } = selectLawTextSource(base.laws, input.query)

    // Scenario 확장
    const scenario = (input.scenario || detectScenario(input.query, "chain_full_research")) as ScenarioType | null

    // 키워드 확장 — 시나리오(customs·action_plan)가 같은 법령의 별표를 이미 싣는다면 생략(#131).
    // 이 체인은 서식(annex_form)도 같은 조회로 받으므로 함께 가린다
    const exp = detectExpansions(input.query)
    const providesAnnex = scenarioProvides(scenario).includes("annex")
    const wantsAnnex = lawsResult.length > 0 &&
      (shouldFetchAnnexSeparately(exp, scenario) || (exp.includes("annex_form") && !providesAnnex))

    // Step 1 이후 갈래(본문·판례·해석례 상세·별표·시나리오)는 서로 독립이다. 종전엔 본문 → 판례 → 나머지
    // 순차였고, 본문·판례 단계에서 만료되면 Step 1 에 이미 받은 해석례까지 버린 채 "위까지가 시간 안에
    // 받은 전부"라고 밝혔다 (2026-09-23 리뷰 B#4·B#8). 함께 띄우고, 싣는 순서는 종전 그대로 지킨다.
    const [lawTextO, bundleO, interpDetailO, annexO, srO] = await Promise.all([
      raceDeadline(dl, textLaw
        ? callTool(getLawText, apiClient, { mst: textLaw.mst, apiKey: input.apiKey })
        : Promise.resolve(null)),
      raceDeadline(dl, searchPrecedentsForChain(
        apiClient,
        { query: input.query, display: 5, apiKey: input.apiKey },
        {
          aiLawArticles: aiResult.aiLawArticles,
          route: routeQuery(input.query),
          maxFallbackAttempts: PRECEDENT_FALLBACK_LIMIT,
        }
      )),
      raceDeadline(dl,
        fetchSearchDetailChain(apiClient, "search_interpretations", interpResult, { apiKey: input.apiKey })),
      raceDeadline(dl, wantsAnnex
        ? callTool(getAnnexes, apiClient, { lawName: lawsResult[0].lawName, apiKey: input.apiKey })
        : Promise.resolve(null)),
      raceDeadline(dl, scenario
        ? runScenario(scenario, {
            apiClient,
            query: input.query,
            law: lawsResult.length > 0 ? lawsResult[0] : undefined,
            apiKey: input.apiKey,
          } as ScenarioContext)
        : Promise.resolve(null)),
    ])

    parts.push(secOrSkip("AI 법령검색 결과", aiResult))

    // 법령 본문 (첫 번째 결과)
    if (base.failure) parts.push(secOrSkip("법령 본문 (기반 법령 검색)", base.failure))
    if (textLaw) {
      const confidenceSuffix = lowConfidence ? " (관련도 낮음)" : ""
      pushLeg(parts, lawTextO, `${textLaw.lawName} 본문${confidenceSuffix}`, "get_law_text")
    }

    if (bundleO.ok) parts.push(secOrSkip("관련 판례", bundleO.value.searchResult))
    else parts.push(timedOutSection("관련 판례", "search_decisions"))
    parts.push(secOrSkip("법령 해석례", interpResult))

    // 판례 상세는 판례 검색과 한 경로다. 검색이 만료됐으면 검색 마커가 사유를 이미 말한다
    if (bundleO.ok && bundleO.value.detailResult) parts.push(secOrSkip("관련 판례 상세", bundleO.value.detailResult))
    pushLeg(parts, interpDetailO, "법령 해석례 상세", "search_interpretations")
    pushLeg(parts, annexO, "별표/서식", "get_annexes", wantsAnnex)
    pushScenarioLeg(parts, srO, scenario)

    return wrapResult(parts.join("\n"))
  })
}

// ========================================
// 7. chain_procedure_detail -- 절차/비용/서식
// ========================================

export const chainProcedureDetailSchema = z.object({
  query: chainQuery("절차/비용 관련 질문 (예: '여권발급 절차 수수료', '건축허가 신청 방법')"),
  scenario: z.enum(["manual"]).optional()
    .describe("확장 시나리오. manual=공무원 처리 매뉴얼 (행정규칙 + 자치법규 특칙 + 해석례 추가). 미지정 시 쿼리에서 자동 감지."),
  apiKey: z.string().optional(),
})

export async function chainProcedureDetail(
  apiClient: LawApiClient,
  input: z.infer<typeof chainProcedureDetailSchema>
): Promise<ToolResponse> {
  // 3단비교·별표 2종·AI 보완·시나리오는 법령이 정해지면 서로 독립인데 순차였고 데드라인도 없었다.
  // 데드라인+동시 갈래+부분 결과로 바꾼다 (2026-09-23 리뷰 B#7). 출력 순서는 그대로다.
  const parts = [`═══ 절차/비용 안내: ${input.query} ═══`]
  return withChainDeadline(parts, async dl => {
    // AI 검색은 한 번만 친다. 보완 정보 섹션(Step 4)과 기반 법령 탐색 3단계(의미검색)가 같은 요청
    // (display 5)을 두 번 보냈다 (2026-09-23 리뷰 B#10). 미리 띄워 두고 두 곳이 나눠 쓴다.
    const aiP = callAiLaw(apiClient, { query: input.query, search: "0", display: 5, page: 1, apiKey: input.apiKey })
    // 기반 법령을 못 찾아 일찍 돌아가면 aiP 를 아무도 기다리지 않는다. 거부가 미처리로 남지 않게 붙여 둔다
    void aiP.catch(() => {})
    const aiSignals = aiP.then(r => r.aiLawArticles || [], () => [])

    // Step 1: 법령 검색
    const baseO = await raceDeadline(dl, resolveChainBaseLaw(apiClient, input.query, input.apiKey, 3, { aiSignals }))
    if (!baseO.ok) return expiredChainResult(parts)
    const laws = baseO.value.laws
    if (laws.length === 0) {
      if (dl.expired()) return expiredChainResult(parts)
      return noResult(input.query, baseO.value.attempts)
    }

    const p = laws[0]
    parts.push(`법령: ${p.lawName} (${p.lawType}) | MST: ${p.mst}`)

    // Scenario 확장
    const scenario = (input.scenario || detectScenario(input.query, "chain_procedure_detail")) as ScenarioType | null

    const [threeTier, annexFee, annexForm, aiResult, sr] = await Promise.all([
      // Step 2: 3단 비교 (절차 체계 파악)
      raceDeadline(dl, callTool(getThreeTier, apiClient, { mst: p.mst, apiKey: input.apiKey })),
      // Step 3: 별표(수수료/과태료) + 서식(신청서) 병렬
      raceDeadline(dl, callTool(getAnnexes, apiClient, { lawName: p.lawName, apiKey: input.apiKey })),
      // 시행규칙에도 별표가 있을 수 있으므로 시행규칙명으로도 시도
      raceDeadline(dl, (async (): Promise<CallResult> => {
        const ruleNameCandidates = [
          p.lawName.replace(/법$/, '법 시행규칙'),
          p.lawName.replace(/법$/, '법 시행령'),
        ].filter(name => name !== p.lawName)
        try {
          for (const candidate of ruleNameCandidates) {
            const rules = await findLaws(apiClient, candidate, input.apiKey, 1)
            if (rules.length > 0) {
              return await callTool(getAnnexes, apiClient, { lawName: rules[0].lawName, apiKey: input.apiKey })
            }
          }
        } catch (error) {
          // 보조 갈래의 법령 검색 장애가 체인 전체를 죽이지 않게 이 섹션의 실패로 가둔다 (B#11)
          if (getRequestSignal()?.aborted) throw error
          return errorCallResult(error, "search_law")
        }
        return { text: "", isError: true }
      })()),
      // Step 4: AI 검색으로 보완 (절차 상세)
      raceDeadline(dl, aiP),
      raceDeadline(dl, scenario
        ? runScenario(scenario, { apiClient, query: input.query, law: p, apiKey: input.apiKey } as ScenarioContext)
        : Promise.resolve(null)),
    ])

    pushLeg(parts, threeTier, "법령 체계 (절차 근거)", "get_three_tier")
    pushLeg(parts, annexFee, `${p.lawName} 별표/서식`, "get_annexes")
    if (!annexForm.ok) parts.push(timedOutSection("시행규칙 별표/서식", "get_annexes"))
    else if (annexForm.value.text || annexForm.value.isError) parts.push(secOrSkip("시행규칙 별표/서식", annexForm.value))
    pushLeg(parts, aiResult, "AI 검색 보완 정보", "search_ai_law")
    pushScenarioLeg(parts, sr, scenario)

    return wrapResult(parts.join("\n"))
  })
}

// ========================================
// 8. chain_document_review -- 문서 종합 검토
// ========================================

export const chainDocumentReviewSchema = z.object({
  text: z.string().describe("분석할 계약서/약관 전문 텍스트"),
  maxClauses: z.number().min(1).max(30).default(15).describe("분석할 최대 조항 수 (기본:15)"),
  apiKey: z.string().optional(),
})

export async function chainDocumentReview(
  apiClient: LawApiClient,
  input: z.infer<typeof chainDocumentReviewSchema>
): Promise<ToolResponse> {
  try {
    throwIfRequestCancelled()
    const parts = [`═══ 문서 종합 검토 ═══`]

    // Step 1: analyze_document 로 리스크 분석
    const analysisResult = await callTool(analyzeDocument, apiClient, {
      text: input.text,
      maxClauses: input.maxClauses,
    })

    if (analysisResult.isError) {
      return { content: [{ type: "text", text: analysisResult.text }], isError: true }
    }

    parts.push(sec("문서 리스크 분석", analysisResult.text))

    // Step 2: 분석 결과에서 searchHints 추출 → 병렬로 법령+판례 검색
    const searchHints = extractSearchHints(analysisResult.text)

    if (searchHints.length === 0) {
      parts.push("\n▶ 추가 법령/판례 검색\n특별한 리스크가 없어 추가 검색을 생략합니다.\n")
      return wrapResult(parts.join("\n"))
    }

    // 중복 제거 후 최대 5개 힌트로 제한
    const uniqueHints = [...new Set(searchHints)].slice(0, 5)
    // AI 법령 검색은 상위 3개 힌트로 병렬 실행
    const lawHints = uniqueHints.slice(0, 3)
    // 검증이 받은 판례 상세를 뒤의 근거 조회가 다시 받지 않게 이 호출 안에서 공유한다 (B#10)
    const detailMemo: PrecedentDetailMemo = new Map()

    // 판례 검색과 AI 법령 검색은 서로 독립이다. 종전엔 판례 사다리 5개가 모두 끝난 뒤에야 법령 검색을
    // 시작했다 (2026-09-23 리뷰 B#11). 함께 띄우고, 싣는 순서(판례 → 법령)는 아래 조립에서 지킨다.
    const [precedentSearches, lawResults] = await Promise.all([
      Promise.all(
        uniqueHints.map(hint => safeSearchPrecedentsStructured(apiClient, {
          query: hint,
          display: 3,
          page: 1,
          apiKey: input.apiKey,
        }, {
          documentHints: [hint],
          maxFallbackAttempts: 3,
          validateResult: validation => validatePrecedentSearchResult(apiClient, validation, { apiKey: input.apiKey, detailMemo }),
        }))
      ),
      Promise.all(
        lawHints.map(hint => callTool(searchAiLaw, apiClient, { query: hint, display: 3, apiKey: input.apiKey }))
      ),
    ])
    throwIfRequestCancelled()
    const precedentResults = precedentSearches.map(search => search.result)

    // 판례 결과 합산
    const precTexts: string[] = []
    for (let i = 0; i < uniqueHints.length; i++) {
      const r = precedentResults[i]
      if (r.hits.length > 0) {
        precTexts.push(`[${uniqueHints[i]}]\n${renderPrecedentSearchResult(r)}`)
      }
    }
    if (precTexts.length > 0) {
      parts.push(sec("관련 판례", precTexts.join("\n\n")))
    }
    const precedentErrors = precedentSearches
      .map((search, index) => search.error ? `[${uniqueHints[index]}]\n${search.error.text}` : "")
      .filter(text => text.trim())
    if (precedentErrors.length > 0) {
      parts.push(secOrSkip("판례 검색 실패", {
        text: precedentErrors.join("\n\n"),
        isError: true,
      }))
    }

    const combinedPrecedents = combineStructuredPrecedentResults(precedentResults)
    if (combinedPrecedents) {
      const precedentEvidence = await fetchPrecedentEvidence(apiClient, combinedPrecedents, {
        apiKey: input.apiKey,
        detailLimit: 2,
        full: false,
        detailMemo,
      })
      if (precedentEvidence) {
        parts.push(secOrSkip("관련 판례 상세", {
          text: precedentEvidence.text,
          isError: precedentEvidence.isError,
        }))
      }
    }

    // 법령 결과 합산
    const lawTexts: string[] = []
    const lawErrors: string[] = []
    for (let i = 0; i < lawHints.length; i++) {
      const r = lawResults[i]
      if (!r.isError && r.text.trim()) {
        lawTexts.push(`[${lawHints[i]}]\n${r.text}`)
      } else if (r.isError && !/\[NOT_FOUND\]/.test(r.text)) {
        // 0건([NOT_FOUND])은 종전대로 생략하되, 검색 장애는 판례 쪽처럼 밝힌다. 섹션이 조용히
        // 빠지면 "근거 법령 없음"으로 읽힌다 (2026-09-23 리뷰 B#11)
        lawErrors.push(`[${lawHints[i]}]\n${r.text}`)
      }
    }
    if (lawTexts.length > 0) {
      parts.push(sec("근거 법령", lawTexts.join("\n\n")))
    }
    if (lawErrors.length > 0) {
      parts.push(secOrSkip("근거 법령 검색 실패", {
        text: lawErrors.join("\n\n"),
        isError: true,
      }))
    }

    return wrapResult(parts.join("\n"))
  } catch (error) {
    return wrapError(error)
  }
}

/** analyze_document 결과 텍스트에서 "검색: ..." 라인의 힌트를 추출 */
function extractSearchHints(analysisText: string): string[] {
  const hints: string[] = []
  const lines = analysisText.split("\n")
  for (const line of lines) {
    const m = line.match(/^\s*검색:\s*(.+)$/)
    if (m) {
      const hintParts = m[1].split(/\s*\/\s*/)
      for (const p of hintParts) {
        const trimmed = p.trim()
        if (trimmed) hints.push(trimmed)
      }
    }
  }
  return hints
}
