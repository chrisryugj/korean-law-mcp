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
import { formatToolError } from "../lib/errors.js"

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
  // 실측: lnkDep은 서버측 검색 필터가 없다(query 무시, 전체 덤프+페이징만).
  // 조회 페이지 내 클라이언트 필터만 가능 — 법령 기준 연계는 get_linked_ordinances 권장.
  query: z.string().describe("필터 키워드(법령명 등) — ⚠️ 법제처가 이 목록의 서버측 검색을 지원하지 않아 조회 페이지 내 부분 필터만 됩니다. 법령 기준 자치법규 연계는 get_linked_ordinances 사용 권장")
})
export const LinkedLawsFromOrdinanceSchema = baseLinkageSchema.extend({
  query: z.string().describe("자치법규명 (예: '서울특별시 주차장 설치 및 관리 조례')")
})

// === 범용 XML 파서 (응답 구조 미확정 대응) ===

function parseLinkageXML(xml: string, rootTag: string, itemTag: string) {
  // 루트 태그는 대소문자 무시로 매칭 — 실측상 lnkDepSearch·lnkOrdJoSearch처럼
  // 소문자로 시작해, 대문자 시작을 가정한 종전 코드는 3/4 타깃에서 루트 매칭에
  // 실패해 매 호출 0건(NOT_FOUND)이었다.
  const rootRegex = new RegExp(`<${rootTag}[^>]*>([\\s\\S]*?)<\\/${rootTag}>`, "i")
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
  /** 서버가 query 필터를 지원하지 않는 전체 덤프 타깃 (실측: lnkDep 총 10만+건, query 무시) */
  serverFilterless?: boolean
}

type LinkageInput = z.infer<typeof baseLinkageSchema>

async function handleLinkage(apiClient: LawApiClient, input: LinkageInput, cfg: LinkageConfig) {
  try {
    const xml = await apiClient.fetchApi({
      endpoint: "lawSearch.do",
      target: cfg.target,
      extraParams: {
        query: String(input.query),
        // 필터 미지원 타깃은 클라이언트 필터 풀을 최대로 (API 상한 100)
        display: cfg.serverFilterless ? "100" : String(input.display || 20),
        page: String(input.page || 1),
      },
      apiKey: input.apiKey,
    })

    let result = parseLinkageXML(xml, cfg.primaryRoot, "law")
    if (result.totalCnt === 0 && result.items.length === 0) {
      result = parseLinkageXML(xml, cfg.fallbackRoot, "law")
    }

    if (result.items.length === 0) {
      return {
        content: [{ type: "text", text: truncateResponse(`[NOT_FOUND] '${input.query}' ${cfg.emptyMsg}\n⚠️ LLM은 연계 정보를 추측/생성하지 마세요.`) }],
        isError: true
      }
    }

    if (cfg.serverFilterless) {
      // 서버가 query를 무시하고 전체 목록을 돌려주는 타깃 — 조회분을 그대로 내보내면
      // 무관한 행들이 "검색 결과"로 위장된다. 조회 페이지 내 클라이언트 필터 + 한계 명시.
      const qKey = String(input.query).replace(/\s+/g, "")
      const fetched = result.items.length
      const matched = qKey
        ? result.items.filter(it => Object.values(it).some(v => v.replace(/\s+/g, "").includes(qKey)))
        : result.items

      const scopeNote = `⚠️ 법제처가 이 목록(서버 전체 ${result.totalCnt}건)의 검색 필터를 지원하지 않아, 조회한 ${result.page}페이지(${fetched}건) 안에서만 '${input.query}'를 필터했습니다 — 전수 결과가 아닙니다.\n` +
        `💡 법령 기준 자치법규 연계는 서버 필터가 지원되는 get_linked_ordinances(query="법령명")를 사용하세요.`

      if (matched.length === 0) {
        return {
          content: [{ type: "text", text: truncateResponse(`[NOT_FOUND] 조회한 ${result.page}페이지(${fetched}건) 내 '${input.query}' 매칭 없음.\n${scopeNote}`) }],
          isError: true
        }
      }
      let output = `${cfg.title} (조회 ${result.page}페이지 ${fetched}건 중 '${input.query}' 매칭 ${matched.length}건)\n\n`
      output += formatItems(matched)
      output += `\n\n${scopeNote}`
      return { content: [{ type: "text", text: truncateResponse(output) }] }
    }

    let output = `${cfg.title} (총 ${result.totalCnt}건, ${result.page}페이지)\n`
    output += `검색어: ${input.query}\n\n`
    output += formatItems(result.items)
    return { content: [{ type: "text", text: truncateResponse(output) }] }
  } catch (error) {
    return formatToolError(error, cfg.title)
  }
}

// === 도구 함수 ===

export const getLinkedOrdinances = (apiClient: LawApiClient, input: LinkageInput) =>
  handleLinkage(apiClient, input, {
    target: "lnkLs", primaryRoot: "LawSearch", fallbackRoot: "LnkLsSearch",
    title: "법령-자치법규 연계", emptyMsg: "연계 자치법규가 없습니다."
  })

export const getLinkedOrdinanceArticles = (apiClient: LawApiClient, input: LinkageInput) =>
  handleLinkage(apiClient, input, {
    // 실측 루트는 lnkOrdJoSearch (LnkLsOrdJoSearch 아님 — 이름 자체가 달랐다)
    target: "lnkLsOrdJo", primaryRoot: "lnkOrdJoSearch", fallbackRoot: "LawSearch",
    title: "법령-자치법규 조문 연계", emptyMsg: "조문 연계 결과가 없습니다."
  })

export const getDelegatedLaws = (apiClient: LawApiClient, input: LinkageInput) =>
  handleLinkage(apiClient, input, {
    // 실측 루트는 lnkDepSearch — 종전 대문자 가정(LnkDepSearch)으로 매 호출 0건이었다
    target: "lnkDep", primaryRoot: "lnkDepSearch", fallbackRoot: "LawSearch",
    title: "위임 연계 자치법규 목록", emptyMsg: "위임 연계 자치법규가 없습니다.",
    serverFilterless: true
  })

export const getLinkedLawsFromOrdinance = (apiClient: LawApiClient, input: LinkageInput) =>
  handleLinkage(apiClient, input, {
    // 실측 루트는 OrdinSearch (LnkOrdSearch 아님)
    target: "lnkOrd", primaryRoot: "OrdinSearch", fallbackRoot: "LawSearch",
    title: "자치법규 → 상위법령", emptyMsg: "상위법령이 없습니다."
  })
