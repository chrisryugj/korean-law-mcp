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
  stripNonLawKeywords as _unused1,
  NON_LAW_NAME_RE,
  type LawInfo,
} from "../lib/law-search.js"
// chains.ts 내부 헬퍼가 참조하던 NON_LAW_NAME_RE만 유지 (stripNonLawKeywords는 findLaws 내부에서 사용)
void _unused1
import { runScenario, detectScenario, formatSections, formatSuggestedActions } from "./scenarios/index.js"
import type { ScenarioType, ScenarioContext } from "./scenarios/index.js"

// Tool handler imports
import { analyzeDocument } from "./document-analysis.js"
import { getThreeTier } from "./three-tier.js"
import { getBatchArticles } from "./batch-articles.js"
import { searchPrecedents } from "./precedents.js"
import { summarizePrecedent } from "./precedent-summary.js"
import { searchInterpretations } from "./interpretations.js"
import { searchAdminAppeals } from "./admin-appeals.js"
import { compareOldNew } from "./comparison.js"
import { getArticleHistory } from "./article-history.js"
import { searchOrdinance } from "./ordinance-search.js"
import { getOrdinance } from "./ordinance.js"
import { getAnnexes } from "./annex.js"
import { searchAiLaw } from "./life-law.js"
import { getLawText } from "./law-text.js"
import { searchTaxTribunalDecisions } from "./tax-tribunal-decisions.js"
import { searchNlrcDecisions, searchPipcDecisions } from "./committee-decisions.js"

// ========================================
// Types
// ========================================

interface CallResult {
  text: string
  isError: boolean
}

type DomainType = "customs" | "tax" | "labor" | "privacy" | "competition"

type ExpansionType = "annex_fee" | "annex_form" | "annex_table" | "precedent" | "interpretation"

// ========================================
// Helpers
// ========================================

async function callTool(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (apiClient: LawApiClient, input: any) => Promise<LooseToolResponse>,
  apiClient: LawApiClient,
  input: Record<string, unknown>
): Promise<CallResult> {
  try {
    const result = await handler(apiClient, input)
    return { text: result.content?.[0]?.text || "", isError: !!result.isError }
  } catch (e) {
    return { text: `오류: ${e instanceof Error ? e.message : String(e)}`, isError: true }
  }
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

function noResult(query: string): ToolResponse {
  const keywords = query.trim().split(/\s+/)
  const lines = [`[NOT_FOUND] '${query}' 관련 법령을 찾을 수 없습니다.`]
  lines.push("")
  lines.push("⚠️ 이 체인은 기반 법령을 찾지 못해 실행을 중단했습니다. LLM은 법령·조문·판례를 추측/생성하지 마세요. 사용자에게 '검색 실패'를 명시 보고하세요.")
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

// ========================================
// 1. chain_law_system -- 법체계 파악
// ========================================

export const chainLawSystemSchema = z.object({
  query: z.string().describe("법령명 또는 키워드 (예: '관세법', '건축법 허가')"),
  articles: z.array(z.string()).optional().describe("조회할 조문 번호 (예: ['제38조', '제39조'])"),
  scenario: z.enum(["delegation", "impact"]).optional()
    .describe("확장 시나리오. delegation=위임입법 미이행 감시, impact=개정 영향도 분석. 미지정 시 쿼리에서 자동 감지."),
  apiKey: z.string().optional(),
})

export async function chainLawSystem(
  apiClient: LawApiClient,
  input: z.infer<typeof chainLawSystemSchema>
): Promise<ToolResponse> {
  try {
    const laws = await findLaws(apiClient, input.query, input.apiKey)
    if (laws.length === 0) return noResult(input.query)

    const p = laws[0]
    const parts = [
      `═══ 법체계 확인: ${p.lawName} ═══`,
      `법령ID: ${p.lawId} | MST: ${p.mst} | 구분: ${p.lawType}`,
    ]

    // 3단 비교
    const threeTier = await callTool(getThreeTier, apiClient, { mst: p.mst, apiKey: input.apiKey })
    parts.push(secOrSkip("3단 비교 (법률·시행령·시행규칙)", threeTier))

    // 조문 조회
    if (input.articles?.length) {
      const batch = await callTool(getBatchArticles, apiClient, {
        mst: p.mst,
        articles: input.articles,
        apiKey: input.apiKey,
      })
      parts.push(secOrSkip("핵심 조문", batch))
    }

    // 키워드 확장: 별표
    const exp = detectExpansions(input.query)
    if (exp.includes("annex_fee") || exp.includes("annex_table") || exp.includes("annex_form")) {
      const annexes = await callTool(getAnnexes, apiClient, { lawName: p.lawName, apiKey: input.apiKey })
      parts.push(secOrSkip("별표/서식", annexes))
    }

    // Scenario 확장
    const scenario = (input.scenario || detectScenario(input.query, "chain_law_system")) as ScenarioType | null
    if (scenario) {
      const ctx: ScenarioContext = { apiClient, query: input.query, law: p, apiKey: input.apiKey }
      const sr = await runScenario(scenario, ctx)
      parts.push(formatSections(sr.sections))
      parts.push(formatSuggestedActions(sr.suggestedActions))
    }

    return wrapResult(parts.join("\n"))
  } catch (error) {
    return wrapError(error)
  }
}

// ========================================
// 2. chain_action_basis -- 처분/허가 근거 확인
// ========================================

export const chainActionBasisSchema = z.object({
  query: z.string().describe("처분 유형 + 키워드 (예: '건축허가 거부 근거', '보조금 환수')"),
  scenario: z.enum(["penalty"]).optional()
    .describe("확장 시나리오. penalty=처분·벌칙 기준 종합 (별표 처분기준표 + 감경 판례 + 개정이력). 미지정 시 쿼리에서 자동 감지."),
  apiKey: z.string().optional(),
})

export async function chainActionBasis(
  apiClient: LawApiClient,
  input: z.infer<typeof chainActionBasisSchema>
): Promise<ToolResponse> {
  try {
    const laws = await findLaws(apiClient, input.query, input.apiKey)
    if (laws.length === 0) return noResult(input.query)

    const p = laws[0]
    const parts = [`═══ 처분 근거 확인: ${p.lawName} ═══`]

    // Step 1: 3단 비교 (요건 체계)
    const threeTier = await callTool(getThreeTier, apiClient, { mst: p.mst, apiKey: input.apiKey })
    parts.push(secOrSkip("법령 체계 (법률·시행령·시행규칙)", threeTier))

    // Step 2: 해석례 + 판례 + 행정심판 (병렬)
    // 법령명 기반 검색 (input.query는 AND 키워드 과다로 결과 없을 수 있음)
    const searchQuery = p.lawName
    const [interpR, precR, appealR] = await Promise.all([
      callTool(searchInterpretations, apiClient, { query: searchQuery, display: 5, apiKey: input.apiKey }),
      callTool(searchPrecedents, apiClient, { query: searchQuery, display: 5, apiKey: input.apiKey }),
      callTool(searchAdminAppeals, apiClient, { query: searchQuery, display: 5, apiKey: input.apiKey }),
    ])

    parts.push(secOrSkip("법령 해석례", interpR))
    parts.push(secOrSkip("관련 판례", precR))
    parts.push(secOrSkip("행정심판례", appealR))

    // 키워드 확장
    const exp = detectExpansions(input.query)
    if (exp.includes("annex_fee") || exp.includes("annex_table")) {
      const annexes = await callTool(getAnnexes, apiClient, { lawName: p.lawName, apiKey: input.apiKey })
      parts.push(secOrSkip("별표 (과태료/기준표)", annexes))
    }

    // Scenario 확장
    const scenario = (input.scenario || detectScenario(input.query, "chain_action_basis")) as ScenarioType | null
    if (scenario) {
      const ctx: ScenarioContext = { apiClient, query: input.query, law: p, apiKey: input.apiKey }
      const sr = await runScenario(scenario, ctx)
      parts.push(formatSections(sr.sections))
      parts.push(formatSuggestedActions(sr.suggestedActions))
    }

    return wrapResult(parts.join("\n"))
  } catch (error) {
    return wrapError(error)
  }
}

// ========================================
// 3. chain_dispute_prep -- 불복/쟁송 대비
// ========================================

export const chainDisputePrepSchema = z.object({
  query: z.string().describe("분쟁 키워드 (예: '건축허가 취소 행정심판', '징계처분 감경')"),
  domain: z.enum(["tax", "labor", "privacy", "competition", "general"]).optional()
    .describe("전문 분야 (tax=조세심판, labor=노동위, privacy=개인정보위, competition=공정위). 미지정 시 쿼리에서 자동 감지"),
  apiKey: z.string().optional(),
})

export async function chainDisputePrep(
  apiClient: LawApiClient,
  input: z.infer<typeof chainDisputePrepSchema>
): Promise<ToolResponse> {
  try {
    const parts = [`═══ 쟁송 대비: ${input.query} ═══`]

    // Step 1: 판례 + 행정심판 (병렬)
    const parallel: Promise<CallResult>[] = [
      callTool(searchPrecedents, apiClient, { query: input.query, display: 8, apiKey: input.apiKey }),
      callTool(searchAdminAppeals, apiClient, { query: input.query, display: 8, apiKey: input.apiKey }),
    ]

    // Step 2: 도메인별 전문 결정례 추가
    const domain = input.domain || detectDomain(input.query) || "general"
    if (domain === "tax") {
      parallel.push(callTool(searchTaxTribunalDecisions, apiClient, { query: input.query, display: 5, apiKey: input.apiKey }))
    } else if (domain === "labor") {
      parallel.push(callTool(searchNlrcDecisions, apiClient, { query: input.query, display: 5, apiKey: input.apiKey }))
    } else if (domain === "privacy") {
      parallel.push(callTool(searchPipcDecisions, apiClient, { query: input.query, display: 5, apiKey: input.apiKey }))
    }

    const results = await Promise.all(parallel)

    parts.push(secOrSkip("대법원 판례", results[0]))
    parts.push(secOrSkip("행정심판례", results[1]))
    if (results[2]) {
      const domainNames: Record<string, string> = {
        tax: "조세심판원 결정",
        labor: "중앙노동위 결정",
        privacy: "개인정보위 결정",
      }
      parts.push(secOrSkip(domainNames[domain] || "전문 결정례", results[2]))
    }

    // 해석례 (키워드 확장)
    const exp = detectExpansions(input.query)
    if (exp.includes("interpretation")) {
      const interp = await callTool(searchInterpretations, apiClient, { query: input.query, display: 5, apiKey: input.apiKey })
      parts.push(secOrSkip("법령 해석례", interp))
    }

    return wrapResult(parts.join("\n"))
  } catch (error) {
    return wrapError(error)
  }
}

// ========================================
// 4. chain_amendment_track -- 개정 추적
// ========================================

export const chainAmendmentTrackSchema = z.object({
  query: z.string().describe("법령명 (예: '관세법', '지방세특례제한법')"),
  mst: z.string().optional().describe("법령일련번호 (알고 있으면)"),
  lawId: z.string().optional().describe("법령ID (알고 있으면)"),
  scenario: z.enum(["timeline"]).optional()
    .describe("확장 시나리오. timeline=시계열 종합 타임라인 (개정 구간별 판례·해석례 매핑). 미지정 시 쿼리에서 자동 감지."),
  apiKey: z.string().optional(),
})

export async function chainAmendmentTrack(
  apiClient: LawApiClient,
  input: z.infer<typeof chainAmendmentTrackSchema>
): Promise<ToolResponse> {
  try {
    let mst = input.mst
    let lawId = input.lawId
    let lawName = input.query

    // 법령 검색 (MST 모르면)
    if (!mst && !lawId) {
      const laws = await findLaws(apiClient, input.query, input.apiKey, 1)
      if (laws.length === 0) return noResult(input.query)
      mst = laws[0].mst
      lawId = laws[0].lawId
      lawName = laws[0].lawName
    }

    const parts = [`═══ 개정 추적: ${lawName} ═══`]
    const id: Record<string, string> = mst ? { mst } : { lawId: lawId! }

    // Step 1: 신구대조표
    const oldNew = await callTool(compareOldNew, apiClient, { ...id, apiKey: input.apiKey })
    parts.push(secOrSkip("신구대조표 (최근 개정)", oldNew))

    // Step 2: 조문별 개정 이력 (lawId 필요)
    if (lawId) {
      const artHistory = await callTool(getArticleHistory, apiClient, { lawId, apiKey: input.apiKey })
      parts.push(secOrSkip("조문별 개정 이력", artHistory))
    }

    // Scenario 확장
    const scenario = (input.scenario || detectScenario(input.query, "chain_amendment_track")) as ScenarioType | null
    if (scenario) {
      const law = mst ? { lawName, lawId: lawId || "", mst, lawType: "" } : undefined
      const ctx: ScenarioContext = { apiClient, query: input.query, law, apiKey: input.apiKey }
      const sr = await runScenario(scenario, ctx)
      parts.push(formatSections(sr.sections))
      parts.push(formatSuggestedActions(sr.suggestedActions))
    }

    return wrapResult(parts.join("\n"))
  } catch (error) {
    return wrapError(error)
  }
}

// ========================================
// 5. chain_ordinance_compare -- 조례 비교 연구
// ========================================

export const chainOrdinanceCompareSchema = z.object({
  query: z.string().describe("조례 관련 키워드 (예: '주민자치회', '개발행위 허가 기준')"),
  parentLaw: z.string().optional().describe("상위 법령명 (예: '지방자치법'). 미지정 시 자동 검색."),
  scenario: z.enum(["compliance"]).optional()
    .describe("확장 시나리오. compliance=조례 상위법 적합성 검증 (헌재·행심 위법 판결 + 상위법 근거 분석). 미지정 시 쿼리에서 자동 감지."),
  apiKey: z.string().optional(),
})

export async function chainOrdinanceCompare(
  apiClient: LawApiClient,
  input: z.infer<typeof chainOrdinanceCompareSchema>
): Promise<ToolResponse> {
  try {
    const parts = [`═══ 조례 비교 연구: ${input.query} ═══`]

    // Step 1: 상위 법령 확인 (조례/지역명은 법령 검색에서 제거)
    const parentQuery = input.parentLaw || stripOrdinanceKeywords(input.query)
    const laws = parentQuery ? await findLaws(apiClient, parentQuery, input.apiKey, 2) : []

    if (laws.length > 0) {
      const p = laws[0]
      parts.push(sec("상위 법령", `${p.lawName} (${p.lawType}) | MST: ${p.mst}`))

      // 3단 비교 (위임 근거 확인)
      const threeTier = await callTool(getThreeTier, apiClient, { mst: p.mst, apiKey: input.apiKey })
      parts.push(secOrSkip("위임 체계 (법률·시행령·시행규칙)", threeTier))
    }

    // Step 2: 조례 검색 — "조례"/"규칙" 제거 (이미 조례 DB에서 검색하므로)
    const ordinanceQuery = input.query.replace(/\s*(조례|규칙|자치법규)\s*/g, " ").trim() || input.query
    const ordinances = await callTool(searchOrdinance, apiClient, { query: ordinanceQuery, display: 20, apiKey: input.apiKey })
    parts.push(secOrSkip("전국 자치법규 검색 결과", ordinances))

    // Step 3: 상위 1건 전문 자동 조회
    if (!ordinances.isError) {
      // 자치법규일련번호 추출: "[숫자]" 패턴 (search_ordinance 출력의 "[일련번호] 법규명" 형식)
      const seqMatch = ordinances.text.match(/\[(\d{5,})\]/)
      if (seqMatch) {
        const fullText = await callTool(getOrdinance, apiClient, { ordinSeq: seqMatch[1], apiKey: input.apiKey })
        parts.push(secOrSkip("조례 전문 (상위 1건)", fullText))
      }
    }

    // 키워드 확장
    const exp = detectExpansions(input.query)
    if (exp.includes("interpretation")) {
      const interp = await callTool(searchInterpretations, apiClient, { query: input.query, display: 5, apiKey: input.apiKey })
      parts.push(secOrSkip("법령 해석례", interp))
    }

    // Scenario 확장
    const scenario = (input.scenario || detectScenario(input.query, "chain_ordinance_compare")) as ScenarioType | null
    if (scenario) {
      const law = laws.length > 0 ? laws[0] : undefined
      const ctx: ScenarioContext = { apiClient, query: input.query, law, apiKey: input.apiKey }
      const sr = await runScenario(scenario, ctx)
      parts.push(formatSections(sr.sections))
      parts.push(formatSuggestedActions(sr.suggestedActions))
    }

    return wrapResult(parts.join("\n"))
  } catch (error) {
    return wrapError(error)
  }
}

// ========================================
// 6. chain_full_research -- 종합 리서치
// ========================================

export const chainFullResearchSchema = z.object({
  query: z.string().describe("자연어 질문 (예: '기간제 근로자 2년 초과 사용', '음주운전 처벌 기준')"),
  scenario: z.enum(["customs"]).optional()
    .describe("확장 시나리오. customs=관세·통관 종합 (관세3법 + 해석례 + FTA조약 + 세율표 + 조세심판). 미지정 시 쿼리에서 자동 감지."),
  apiKey: z.string().optional(),
})

export async function chainFullResearch(
  apiClient: LawApiClient,
  input: z.infer<typeof chainFullResearchSchema>
): Promise<ToolResponse> {
  try {
    const parts = [`═══ 종합 리서치: ${input.query} ═══`]

    // Step 1: AI 검색 + 법령 검색 + 판례/해석 모두 병렬
    // findLaws를 안전하게 래핑 (throw 시 Promise.all 전체 reject 방지)
    const safeFindLaws = async (): Promise<LawInfo[]> => {
      try { return await findLaws(apiClient, input.query, input.apiKey, 2) }
      catch { return [] }
    }
    const [aiResult, lawsResult, precResult, interpResult] = await Promise.all([
      callTool(searchAiLaw, apiClient, { query: input.query, display: 10, apiKey: input.apiKey }),
      safeFindLaws(),
      callTool(searchPrecedents, apiClient, { query: input.query, display: 5, apiKey: input.apiKey }),
      callTool(searchInterpretations, apiClient, { query: input.query, display: 5, apiKey: input.apiKey }),
    ])

    parts.push(secOrSkip("AI 법령검색 결과", aiResult))

    // 법령 본문 (첫 번째 결과)
    if (lawsResult.length > 0) {
      const p = lawsResult[0]
      const lawText = await callTool(getLawText, apiClient, { mst: p.mst, apiKey: input.apiKey })
      parts.push(secOrSkip(`${p.lawName} 본문`, lawText))
    }

    parts.push(secOrSkip("관련 판례", precResult))
    parts.push(secOrSkip("법령 해석례", interpResult))

    // 키워드 확장
    const exp = detectExpansions(input.query)
    if (lawsResult.length > 0) {
      if (exp.includes("annex_fee") || exp.includes("annex_table") || exp.includes("annex_form")) {
        const annexes = await callTool(getAnnexes, apiClient, { lawName: lawsResult[0].lawName, apiKey: input.apiKey })
        parts.push(secOrSkip("별표/서식", annexes))
      }
    }

    // Scenario 확장
    const scenario = (input.scenario || detectScenario(input.query, "chain_full_research")) as ScenarioType | null
    if (scenario) {
      const law = lawsResult.length > 0 ? lawsResult[0] : undefined
      const ctx: ScenarioContext = { apiClient, query: input.query, law, apiKey: input.apiKey }
      const sr = await runScenario(scenario, ctx)
      parts.push(formatSections(sr.sections))
      parts.push(formatSuggestedActions(sr.suggestedActions))
    }

    return wrapResult(parts.join("\n"))
  } catch (error) {
    return wrapError(error)
  }
}

// ========================================
// 7. chain_procedure_detail -- 절차/비용/서식
// ========================================

export const chainProcedureDetailSchema = z.object({
  query: z.string().describe("절차/비용 관련 질문 (예: '여권발급 절차 수수료', '건축허가 신청 방법')"),
  scenario: z.enum(["manual"]).optional()
    .describe("확장 시나리오. manual=공무원 처리 매뉴얼 (행정규칙 + 자치법규 특칙 + 해석례 추가). 미지정 시 쿼리에서 자동 감지."),
  apiKey: z.string().optional(),
})

export async function chainProcedureDetail(
  apiClient: LawApiClient,
  input: z.infer<typeof chainProcedureDetailSchema>
): Promise<ToolResponse> {
  try {
    const parts = [`═══ 절차/비용 안내: ${input.query} ═══`]

    // Step 1: 법령 검색
    const laws = await findLaws(apiClient, input.query, input.apiKey, 3)
    if (laws.length === 0) return noResult(input.query)

    const p = laws[0]
    parts.push(`법령: ${p.lawName} (${p.lawType}) | MST: ${p.mst}`)

    // Step 2: 3단 비교 (절차 체계 파악)
    const threeTier = await callTool(getThreeTier, apiClient, { mst: p.mst, apiKey: input.apiKey })
    parts.push(secOrSkip("법령 체계 (절차 근거)", threeTier))

    // Step 3: 별표(수수료/과태료) + 서식(신청서) 병렬
    const [annexFee, annexForm] = await Promise.all([
      callTool(getAnnexes, apiClient, { lawName: p.lawName, apiKey: input.apiKey }),
      // 시행규칙에도 별표가 있을 수 있으므로 시행규칙명으로도 시도
      (async (): Promise<CallResult> => {
        const ruleNameCandidates = [
          p.lawName.replace(/법$/, '법 시행규칙'),
          p.lawName.replace(/법$/, '법 시행령'),
        ].filter(name => name !== p.lawName)
        for (const candidate of ruleNameCandidates) {
          const rules = await findLaws(apiClient, candidate, input.apiKey, 1)
          if (rules.length > 0) {
            return callTool(getAnnexes, apiClient, { lawName: rules[0].lawName, apiKey: input.apiKey })
          }
        }
        return { text: "", isError: true }
      })(),
    ])

    parts.push(secOrSkip(`${p.lawName} 별표/서식`, annexFee))
    if (annexForm.text || annexForm.isError) parts.push(secOrSkip("시행규칙 별표/서식", annexForm))

    // Step 4: AI 검색으로 보완 (절차 상세)
    const aiResult = await callTool(searchAiLaw, apiClient, { query: input.query, display: 5, apiKey: input.apiKey })
    parts.push(secOrSkip("AI 검색 보완 정보", aiResult))

    // Scenario 확장
    const scenario = (input.scenario || detectScenario(input.query, "chain_procedure_detail")) as ScenarioType | null
    if (scenario) {
      const ctx: ScenarioContext = { apiClient, query: input.query, law: p, apiKey: input.apiKey }
      const sr = await runScenario(scenario, ctx)
      parts.push(formatSections(sr.sections))
      parts.push(formatSuggestedActions(sr.suggestedActions))
    }

    return wrapResult(parts.join("\n"))
  } catch (error) {
    return wrapError(error)
  }
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

    const searchPromises: Promise<CallResult>[] = []
    for (const hint of uniqueHints) {
      searchPromises.push(
        callTool(searchPrecedents, apiClient, { query: hint, display: 3, apiKey: input.apiKey })
      )
    }
    // AI 법령 검색도 상위 3개 힌트로 병렬 실행
    const lawHints = uniqueHints.slice(0, 3)
    for (const hint of lawHints) {
      searchPromises.push(
        callTool(searchAiLaw, apiClient, { query: hint, display: 3, apiKey: input.apiKey })
      )
    }

    const searchResults = await Promise.all(searchPromises)

    // 판례 결과 합산
    const precTexts: string[] = []
    for (let i = 0; i < uniqueHints.length; i++) {
      const r = searchResults[i]
      if (!r.isError && r.text.trim()) {
        precTexts.push(`[${uniqueHints[i]}]\n${r.text}`)
      }
    }
    if (precTexts.length > 0) {
      parts.push(sec("관련 판례", precTexts.join("\n\n")))
    }

    // 법령 결과 합산
    const lawTexts: string[] = []
    for (let i = 0; i < lawHints.length; i++) {
      const r = searchResults[uniqueHints.length + i]
      if (!r.isError && r.text.trim()) {
        lawTexts.push(`[${lawHints[i]}]\n${r.text}`)
      }
    }
    if (lawTexts.length > 0) {
      parts.push(sec("근거 법령", lawTexts.join("\n\n")))
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
