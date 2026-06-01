/**
 * Unified Decision Tools — 16개 도메인의 search/get을 2개 도구로 통합
 *
 * 기존 34개 도구 → search_decisions + get_decision_text
 * 컨텍스트 절감: ~51KB → ~3KB
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import type { LooseToolResponse } from "../lib/types.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"
import { compactLongSections } from "../lib/decision-compact.js"

// 기존 handler 재사용 (함수 직접 import)
import { searchPrecedents, getPrecedentText, renderPrecedentSearchResult } from "./precedents.js"
import { searchInterpretations, getInterpretationText } from "./interpretations.js"
import { searchTaxTribunalDecisions, getTaxTribunalDecisionText } from "./tax-tribunal-decisions.js"
import {
  searchCustomsInterpretations, getCustomsInterpretationText,
  searchNtsInterpretations, getNtsInterpretationText,
} from "./customs-interpretations.js"
import { searchConstitutionalDecisions, getConstitutionalDecisionText } from "./constitutional-decisions.js"
import { searchAdminAppeals, getAdminAppealText } from "./admin-appeals.js"
import {
  searchFtcDecisions, getFtcDecisionText,
  searchPipcDecisions, getPipcDecisionText,
  searchNlrcDecisions, getNlrcDecisionText,
  searchAcrDecisions, getAcrDecisionText,
} from "./committee-decisions.js"
import {
  searchAppealReviewDecisions, getAppealReviewDecisionText,
  searchAcrSpecialAppeals, getAcrSpecialAppealText,
} from "./special-admin-appeals.js"
import { searchSchoolRules, getSchoolRuleText, searchPublicCorpRules, getPublicCorpRuleText, searchPublicInstitutionRules, getPublicInstitutionRuleText } from "./institutional-rules.js"
import { searchTreaties, getTreatyText } from "./treaties.js"
import { searchEnglishLaw, getEnglishLawText } from "./english-law.js"
import { searchPrecedentsStructured } from "./precedent-search-core.js"
import { fetchPrecedentEvidence, validatePrecedentSearchResult } from "./precedent-evidence.js"

// ========================================
// Domain enum & config
// ========================================

const DOMAINS = [
  "precedent", "interpretation", "tax_tribunal", "customs", "nts",
  "constitutional", "admin_appeal", "ftc", "pipc", "nlrc", "acr",
  "appeal_review", "acr_special",
  "school", "public_corp", "public_inst",
  "treaty", "english_law",
] as const

type Domain = typeof DOMAINS[number]

const DOMAIN_LABELS: Record<Domain, string> = {
  precedent: "판례",
  interpretation: "해석례",
  tax_tribunal: "조세심판원 재결례",
  customs: "관세청 법령해석",
  nts: "국세청 법령해석",
  constitutional: "헌재 결정례",
  admin_appeal: "행정심판례",
  ftc: "공정위 결정문",
  pipc: "개인정보위 결정문",
  nlrc: "노동위 결정문",
  acr: "권익위 결정문",
  appeal_review: "소청심사 재결례",
  acr_special: "권익위 특별행정심판",
  school: "학칙",
  public_corp: "공사공단 규정",
  public_inst: "공공기관 규정",
  treaty: "조약",
  english_law: "영문법령",
}

// Search handler dispatch table
const SEARCH_HANDLERS: Record<Domain, (api: LawApiClient, args: any) => Promise<LooseToolResponse>> = {
  precedent: searchPrecedents,
  interpretation: searchInterpretations,
  tax_tribunal: searchTaxTribunalDecisions,
  customs: searchCustomsInterpretations,
  nts: searchNtsInterpretations,
  constitutional: searchConstitutionalDecisions,
  admin_appeal: searchAdminAppeals,
  ftc: searchFtcDecisions,
  pipc: searchPipcDecisions,
  nlrc: searchNlrcDecisions,
  acr: searchAcrDecisions,
  appeal_review: searchAppealReviewDecisions,
  acr_special: searchAcrSpecialAppeals,
  school: searchSchoolRules,
  public_corp: searchPublicCorpRules,
  public_inst: searchPublicInstitutionRules,
  treaty: searchTreaties,
  english_law: searchEnglishLaw,
}

/**
 * 이미 compactBody가 적용된 도메인 — get_decision_text 후처리 축약 skip
 * (precedents.ts, constitutional-decisions.ts, admin-appeals.ts에서 자체 적용)
 */
const ALREADY_COMPACTED: ReadonlySet<Domain> = new Set(["precedent", "constitutional", "admin_appeal"])

// Get handler dispatch table
const GET_HANDLERS: Record<Domain, (api: LawApiClient, args: any) => Promise<LooseToolResponse>> = {
  precedent: getPrecedentText,
  interpretation: getInterpretationText,
  tax_tribunal: getTaxTribunalDecisionText,
  customs: getCustomsInterpretationText,
  nts: getNtsInterpretationText,
  constitutional: getConstitutionalDecisionText,
  admin_appeal: getAdminAppealText,
  ftc: getFtcDecisionText,
  pipc: getPipcDecisionText,
  nlrc: getNlrcDecisionText,
  acr: getAcrDecisionText,
  appeal_review: getAppealReviewDecisionText,
  acr_special: getAcrSpecialAppealText,
  school: getSchoolRuleText,
  public_corp: getPublicCorpRuleText,
  public_inst: getPublicInstitutionRuleText,
  treaty: getTreatyText,
  english_law: getEnglishLawText,
}

// ========================================
// search_decisions
// ========================================

export const SearchDecisionsSchema = z.object({
  domain: z.enum(DOMAINS).describe(
    "도메인 선택 (enum 값 참조)"
  ),
  query: z.string().optional().describe("검색 키워드"),
  display: z.number().min(1).max(100).default(20).optional().describe("결과 수 (기본20)"),
  page: z.number().min(1).default(1).optional().describe("페이지 (기본1)"),
  sort: z.string().optional().describe("정렬: lasc/ldes/dasc/ddes/nasc/ndes"),
  options: z.record(z.string(), z.unknown()).optional().describe(
    "도메인별 옵션. prec:{court,caseNumber,fromDate,toDate} tax_tribunal:{cls,gana,dpaYd,rslYd} customs:{inq,rpl,gana,explYd} constitutional:{caseNumber} interpretation:{fromDate,toDate} treaty:{cls,natCd,eftYd,concYd}"
  ),
  apiKey: z.string().optional(),
})

export type SearchDecisionsInput = z.infer<typeof SearchDecisionsSchema>

function isEnabled(value: unknown): boolean {
  return value === true || value === "true"
}

function getPositiveIntegerOption(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.trunc(parsed)
  }
  return undefined
}

async function searchPrecedentDecisionsWithText(
  apiClient: LawApiClient,
  args: Record<string, unknown>,
  detailLimit?: number
): Promise<LooseToolResponse> {
  const apiKey = typeof args.apiKey === "string" ? args.apiKey : undefined
  const searchResult = await searchPrecedentsStructured(apiClient, args as any, {
    validateResult: validation => validatePrecedentSearchResult(apiClient, validation, { apiKey }),
  })
  const listText = renderPrecedentSearchResult(searchResult)
  const evidence = await fetchPrecedentEvidence(apiClient, searchResult, {
    apiKey,
    detailLimit,
    full: false,
  })
  const text = evidence ? `${listText}\n\n▶ 관련 판례 상세\n${evidence.text}` : listText

  return {
    content: [{ type: "text", text: truncateResponse(text) }],
    isError: searchResult.hits.length === 0 || undefined,
  }
}

export async function searchDecisions(
  apiClient: LawApiClient,
  input: SearchDecisionsInput
): Promise<LooseToolResponse> {
  const handler = SEARCH_HANDLERS[input.domain]
  if (!handler) {
    return {
      content: [{ type: "text", text: `알 수 없는 도메인: ${input.domain}` }],
      isError: true,
    }
  }

  try {
    // 공통 파라미터 + options 병합
    const args: Record<string, unknown> = {
      display: input.display ?? 20,
      page: input.page ?? 1,
    }
    if (input.query !== undefined) args.query = input.query
    if (input.sort) args.sort = input.sort
    if (input.apiKey) args.apiKey = input.apiKey

    // 도메인별 추가 옵션 병합 (핵심 필드 덮어쓰기 방지)
    if (input.options) {
      const reserved = new Set(["query", "display", "page", "sort", "apiKey", "domain"])
      for (const [k, v] of Object.entries(input.options)) {
        if (!reserved.has(k)) args[k] = v
      }
    }

    if (input.domain === "precedent" && isEnabled(input.options?.includeText)) {
      return await searchPrecedentDecisionsWithText(
        apiClient,
        args,
        getPositiveIntegerOption(input.options?.detailLimit)
      )
    }

    return await handler(apiClient, args)
  } catch (error) {
    return formatToolError(error as Error, `search_decisions[${input.domain}]`)
  }
}

// ========================================
// get_decision_text
// ========================================

export const GetDecisionTextSchema = z.object({
  domain: z.enum(DOMAINS).describe("도메인 선택 (enum 값 참조)"),
  id: z.string().describe("일련번호/ID (search 결과에서 획득)"),
  full: z.boolean().optional().describe("true=본문 전문 그대로. 미지정=이유/전문 섹션 계단식 축약 (판시·요지·주문은 항상 full)"),
  options: z.record(z.string(), z.unknown()).optional().describe(
    "도메인별 옵션. treaty:{chrClsCd:'010202'(한)/'010203'(영)} english_law:{mst,lawName} prec/constitutional/admin_appeal/interpretation:{caseName}"
  ),
  apiKey: z.string().optional(),
})

export type GetDecisionTextInput = z.infer<typeof GetDecisionTextSchema>

export async function getDecisionText(
  apiClient: LawApiClient,
  input: GetDecisionTextInput
): Promise<LooseToolResponse> {
  const handler = GET_HANDLERS[input.domain]
  if (!handler) {
    return {
      content: [{ type: "text", text: `알 수 없는 도메인: ${input.domain}` }],
      isError: true,
    }
  }

  try {
    // ID 매핑: english_law는 lawId, 나머지는 id
    const args: Record<string, unknown> = input.domain === "english_law"
      ? { lawId: input.id }
      : { id: input.id }

    if (input.apiKey) args.apiKey = input.apiKey
    if (input.full !== undefined) args.full = input.full

    // 도메인별 추가 옵션 병합 (핵심 필드 덮어쓰기 방지)
    if (input.options) {
      const reserved = new Set(["id", "apiKey", "domain", "full"])
      for (const [k, v] of Object.entries(input.options)) {
        if (!reserved.has(k)) args[k] = v
      }
    }

    const result = await handler(apiClient, args)

    // full=true가 아니고 자체 compact 미적용 도메인이면 후처리 축약
    // (14개 domain 중 precedent/constitutional/admin_appeal 제외 14개에 적용)
    if (input.full !== true && !result.isError && !ALREADY_COMPACTED.has(input.domain)) {
      result.content = result.content.map((c) => {
        if (!c.text || typeof c.text !== "string") return c
        const compacted = compactLongSections(c.text)
        return compacted === c.text ? c : { ...c, text: truncateResponse(compacted) }
      })
    }

    return result
  } catch (error) {
    return formatToolError(error as Error, `get_decision_text[${input.domain}]`)
  }
}
