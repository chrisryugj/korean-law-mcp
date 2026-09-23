import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { parseTreatyXML } from "../lib/xml-parser.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError, notFoundResponse } from "../lib/errors.js"

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

    // 조회 키는 조약일련번호다. 종전 안내(treatySeq:"조약번호")는 파라미터명도 틀렸고, 조약번호를
    // ID로 넣으면 다른 조약이 조회됐다: 조약번호 234 = ICSID(일련번호 4037)인데 ID=234는 GSTP (2026-09-23 리뷰 D1).
    output += `\n전문 조회: get_decision_text(domain="treaty", id="대괄호 안 조약일련번호"). 조약번호는 조회 키가 아닙니다.\n`

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

    // 루트 키가 조약 종류별로 다르다: 양자 BothTrtyService, 다자 MultTrtyService (2026-09-23 실측).
    // 두 이름만 받던 종전 코드는 다자조약 전건을 "not found"로 떨어뜨렸다 (리뷰 D1).
    const rootKey = Object.keys(data ?? {}).find((k) => k.endsWith("TrtyService"))
    const trty = rootKey ? data[rootKey] : undefined
    if (!trty) {
      // 없는 조약일련번호는 "{}"로 온다(실측 ID=99999999). 조약번호를 ID로 넣는 실수가 흔해 식별자 종류를 짚는다.
      if (data && typeof data === "object" && Object.keys(data).length === 0) {
        return notFoundResponse(`조약일련번호 '${args.id}'에 해당하는 조약이 없습니다.`, [
          "search_decisions(domain=\"treaty\") 결과의 대괄호 안 조약일련번호를 쓰세요. 조약번호는 조회 키가 아닙니다.",
        ])
      }
      throw new Error(`조약 응답 형식을 인식하지 못했습니다 (최상위 키: ${Object.keys(data ?? {}).join(", ") || "없음"})`)
    }

    // 조약내용이 중첩 객체일 수 있음
    const bodyObj = trty.조약내용 || {}
    const bodyText = typeof bodyObj === "string" ? bodyObj : bodyObj.조약내용 || ""

    // 메타데이터는 최상위가 아니라 조약기본정보·추가정보에 들어 있다. 최상위를 읽던 종전 코드는
    // 조약명까지 전부 N/A였다. 추가정보의 빈 값은 문자열 "null"로 온다 (2026-09-23 실측).
    const info = trty.조약기본정보 || trty
    const extra = trty.추가정보 || {}
    const val = (v: unknown): string => {
      const s = v == null ? "" : String(v).trim()
      return s === "null" ? "" : s
    }
    const kindByCode: Record<string, string> = { "440101": "양자조약", "440102": "다자조약" }
    const kind = val(info.조약구분명) || kindByCode[val(info.조약구분코드)] ||
      (rootKey === "MultTrtyService" ? "다자조약" : rootKey === "BothTrtyService" ? "양자조약" : "")
    const partnerName = val(extra.체결대상국가한글)
    const partnerCode = val(extra.체결대상국가)
    const partner = partnerName && partnerCode && partnerCode !== partnerName ? `${partnerName} (${partnerCode})` : partnerName || partnerCode

    const basic = {
      조약명: val(info.조약명_한글) || val(info.조약명),
      조약명영문: val(info.조약명_영문),
      조약일련번호: val(info.조약일련번호),
      조약번호: val(info.조약번호),
      체결일자: val(info.서명일자) || val(extra.체결일자) || val(info.체결일자),
      발효일자: val(info.발효일자),
      조약구분: kind,
      체결상대국: partner || val(info.체결상대국),
      분야: val(extra.다자조약분야명) || val(extra.양자조약분야명),
    }

    let output = `=== ${basic.조약명 || "조약"} ===\n`
    if (basic.조약명영문) output += `(${basic.조약명영문})\n`
    output += `\n`

    output += `기본 정보:\n`
    if (basic.조약일련번호) output += `  조약일련번호: ${basic.조약일련번호}\n`
    output += `  조약번호: ${basic.조약번호 || "N/A"}\n`
    output += `  체결일: ${basic.체결일자 || "N/A"}\n`
    output += `  발효일: ${basic.발효일자 || "N/A"}\n`
    output += `  구분: ${basic.조약구분 || "N/A"}\n`
    // 다자조약에는 체결상대국이 없다. "N/A"로 찍으면 미상으로 읽히므로 값이 있을 때만 싣는다.
    if (basic.체결상대국) output += `  체결상대국: ${basic.체결상대국}\n`
    if (basic.분야) output += `  분야: ${basic.분야}\n`
    output += `\n`

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
