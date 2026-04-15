/**
 * Chain Tools -- 질문 유형별 다단계 자동 체이닝
 * 7개 체인 + 키워드 트리거 확장
 */
import { z } from "zod"
import { truncateSections } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"
import { extractTag } from "../lib/xml-parser.js"
import { lawCache } from "../lib/cache.js"
import type { LawApiClient } from "../lib/api-client.js"
import type { ToolResponse, LooseToolResponse } from "../lib/types.js"
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
import { searchHistoricalLaw, getHistoricalLaw } from "./historical-law.js"

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

/** 법령명이 아닌 부가 키워드 제거 (법제처 lawSearch API는 법령명 검색이므로) */
const NON_LAW_NAME_RE = /\s*(과태료|절차|비용|처벌|기준|허가|신청|부과|근거|위반|방법|요건|조건|처분|수수료|신고|등록|면허|인가|승인|취소|정지|벌칙|벌금|과징금|이행강제금|시정명령|체계|구조|3단|판례|해석|개정|별표|시행령|시행규칙|서식|수입|수출|통관|반환|납부|감면|면제|제한|금지|의무|권리|자격|종류|기간|대상|범위|적용|감경|영향도|영향|분석|위임입법|위임|현황|미이행|미제정|시계열|타임라인|변화|처리|민원|매뉴얼|업무|담당|적합성|상위법|저촉|검증|파급|연쇄|불복|소송|쟁송|FTA|원산지|HS코드|품목분류|관세사)\s*/g

function stripNonLawKeywords(query: string): string {
  return query.replace(NON_LAW_NAME_RE, " ").trim()
}

/** XML에서 법령 정보 파싱 */
function parseLawXml(xmlText: string, max: number): LawInfo[] {
  const lawRegex = /<law[^>]*>([\s\S]*?)<\/law>/g
  const results: LawInfo[] = []
  let match
  while ((match = lawRegex.exec(xmlText)) !== null && results.length < max) {
    const content = match[1]
    const lawName = extractTag(content, "법령명한글")
    if (!lawName) continue // 빈 법령명 제외
    results.push({
      lawName,
      lawId: extractTag(content, "법령ID"),
      mst: extractTag(content, "법령일련번호"),
      lawType: extractTag(content, "법령구분명"),
    })
  }
  return results
}

async function findLaws(
  apiClient: LawApiClient,
  query: string,
  apiKey?: string,
  max = 3
): Promise<LawInfo[]> {
  // 캐시 확인 (검색어 기반, 1시간 TTL)
  const cacheKey = `chain-search:${query}:${max}`
  const cached = lawCache.get<LawInfo[]>(cacheKey)
  if (cached) return cached.slice(0, max)

  // 1차: 원본 쿼리로 검색
  let results: LawInfo[] = []
  try {
    const xmlText = await apiClient.searchLaw(query, apiKey)
    results = parseLawXml(xmlText, max)
  } catch (e) {
    // 인증/권한 에러는 재시도 무의미 — 즉시 전파
    if (e instanceof Error && /429|401|403|API 키/.test(e.message)) throw e
    /* 그 외 에러: 2차 시도로 진행 */
  }

  // 2차: 결과 없으면 부가 키워드 제거 후 재시도
  if (results.length === 0) {
    const stripped = stripNonLawKeywords(query)
    if (stripped && stripped !== query) {
      try {
        const xmlText = await apiClient.searchLaw(stripped, apiKey)
        results = parseLawXml(xmlText, max)
      } catch (e) {
        if (e instanceof Error && /429|401|403|API 키/.test(e.message)) throw e
      }
    }
  }

  // 3차: 법령명 패턴 직접 추출 (strip이 법령명을 파괴하는 경우 대비)
  // 예: "근로기준법 개정이력" → strip이 "기준" 제거 → "근로 법" 실패 → 패턴으로 "근로기준법" 추출
  if (results.length === 0) {
    const lawNameMatch = query.match(/[가-힣]+(법|시행령|시행규칙|규칙|규정|령)(?:\s|$)/)
    if (lawNameMatch) {
      const extracted = lawNameMatch[0].trim()
      try {
        const xmlText = await apiClient.searchLaw(extracted, apiKey)
        results = parseLawXml(xmlText, max)
      } catch (e) {
        if (e instanceof Error && /429|401|403|API 키/.test(e.message)) throw e
      }
    }
  }

  // 쿼리와 법령명 관련도 기반 정렬 (정확 매칭 > 부분 매칭 > 나머지)
  if (results.length > 1) {
    const queryWords = query.replace(NON_LAW_NAME_RE, " ")
      .trim().split(/\s+/).filter(w => w.length > 0)
    results.sort((a, b) => {
      const scoreA = scoreLawRelevance(a.lawName, query, queryWords)
      const scoreB = scoreLawRelevance(b.lawName, query, queryWords)
      return scoreB - scoreA
    })
  }

  // 캐시 저장 (1시간 TTL)
  if (results.length > 0) {
    lawCache.set(cacheKey, results, 60 * 60 * 1000)
  }

  return results
}

/** 쿼리 대비 법령명 관련도 점수 (높을수록 관련) */
function scoreLawRelevance(lawName: string, query: string, queryWords: string[]): number {
  let score = 0
  // 정확 매칭: 쿼리가 법령명을 포함
  if (query.includes(lawName)) score += 100
  // 법령명이 쿼리를 포함
  if (lawName.includes(query.replace(/\s+/g, ""))) score += 80
  // 단어 매칭
  for (const w of queryWords) {
    if (lawName.includes(w)) score += 10
  }
  // 법률 > 시행령 > 시행규칙 우선순위
  if (!/시행령|시행규칙/.test(lawName)) score += 5
  return score
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
  const keywords = query.trim().split(/\s+/)
  const lines = [`'${query}' 관련 법령을 찾을 수 없습니다.`]
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
      if (!annexes.isError) parts.push(sec("별표 (과태료/기준표)", annexes.text))
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

/**
 * 법령의 개정 이력에서 고유 MST 목록을 추출 (최신순 정렬)
 */
async function collectAmendmentMsts(
  apiClient: LawApiClient,
  lawId: string,
  fromDate?: string,
  apiKey?: string
): Promise<Array<{ mst: string; promDate: string; changeType: string }>> {
  const xmlText = await apiClient.getArticleHistory({ lawId, fromRegDt: fromDate, apiKey })
  const seen = new Set<string>()
  const result: Array<{ mst: string; promDate: string; changeType: string }> = []

  // <law> 블록마다 법령정보 추출
  const lawBlockRe = /<law[^>]*>([\s\S]*?)<\/law>/g
  let m: RegExpExecArray | null
  while ((m = lawBlockRe.exec(xmlText)) !== null) {
    const block = m[1]
    const infoMatch = /<법령정보>([\s\S]*?)<\/법령정보>/.exec(block)
    if (!infoMatch) continue
    const info = infoMatch[1]
    const mst = extractTag(info, "법령일련번호")
    const promDate = extractTag(info, "공포일자")
    const changeType = extractTag(info, "제개정구분명")
    if (mst && !seen.has(mst)) {
      seen.add(mst)
      result.push({ mst, promDate, changeType })
    }
  }

  // 최신순 정렬
  result.sort((a, b) => b.promDate.localeCompare(a.promDate))
  return result
}

export const chainAmendmentTrackSchema = z.object({
  query: z.string().describe("법령명 (예: '관세법', '지방세특례제한법')"),
  mst: z.string().optional().describe("법령일련번호 (알고 있으면)"),
  lawId: z.string().optional().describe("법령ID (알고 있으면)"),
  maxAmendments: z.number().int().min(1).max(20).optional().default(1)
    .describe("조회할 신구대조표 개수 (기본값: 1=최근 1회. 2 이상이면 최근 N회 개정을 순서대로 모두 반환)"),
  fromDate: z.string().regex(/^\d{8}$/).optional()
    .describe("조회 시작일 (YYYYMMDD, 예: '20100101'). 이 날짜 이후 모든 개정 신구대조를 반환. maxAmendments와 함께 사용 가능"),
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
    const maxAmendments = input.maxAmendments ?? 1
    const useMulti = maxAmendments > 1 || !!input.fromDate

    // Step 1: 신구대조표
    if (useMulti && lawId) {
      // 다회 개정 조회: 조문이력에서 MST 목록 추출 → 각 개정별 신구대조 순회
      const amendments = await collectAmendmentMsts(apiClient, lawId, input.fromDate, input.apiKey)
      const limit = maxAmendments > 1 ? maxAmendments : amendments.length
      const toFetch = amendments.slice(0, limit)

      if (toFetch.length === 0) {
        parts.push(sec("신구대조표", "해당 기간 내 개정 이력이 없습니다."))
      } else {
        for (const amend of toFetch) {
          const oldNew = await callTool(compareOldNew, apiClient, { mst: amend.mst, apiKey: input.apiKey })
          if (!oldNew.isError) {
            parts.push(sec(`신구대조표 (${amend.promDate} ${amend.changeType})`, oldNew.text))
          }
        }
      }
    } else {
      // 기존 단일 개정 조회 (기본값)
      const oldNew = await callTool(compareOldNew, apiClient, { ...id, apiKey: input.apiKey })
      if (!oldNew.isError) {
        parts.push(sec("신구대조표 (최근 개정)", oldNew.text))
      }
    }

    // Step 2: 조문별 개정 이력 (lawId 필요)
    if (lawId) {
      const artHistory = await callTool(getArticleHistory, apiClient, { lawId, apiKey: input.apiKey })
      if (!artHistory.isError) {
        parts.push(sec("조문별 개정 이력", artHistory.text))
      }
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
      if (!threeTier.isError) parts.push(sec("위임 체계 (법률·시행령·시행규칙)", threeTier.text))
    }

    // Step 2: 조례 검색 — "조례"/"규칙" 제거 (이미 조례 DB에서 검색하므로)
    const ordinanceQuery = input.query.replace(/\s*(조례|규칙|자치법규)\s*/g, " ").trim() || input.query
    const ordinances = await callTool(searchOrdinance, apiClient, { query: ordinanceQuery, display: 20, apiKey: input.apiKey })
    if (!ordinances.isError) parts.push(sec("전국 자치법규 검색 결과", ordinances.text))

    // Step 3: 상위 1건 전문 자동 조회
    if (!ordinances.isError) {
      // 자치법규일련번호 추출: "[숫자]" 패턴 (search_ordinance 출력의 "[일련번호] 법규명" 형식)
      const seqMatch = ordinances.text.match(/\[(\d{5,})\]/)
      if (seqMatch) {
        const fullText = await callTool(getOrdinance, apiClient, { ordinSeq: seqMatch[1], apiKey: input.apiKey })
        if (!fullText.isError) parts.push(sec("조례 전문 (상위 1건)", fullText.text))
      }
    }

    // 키워드 확장
    const exp = detectExpansions(input.query)
    if (exp.includes("interpretation")) {
      const interp = await callTool(searchInterpretations, apiClient, { query: input.query, display: 5, apiKey: input.apiKey })
      if (!interp.isError) parts.push(sec("법령 해석례", interp.text))
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
        if (!annexes.isError) parts.push(sec("별표/서식", annexes.text))
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

// ========================================
// 9. chain_article_history -- 조문별 연혁 체인
// ========================================

export const chainArticleHistorySchema = z.object({
  lawName: z.string().describe("법령명 (예: '근로기준법', '국가공무원법')"),
  jo: z.string().optional().describe("조문 번호 (예: '제60조', '60', '60조의2'). 생략 시 전체 조문 이력 조회"),
  fromDate: z.string().regex(/^\d{8}$/).optional()
    .describe("조회 시작일 (YYYYMMDD, 예: '20100101'). 이 날짜 이후 개정 이력 조회"),
  toDate: z.string().regex(/^\d{8}$/).optional()
    .describe("조회 종료일 (YYYYMMDD, 예: '20241231')"),
  includeComparison: z.boolean().optional().default(true)
    .describe("각 개정에 대해 신구대조표(개정이유 포함) 조회 여부 (기본값: true)"),
  maxAmendments: z.number().int().min(1).max(10).optional().default(5)
    .describe("신구대조 최대 조회 횟수 (기본값: 5)"),
  apiKey: z.string().optional(),
})

/**
 * chain_article_history: 특정 조문의 개정 연혁을 시계열로 정리
 *
 * 동작 흐름:
 *  1. lawName → findLaws()로 lawId/mst 해결
 *  2. getArticleHistory(lawId, jo, fromDate, toDate)로 조문 개정 이력 조회
 *  3. includeComparison=true이면 각 MST에 대해 compareOldNew() 호출 → 개정이유 + 신구대조
 *  4. 시계열 순으로 정리하여 반환
 */
export async function chainArticleHistory(
  apiClient: LawApiClient,
  input: z.infer<typeof chainArticleHistorySchema>
): Promise<ToolResponse> {
  try {
    // Step 1: 법령 검색으로 lawId/mst 해결
    const laws = await findLaws(apiClient, input.lawName, input.apiKey, 1)
    if (laws.length === 0) return noResult(input.lawName)
    const law = laws[0]

    // jo 정규화 ('60' → '제60조', '60조의2' → '제60조의2')
    let normalizedJo = input.jo
    if (normalizedJo) {
      if (/^\d+조의\d+$/.test(normalizedJo)) normalizedJo = `제${normalizedJo}`
      else if (/^\d+조$/.test(normalizedJo)) normalizedJo = `제${normalizedJo}`
      else if (/^\d+$/.test(normalizedJo)) normalizedJo = `제${normalizedJo}조`
    }

    const joLabel = normalizedJo || "전체 조문"
    const parts = [`═══ 조문 연혁 타임라인: ${law.lawName} ${joLabel} ═══`]

    // Step 2: 조문 개정 이력 조회
    const histInput: Record<string, unknown> = {
      lawId: law.lawId,
      apiKey: input.apiKey,
    }
    if (normalizedJo) histInput.jo = normalizedJo
    if (input.fromDate) histInput.fromRegDt = input.fromDate
    if (input.toDate) histInput.toRegDt = input.toDate

    const artHistory = await callTool(getArticleHistory, apiClient, histInput)
    if (artHistory.isError) {
      parts.push(sec("조문 개정 이력", artHistory.text || "조회 실패"))
      return wrapResult(parts.join("\n"))
    }
    parts.push(sec("조문 개정 이력", artHistory.text))

    // Step 3: 신구대조표 + 개정이유 (includeComparison=true)
    if (input.includeComparison !== false) {
      const amendments = await collectAmendmentMsts(apiClient, law.lawId, input.fromDate, input.apiKey)
      const toFetch = amendments.slice(0, input.maxAmendments ?? 5)

      if (toFetch.length > 0) {
        const compParts: string[] = []
        for (const amend of toFetch) {
          const oldNew = await callTool(compareOldNew, apiClient, { mst: amend.mst, apiKey: input.apiKey })
          if (!oldNew.isError && oldNew.text.trim()) {
            compParts.push(`▸ ${amend.promDate} ${amend.changeType} (MST: ${amend.mst})\n${oldNew.text}`)
          }
        }
        if (compParts.length > 0) {
          parts.push(sec("신구대조표 및 개정이유", compParts.join("\n\n---\n\n")))
        }
      }
    }

    return wrapResult(parts.join("\n"))
  } catch (error) {
    return wrapError(error)
  }
}

// ========================================
// 10. chain_historical_article -- 특정 시점 조문 조회
// ========================================

export const chainHistoricalArticleSchema = z.object({
  lawName: z.string().describe("법령명 (예: '근로기준법', '국가공무원법')"),
  jo: z.string().optional().describe("조문 번호 (예: '제60조', '60조', '60'). 생략 시 해당 버전 전체 조문 반환"),
  targetDate: z.string().regex(/^\d{8}$/)
    .describe("기준일자 (YYYYMMDD). 이 날짜에 시행 중이던 법령 버전 조회"),
  apiKey: z.string().optional(),
})

/**
 * chain_historical_article: 특정 날짜 기준으로 조문 조회
 *
 * 동작 흐름:
 *  1. searchHistoricalLaw(lawName)로 전체 연혁 버전 목록(MST + 시행일자) 조회
 *  2. targetDate 이전 중 가장 최근 시행 버전 선택
 *  3. getHistoricalLaw(mst, jo)로 해당 버전 조문 내용 반환
 */
export async function chainHistoricalArticle(
  apiClient: LawApiClient,
  input: z.infer<typeof chainHistoricalArticleSchema>
): Promise<ToolResponse> {
  try {
    // Step 1: 연혁 버전 목록 조회
    const histList = await callTool(searchHistoricalLaw, apiClient, {
      lawName: input.lawName,
      display: 100,
      apiKey: input.apiKey,
    })

    if (histList.isError) {
      return wrapResult(
        `═══ 연혁 조회 실패: ${input.lawName} ═══\n` +
        `${histList.text || "연혁 정보를 조회할 수 없습니다."}`
      )
    }

    // Step 2: MST + 시행일자 파싱 → targetDate 이전 최신 버전 선택
    // searchHistoricalLaw 출력 예: "시행: 2024.01.01 | 일부개정\n   공포: ...\n   MST: 123456"
    const target = input.targetDate  // YYYYMMDD 형식

    // "시행: YYYY.MM.DD ... MST: NNNNNN" 패턴으로 파싱
    const versionPattern = /시행:\s*(\d{4})\.(\d{2})\.(\d{2})[\s\S]*?MST:\s*(\d+)/g
    const versions: Array<{ efYd: string; mst: string }> = []
    let m: RegExpExecArray | null
    while ((m = versionPattern.exec(histList.text)) !== null) {
      const efYd = `${m[1]}${m[2]}${m[3]}`
      versions.push({ efYd, mst: m[4] })
    }

    if (versions.length === 0) {
      return wrapResult(
        `═══ ${input.lawName} ${target} 기준 조문 조회 ═══\n` +
        `연혁 버전 정보를 파싱할 수 없습니다.\n\n` +
        `연혁 목록:\n${histList.text}`
      )
    }

    // targetDate 이하 중 가장 최근 버전 (내림차순 정렬 → 첫 번째 해당)
    const eligible = versions.filter(v => v.efYd <= target)
    const selected = eligible.length > 0
      ? eligible[0]  // 이미 내림차순 정렬됨 (searchHistoricalLaw가 efdes 정렬)
      : versions[versions.length - 1]  // 모든 버전이 target보다 이후이면 가장 오래된 버전

    const wasExact = eligible.length > 0

    // Step 3: 조문 내용 조회
    const joInput: Record<string, unknown> = { mst: selected.mst, apiKey: input.apiKey }
    if (input.jo) {
      // jo 정규화
      let jo = input.jo
      if (/^\d+조의\d+$/.test(jo)) jo = `제${jo}`
      else if (/^\d+조$/.test(jo)) jo = `제${jo}`
      else if (/^\d+$/.test(jo)) jo = `제${jo}조`
      joInput.jo = jo
    }

    const artText = await callTool(getHistoricalLaw, apiClient, joInput)

    const joLabel = input.jo || "전체 조문"
    const header = `═══ ${input.lawName} ${joLabel} (${target} 기준) ═══`
    const versionNote = wasExact
      ? `적용 버전: 시행일 ${selected.efYd} (MST: ${selected.mst})`
      : `※ ${target} 이전 시행 버전 없음. 가장 오래된 버전 사용 (시행일 ${selected.efYd}, MST: ${selected.mst})`

    const parts = [header, versionNote]
    if (!artText.isError) {
      parts.push(sec("조문 내용", artText.text))
    } else {
      parts.push(`\n조문 조회 실패: ${artText.text}\n`)
    }

    return wrapResult(parts.join("\n"))
  } catch (error) {
    return wrapError(error)
  }
}
