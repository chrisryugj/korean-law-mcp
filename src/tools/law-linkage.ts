/**
 * 법령-자치법규 연계(Linkage) 도구 4종
 * - get_linked_ordinances: 법령 기준 자치법규 연계 목록
 * - get_linked_ordinance_articles: 법령-자치법규 조문 연계
 * - get_delegated_laws: 위임법령 (소관부처별)
 * - get_linked_laws_from_ordinance: 자치법규 기준 상위법령 조회
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { truncateResponse } from "../lib/schemas.js"
import { extractTag } from "../lib/xml-parser.js"

// === 스키마 ===

const baseLinkageSchema = z.object({
  query: z.string().describe("검색 키워드"),
  display: z.number().min(1).max(100).default(20).describe("결과 개수 (기본:20, 최대:100)"),
  page: z.number().min(1).default(1).describe("페이지 번호 (기본:1)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC)")
})

export const LinkedOrdinancesSchema = baseLinkageSchema.extend({
  query: z.string().describe("법령명 (예: '국민건강보험법')")
})
export const LinkedOrdinanceArticlesSchema = baseLinkageSchema.extend({
  query: z.string().describe("법령명 (예: '국민건강보험법')")
})
export const DelegatedLawsSchema = baseLinkageSchema.extend({
  query: z.string().describe("부처명 (예: '보건복지부')")
})
export const LinkedLawsFromOrdinanceSchema = baseLinkageSchema.extend({
  query: z.string().describe("자치법규명 (예: '서울특별시 주차장 설치 및 관리 조례')")
})

// === 범용 XML 파서 (응답 구조 미확정 대응) ===

function parseLinkageXML(xml: string, rootTag: string, itemTag: string) {
  const rootRegex = new RegExp(`<${rootTag}[^>]*>([\\s\\S]*?)<\\/${rootTag}>`)
  const rootMatch = xml.match(rootRegex)
  if (!rootMatch) return { totalCnt: 0, page: 1, items: [] as Record<string, string>[] }

  const content = rootMatch[1]
  const totalCnt = parseInt(extractTag(content, "totalCnt") || "0", 10)
  const page = parseInt(extractTag(content, "page") || "1", 10)

  const itemRegex = new RegExp(`<${itemTag}[^>]*>([\\s\\S]*?)<\\/${itemTag}>`, "g")
  const items: Record<string, string>[] = []
  let match
  while ((match = itemRegex.exec(content)) !== null) {
    const fields: Record<string, string> = {}
    // 일반 태그
    const fieldRe = /<([^/>\s]+)>([^<]*)<\/\1>/g
    let fm
    while ((fm = fieldRe.exec(match[1])) !== null) fields[fm[1]] = fm[2].trim()
    // CDATA
    const cdataRe = /<([^/>\s]+)><!\[CDATA\[([\s\S]*?)\]\]><\/\1>/g
    while ((fm = cdataRe.exec(match[1])) !== null) fields[fm[1]] = fm[2].trim()
    if (Object.keys(fields).length > 0) items.push(fields)
  }
  return { totalCnt, page, items }
}

function formatItems(items: Record<string, string>[]): string {
  return items.map((item, i) => {
    const lines = Object.entries(item).filter(([, v]) => v).map(([k, v]) => `  ${k}: ${v}`)
    return `${i + 1}. ${lines.join('\n')}`
  }).join('\n\n')
}

// === 공통 핸들러 ===

interface LinkageConfig {
  target: string
  primaryRoot: string
  fallbackRoot: string
  title: string
  emptyMsg: string
}

type LinkageInput = z.infer<typeof baseLinkageSchema>

async function handleLinkage(apiClient: LawApiClient, input: LinkageInput, cfg: LinkageConfig) {
  try {
    const xml = await apiClient.fetchApi({
      endpoint: "lawSearch.do",
      target: cfg.target,
      type: "XML",
      extraParams: { query: String(input.query), display: String(input.display), page: String(input.page) },
      apiKey: input.apiKey,
    })

    let result = parseLinkageXML(xml, cfg.primaryRoot, "law")
    if (result.totalCnt === 0 && result.items.length === 0) {
      result = parseLinkageXML(xml, cfg.fallbackRoot, "law")
    }

    if (result.items.length === 0) {
      return { content: [{ type: "text", text: truncateResponse(`'${input.query}' ${cfg.emptyMsg}`) }] }
    }

    let output = `${cfg.title} (총 ${result.totalCnt}건, ${result.page}페이지)\n`
    output += `검색어: ${input.query}\n\n`
    output += formatItems(result.items)
    return { content: [{ type: "text", text: truncateResponse(output) }] }
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true
    }
  }
}

// === 도구 함수 ===

export const getLinkedOrdinances = (apiClient: LawApiClient, input: LinkageInput) =>
  handleLinkage(apiClient, input, {
    target: "lnkLs", primaryRoot: "LnkLsSearch", fallbackRoot: "lnkLs",
    title: "법령-자치법규 연계", emptyMsg: "연계 자치법규가 없습니다."
  })

export const getLinkedOrdinanceArticles = (apiClient: LawApiClient, input: LinkageInput) =>
  handleLinkage(apiClient, input, {
    target: "lnkLsOrdJo", primaryRoot: "LnkLsOrdJoSearch", fallbackRoot: "lnkLsOrdJo",
    title: "법령-자치법규 조문 연계", emptyMsg: "조문 연계 결과가 없습니다."
  })

export const getDelegatedLaws = (apiClient: LawApiClient, input: LinkageInput) =>
  handleLinkage(apiClient, input, {
    target: "lnkDep", primaryRoot: "LnkDepSearch", fallbackRoot: "lnkDep",
    title: "위임법령 목록", emptyMsg: "위임법령이 없습니다."
  })

export const getLinkedLawsFromOrdinance = (apiClient: LawApiClient, input: LinkageInput) =>
  handleLinkage(apiClient, input, {
    target: "lnkOrd", primaryRoot: "LnkOrdSearch", fallbackRoot: "lnkOrd",
    title: "자치법규 → 상위법령", emptyMsg: "상위법령이 없습니다."
  })
