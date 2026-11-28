/**
 * get_ordinance Tool - 자치법규 조회
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { cleanHtml } from "../lib/article-parser.js"
import { buildJO } from "../lib/law-parser.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"
import { toArray, parseSearchXML, extractTag } from "../lib/xml-parser.js"

export const GetOrdinanceSchema = z.object({
  ordinSeq: z.string().optional().describe("자치법규 일련번호 (검색결과의 [번호])"),
  id: z.string().optional().describe("ordinSeq 별칭 — 검색결과 [번호]. 힌트가 id=로 안내하는 경우 대응"),
  query: z.string().optional().describe("조례명 (ordinSeq 대신, 지자체명을 넣을 것. 예: '서울특별시 광진구 주차장 설치 및 관리 조례')"),
  jo: z.string().optional().describe("조문 번호 (예: '제20조', '20'). 지정 시 해당 조문 본문만 반환"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
}).refine(
  data => data.ordinSeq || data.id || data.query,
  { message: "ordinSeq(또는 별칭 id)·query 중 하나는 필수입니다" }
)

export type GetOrdinanceInput = z.infer<typeof GetOrdinanceSchema>

export async function getOrdinance(
  apiClient: LawApiClient,
  input: GetOrdinanceInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    // jo가 한글이면 JO 코드로 변환하여 API에 전달 (서버 필터링 시도)
    let joCode: string | undefined
    // 숫자만 준 조 번호("20"·"20의2")도 받는다
    if (input.jo && /^\s*\d+(?:\s*의\s*\d+)?\s*$/.test(input.jo)) input = { ...input, jo: `제${input.jo.replace(/\s+/g, "").replace("의", "조의")}${/의/.test(input.jo) ? "" : "조"}` }
    if (input.jo) {
      try {
        joCode = /제\d+조/.test(input.jo) ? buildJO(input.jo) : input.jo
      } catch {
        // JO 코드 변환 실패 시 클라이언트 필터링만 사용
      }
    }

    let ordinSeq = input.ordinSeq || input.id
    if (!ordinSeq) {
      // 조례명으로 찾는다. 이름이 같으면 그것, 아니면 첫 결과
      const xml = await apiClient.searchOrdinance({ query: input.query!.replace(/\s+/g, " ").trim(), display: 10, apiKey: input.apiKey })
      const rows = parseSearchXML(xml, "OrdinSearch", "law", c => ({ seq: extractTag(c, "자치법규일련번호"), name: extractTag(c, "자치법규명") })).items
      const norm = (x: string) => x.replace(/\s+/g, "")
      const pick = rows.find(r => norm(r.name) === norm(input.query!)) ?? rows.find(r => norm(r.name).includes(norm(input.query!))) ?? rows[0]
      if (!pick?.seq) return { content: [{ type: "text", text: `[NOT_FOUND] '${input.query}' 자치법규를 찾지 못했습니다. 지자체명을 넣어 search_ordinance 로 찾으세요.` }], isError: true }
      ordinSeq = pick.seq
    }
    const jsonText = await apiClient.getOrdinance(ordinSeq, joCode, input.apiKey)
    const json = JSON.parse(jsonText)

    const lawService = json?.LawService

    if (!lawService) {
      return {
        content: [{
          type: "text",
          text: "[NOT_FOUND] 자치법규 데이터를 찾을 수 없습니다.\n⚠️ LLM은 조례 내용을 추측/생성하지 마세요. search_ordinance로 유효한 ordinSeq를 먼저 확인하세요."
        }],
        isError: true
      }
    }

    const ordinance = lawService.자치법규기본정보 || {}

    let resultText = `자치법규명: ${ordinance.자치법규명 || "알 수 없음"}\n`
    // 공포일자는 최신 공포본의 날짜다. "제정일"로 찍으면 일부개정일이 제정일로 둔갑한다
    // (실측 강남구 규칙: 제개정정보=일부개정, 공포일자=20210416). 2026-09-23 리뷰 D11.
    resultText += `공포일: ${ordinance.공포일자 || ""}\n`
    if (ordinance.제개정정보) resultText += `제개정: ${ordinance.제개정정보}\n`
    resultText += `자치단체: ${ordinance.지자체기관명 || ""}\n`
    resultText += `시행일: ${ordinance.시행일자 || ""}\n`

    if (ordinance.담당부서명) {
      resultText += `소관부서: ${ordinance.담당부서명}\n`
    }

    resultText += `\n---\n\n`

    // 조문 내용 (단일 객체 → 배열 정규화)
    const rawArticles = lawService.조문?.조
    const articles = toArray(rawArticles)

    if (articles.length > 0) {
      // jo 파라미터가 있으면 해당 조문만 필터링
      if (input.jo) {
        const matched = articles.filter(a => {
          // 조문번호 배열 또는 문자열 — JO 코드와 비교
          const nums = Array.isArray(a.조문번호) ? a.조문번호 : [a.조문번호]
          return joCode ? nums.some((n: string) => n === joCode) : false
        })

        if (matched.length === 0) {
          resultText += `'${input.jo}' 조문을 찾을 수 없습니다.\n\n`
          resultText += `목차 (총 ${articles.length}개 조문)\n\n`
          const tocItems: string[] = []
          for (const article of articles) {
            if (article.조제목) tocItems.push(article.조제목)
          }
          resultText += tocItems.join("\n")
        } else {
          for (const article of matched) {
            if (article.조제목) resultText += `${article.조제목}\n`
            if (article.조내용) resultText += `${cleanHtml(String(article.조내용))}\n\n`
          }
        }
      } else if (articles.length > 20) {
        // 대형 조례(20개 초과): TOC 반환 (law-text.ts 패턴)
        const tocItems: string[] = []
        for (const article of articles) {
          if (article.조제목) tocItems.push(article.조제목)
        }
        resultText += `목차 (총 ${articles.length}개 조문)\n\n`
        resultText += tocItems.join("\n")
        resultText += `\n\n특정 조문 조회: execute_tool(tool_name="get_ordinance", params={ordinSeq:"${ordinSeq}", jo:"제XX조"})`
      } else {
        for (const article of articles) {
          if (article.조제목) {
            resultText += `${article.조제목}\n`
          }
          if (article.조내용) {
            resultText += `${cleanHtml(String(article.조내용))}\n\n`
          }
        }
      }
    }

    return {
      content: [{
        type: "text",
        text: truncateResponse(resultText)
      }]
    }
  } catch (error) {
    return formatToolError(error, "get_ordinance")
  }
}
