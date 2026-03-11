/**
 * Chain Tools -- 질문 유형별 다단계 자동 체이닝
 * 7개 체인 + 키워드 트리거 확장
 */
import { z } from "zod"
import { truncateSections } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"
import { extractTag } from "../lib/xml-parser.js"
import type { LawApiClient } from "../lib/api-client.js"
import type { ToolResponse } from "../lib/types.js"

// Tool handler imports
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

interface LawInfo {
  lawName: string
  lawId: string
  mst: string
  lawType: string
}

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
  handler: (apiClient: LawApiClient, input: any) => Promise<ToolResponse>,
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

async function findLaws(
  apiClient: LawApiClient,
  query: string,
  apiKey?: string,
  max = 3
): Promise<LawInfo[]> {
  try {
    const xmlText = await apiClient.searchLaw(query, apiKey)
    const lawRegex = /<law[^>]*>([\s\S]*?)<\/law>/g
    const results: LawInfo[] = []

    let match
    while ((match = lawRegex.exec(xmlText)) !== null && results.length < max) {
      const content = match[1]
      results.push({
        lawName: extractTag(content, "법령명한글"),
        lawId: extractTag(content, "법령ID"),
        mst: extractTag(content, "법령일련번호"),
        lawType: extractTag(content, "법령구분명"),
      })
    }
    return results
  } catch {
    return []
  }
}

function detectExpansions(query: string): ExpansionType[] {
  const exp: ExpansionType[] = []
  if (/수수료|과태료|요금|금액|벌금|과징금|벌칙/.test(query)) exp.push("annex_fee")
  if (/서식|신청서|양식|별지|신고서/.test(query)) exp.push("annex_form")
  if (/별표|기준표|산정기준/.test(query)) exp.push("annex_table")
  if (/판례|사례|판결|대법원/.test(query)) exp.push("precedent")
  if (/해석|유권해석|질의회신/.test(query)) exp.push("interpretation")
  return exp
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

/** 부분 실패 시 사용자에게 왜 빠졌는지 알림 */
function secOrSkip(title: string, result: CallResult): string {
  if (!result.isError) return sec(title, result.text)
  // 에러인 경우 간략하게 왜 빠졌는지 표시
  if (result.text && result.text.trim()) {
    return `\n▶ ${title} (조회 실패: ${result.text.slice(0, 80)})\n`
  }
  return `\n▶ ${title} (조회 실패)\n`
}

function noResult(query: string): ToolResponse {
  return {
    content: [{ type: "text", text: `'${query}' 관련 법령을 찾을 수 없습니다. 검색어를 확인해주세요.` }],
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
    if (!threeTier.isError) parts.push(sec("3단 비교 (법률·시행령·시행규칙)", threeTier.text))

    // 조문 조회
    if (input.articles?.length) {
      const batch = await callTool(getBatchArticles, apiClient, {
        mst: p.mst,
        articles: input.articles,
        apiKey: input.apiKey,
      })
      if (!batch.isError) parts.push(sec("핵심 조문", batch.text))
    }

    // 키워드 확장: 별표
    const exp = detectExpansions(input.query)
    if (exp.includes("annex_fee") || exp.includes("annex_table") || exp.includes("annex_form")) {
      const annexes = await callTool(getAnnexes, apiClient, { lawName: p.lawName, apiKey: input.apiKey })
      if (!annexes.isError) parts.push(sec("별표/서식", annexes.text))
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
    const [interpR, precR, appealR] = await Promise.all([
      callTool(searchInterpretations, apiClient, { query: input.query, display: 5, apiKey: input.apiKey }),
      callTool(searchPrecedents, apiClient, { query: input.query, display: 5, apiKey: input.apiKey }),
      callTool(searchAdminAppeals, apiClient, { query: input.query, display: 5, apiKey: input.apiKey }),
    ])

    parts.push(secOrSkip("법령 해석례", interpR))
    parts.push(secOrSkip("관련 판례", precR))
    parts.push(secOrSkip("행정심판례", appealR))

    // 키워드 확장
    const exp = detectExpansions(input.query)
    if (exp.includes("annex_fee") || exp.includes("annex_table")) {
      const annexes = await callTool(getAnnexes, apiClient, { lawName: p.lawName, apiKey: input.apiKey })
      if (!annexes.isError) parts.push(sec("별표 (과태료/기준표)", annexes.text))
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

    if (!results[0].isError) parts.push(sec("대법원 판례", results[0].text))
    if (!results[1].isError) parts.push(sec("행정심판례", results[1].text))
    if (results[2] && !results[2].isError) {
      const domainNames: Record<string, string> = {
        tax: "조세심판원 결정",
        labor: "중앙노동위 결정",
        privacy: "개인정보위 결정",
      }
      parts.push(sec(domainNames[domain] || "전문 결정례", results[2].text))
    }

    // 해석례 (키워드 확장)
    const exp = detectExpansions(input.query)
    if (exp.includes("interpretation")) {
      const interp = await callTool(searchInterpretations, apiClient, { query: input.query, display: 5, apiKey: input.apiKey })
      if (!interp.isError) parts.push(sec("법령 해석례", interp.text))
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
    if (!oldNew.isError) {
      parts.push(sec("신구대조표 (최근 개정)", oldNew.text))
    }

    // Step 2: 조문별 개정 이력 (lawId 필요)
    if (lawId) {
      const artHistory = await callTool(getArticleHistory, apiClient, { lawId, apiKey: input.apiKey })
      if (!artHistory.isError) {
        parts.push(sec("조문별 개정 이력", artHistory.text))
      }
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
  apiKey: z.string().optional(),
})

export async function chainOrdinanceCompare(
  apiClient: LawApiClient,
  input: z.infer<typeof chainOrdinanceCompareSchema>
): Promise<ToolResponse> {
  try {
    const parts = [`═══ 조례 비교 연구: ${input.query} ═══`]

    // Step 1: 상위 법령 확인
    const parentQuery = input.parentLaw || input.query
    const laws = await findLaws(apiClient, parentQuery, input.apiKey, 2)

    if (laws.length > 0) {
      const p = laws[0]
      parts.push(sec("상위 법령", `${p.lawName} (${p.lawType}) | MST: ${p.mst}`))

      // 3단 비교 (위임 근거 확인)
      const threeTier = await callTool(getThreeTier, apiClient, { mst: p.mst, apiKey: input.apiKey })
      if (!threeTier.isError) parts.push(sec("위임 체계 (법률·시행령·시행규칙)", threeTier.text))
    }

    // Step 2: 조례 검색 (타 지자체)
    const ordinances = await callTool(searchOrdinance, apiClient, { query: input.query, display: 20, apiKey: input.apiKey })
    if (!ordinances.isError) parts.push(sec("전국 자치법규 검색 결과", ordinances.text))

    // 키워드 확장
    const exp = detectExpansions(input.query)
    if (exp.includes("interpretation")) {
      const interp = await callTool(searchInterpretations, apiClient, { query: input.query, display: 5, apiKey: input.apiKey })
      if (!interp.isError) parts.push(sec("법령 해석례", interp.text))
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
  apiKey: z.string().optional(),
})

export async function chainFullResearch(
  apiClient: LawApiClient,
  input: z.infer<typeof chainFullResearchSchema>
): Promise<ToolResponse> {
  try {
    const parts = [`═══ 종합 리서치: ${input.query} ═══`]

    // Step 1: AI 검색 + 법령 검색 + 판례/해석 모두 병렬
    const [aiResult, lawsResult, precResult, interpResult] = await Promise.all([
      callTool(searchAiLaw, apiClient, { query: input.query, display: 10, apiKey: input.apiKey }),
      findLaws(apiClient, input.query, input.apiKey, 2),
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
        if (!annexes.isError) parts.push(sec("별표/서식", annexes.text))
      }
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
    if (!threeTier.isError) parts.push(sec("법령 체계 (절차 근거)", threeTier.text))

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

    if (!annexFee.isError) parts.push(sec(`${p.lawName} 별표/서식`, annexFee.text))
    if (!annexForm.isError && annexForm.text) parts.push(sec("시행규칙 별표/서식", annexForm.text))

    // Step 4: AI 검색으로 보완 (절차 상세)
    const aiResult = await callTool(searchAiLaw, apiClient, { query: input.query, display: 5, apiKey: input.apiKey })
    if (!aiResult.isError) parts.push(sec("AI 검색 보완 정보", aiResult.text))

    return wrapResult(parts.join("\n"))
  } catch (error) {
    return wrapError(error)
  }
}
