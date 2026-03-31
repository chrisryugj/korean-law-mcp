import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { parseTreatyXML } from "../lib/xml-parser.js"
import { truncateResponse } from "../lib/schemas.js"

export const searchTreatiesSchema = z.object({
  query: z.string().optional().describe("검색 키워드 (예: '투자보장', '범죄인인도')"),
  cls: z.enum(["1", "2"]).optional().describe("조약구분 (1=양자조약, 2=다자조약)"),
  natCd: z.string().optional().describe("국가코드 (예: 'US', 'JP')"),
  eftYd: z.string().optional().describe("발효일 (YYYYMMDD)"),
  concYd: z.string().optional().describe("체결일 (YYYYMMDD)"),
  display: z.number().min(1).max(100).default(20).describe("결과 수 (기본:20, 최대:100)"),
  page: z.number().min(1).default(1).describe("페이지 번호 (기본:1)"),
  sort: z.enum(["lasc", "ldes", "dasc", "ddes"]).optional()
    .describe("정렬: lasc/ldes(조약명), dasc/ddes(날짜)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
})

export type SearchTreatiesInput = z.infer<typeof searchTreatiesSchema>

export async function searchTreaties(
  apiClient: LawApiClient,
  args: SearchTreatiesInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const extraParams: Record<string, string> = {
      display: String(args.display || 20),
      page: String(args.page || 1),
    }
    if (args.query) extraParams.query = args.query
    if (args.cls) extraParams.cls = args.cls
    if (args.natCd) extraParams.natCd = args.natCd
    if (args.eftYd) extraParams.eftYd = args.eftYd
    if (args.concYd) extraParams.concYd = args.concYd
    if (args.sort) extraParams.sort = args.sort

    const xmlText = await apiClient.fetchApi({
      endpoint: "lawSearch.do",
      target: "trty",
      extraParams,
      apiKey: args.apiKey,
    })

    const result = parseTreatyXML(xmlText)
    const treaties = result.items

    if (result.totalCnt === 0) {
      const kw = args.query || "관련 키워드"
      const hint = [
        "검색 결과가 없습니다.\n\n개선 방법:",
        `  1. 단순 키워드: search_treaties(query="${kw.split(/\s+/)[0]}")`,
        `  2. 법령 검색: search_law(query="${kw}")`,
      ].join("\n")
      return { content: [{ type: "text", text: hint }], isError: true }
    }

    let output = `조약 검색 결과 (총 ${result.totalCnt}건, ${result.page}페이지):\n\n`

    for (const t of treaties) {
      output += `[${t.조약일련번호}] ${t.조약명}\n`
      output += `  조약번호: ${t.조약번호 || "N/A"}\n`
      output += `  체결일: ${t.체결일자 || "N/A"}\n`
      output += `  발효일: ${t.발효일자 || "N/A"}\n`
      output += `  구분: ${t.조약구분 || "N/A"}\n`
      if (t.조약상세링크) {
        output += `  링크: ${t.조약상세링크}\n`
      }
      output += `\n`
    }

    output += `\n전문을 조회하려면 get_treaty_text Tool을 사용하세요.\n`

    return { content: [{ type: "text", text: truncateResponse(output) }] }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true }
  }
}

export const getTreatyTextSchema = z.object({
  id: z.string().describe("조약일련번호 (search_treaties 결과에서 획득)"),
  chrClsCd: z.enum(["010202", "010203"]).default("010202")
    .describe("언어 (010202=한글, 010203=영문, 기본:한글)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
})

export type GetTreatyTextInput = z.infer<typeof getTreatyTextSchema>

export async function getTreatyText(
  apiClient: LawApiClient,
  args: GetTreatyTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const extraParams: Record<string, string> = {
      ID: String(args.id),
      chrClsCd: String(args.chrClsCd || "010202"),
    }

    const responseText = await apiClient.fetchApi({
      endpoint: "lawService.do",
      target: "trty",
      type: "JSON",
      extraParams,
      apiKey: args.apiKey,
    })

    let data: any
    try {
      data = JSON.parse(responseText)
    } catch {
      throw new Error("Failed to parse JSON response from API")
    }

    if (!data.TrtyService) {
      throw new Error("Treaty not found or invalid response format")
    }

    const trty = data.TrtyService
    const basic = {
      조약명: trty.조약명,
      조약번호: trty.조약번호,
      체결일자: trty.체결일자,
      발효일자: trty.발효일자,
      조약구분: trty.조약구분명,
      체결상대국: trty.체결상대국,
    }

    let output = `=== ${basic.조약명 || "조약"} ===\n\n`

    output += `기본 정보:\n`
    output += `  조약번호: ${basic.조약번호 || "N/A"}\n`
    output += `  체결일: ${basic.체결일자 || "N/A"}\n`
    output += `  발효일: ${basic.발효일자 || "N/A"}\n`
    output += `  구분: ${basic.조약구분 || "N/A"}\n`
    output += `  체결상대국: ${basic.체결상대국 || "N/A"}\n\n`

    if (trty.조약본문) {
      output += `조약 본문:\n${trty.조약본문}\n`
    }

    return {
      content: [{
        type: "text",
        text: truncateResponse(output)
      }]
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true }
  }
}
