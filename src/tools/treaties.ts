import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { parseTreatyXML } from "../lib/xml-parser.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"

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
      const keywords = kw.trim().split(/\s+/)
      const lines = [`[NOT_FOUND] '${kw}' 조약 검색 결과가 없습니다.`, "", "⚠️ LLM은 조약 내용을 추측하지 마세요."]
      if (keywords.length >= 2) {
        lines.push("")
        lines.push("힌트: 법제처 API는 공백 구분 키워드를 AND 조건으로 처리합니다. 키워드가 많을수록 결과가 줄어듭니다.")
        lines.push(`재시도 제안: "${keywords[0]}" 또는 "${keywords.slice(0, 2).join(" ")}"`)
      }
      lines.push("")
      lines.push("대안:")
      lines.push(`  1. 법령 검색: search_law(query="${kw}")`)
      return { content: [{ type: "text", text: lines.join("\n") }], isError: true }
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

    output += `\n전문 조회: execute_tool(tool_name="get_treaty_text", params={treatySeq:"조약번호"})\n`

    return { content: [{ type: "text", text: truncateResponse(output) }] }
  } catch (error) {
    return formatToolError(error as Error, "treaties")
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

    // API는 BothTrtyService 또는 TrtyService로 응답
    const trty = data.BothTrtyService || data.TrtyService
    if (!trty) {
      throw new Error("Treaty not found or invalid response format")
    }

    // 조약내용이 중첩 객체일 수 있음
    const bodyObj = trty.조약내용 || {}
    const bodyText = typeof bodyObj === "string" ? bodyObj : bodyObj.조약내용 || ""

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

    if (bodyText) {
      output += `조약 본문:\n${bodyText}\n`
    }

    return {
      content: [{
        type: "text",
        text: truncateResponse(output)
      }]
    }
  } catch (error) {
    return formatToolError(error as Error, "treaties")
  }
}
