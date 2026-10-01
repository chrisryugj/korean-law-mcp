/** Chain keyword routing and dispute-domain lookup configuration. */
import { z } from "zod"
import type { McpTool } from "../lib/types.js"
import { searchTaxTribunalDecisions } from "./tax-tribunal-decisions.js"
import { searchFtcDecisions, searchNlrcDecisions, searchPipcDecisions } from "./committee-decisions.js"

/**
 * 체인 query 길이 상한 (#121).
 *
 * 체인 query 는 "법령명 + 키워드"라 짧다. 평가 세트(R/B 케이스 76건)의 최장 정상 질의가
 * 145자(인용 검증용 붙여넣기)이므로 그 13배가 넘는 여유를 뒀다.
 * 상한이 없으면 무제한 사용자 텍스트가 routeQuery 의 O(n²) 패턴에 그대로 들어가
 * 이벤트 루프를 장기 점유한다(8.5k자 476ms, HTTP body 한도 100kb 안에서도 통과).
 */
export const MAX_CHAIN_QUERY = 2000

type DomainType = "customs" | "tax" | "labor" | "privacy" | "competition"
export type ExpansionType = "annex_fee" | "annex_form" | "annex_table" | "precedent" | "interpretation"

export function detectExpansions(query: string): ExpansionType[] {
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
export function stripOrdinanceKeywords(query: string): string {
  return query
    .replace(/(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)(?:시|도|특별시|광역시|특별자치시|특별자치도)?/g, "")
    .replace(/\s*(조례|규칙|자치법규)\s*/g, " ")
    .trim()
}

export function detectDomain(query: string): DomainType | null {
  if (/관세|수출|수입|통관|FTA|원산지/.test(query)) return "customs"
  if (/세금|세무|소득세|법인세|부가세|취득세|재산세|지방세|국세/.test(query)) return "tax"
  if (/근로|노동|임금|해고|산재|산업안전|기간제|퇴직/.test(query)) return "labor"
  if (/개인정보|정보보호|CCTV|정보공개/.test(query)) return "privacy"
  if (/공정거래|독점|담합|불공정/.test(query)) return "competition"
  return null
}

/** 쟁송 대비 체인의 도메인별 전문 결정례 갈래 — 검색 핸들러·상세조회 도구·표시명 한 벌 */
export const DISPUTE_DOMAIN_SEARCH: Partial<Record<DomainType | "general", {
  handler: McpTool["handler"]
  searchTool: string
  label: string
}>> = {
  tax: { handler: searchTaxTribunalDecisions, searchTool: "search_tax_tribunal_decisions", label: "조세심판원 결정" },
  labor: { handler: searchNlrcDecisions, searchTool: "search_nlrc_decisions", label: "중앙노동위 결정" },
  competition: { handler: searchFtcDecisions, searchTool: "search_ftc_decisions", label: "공정위 결정" },
  privacy: { handler: searchPipcDecisions, searchTool: "search_pipc_decisions", label: "개인정보위 결정" },
}


export const chainDisputePrepSchema = z.object({
  query: z.string().max(MAX_CHAIN_QUERY).describe("분쟁 키워드 (예: '건축허가 취소 행정심판', '징계처분 감경')"),
  domain: z.enum(["tax", "labor", "privacy", "competition", "general"]).optional()
    .describe("전문 분야 (tax=조세심판, labor=노동위, privacy=개인정보위, competition=공정위). 미지정 시 쿼리에서 자동 감지"),
  apiKey: z.string().optional(),
})
