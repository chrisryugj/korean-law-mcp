/**
 * get_article_detail Tool - 조항호목 단위 정밀 조회
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { truncateResponse } from "../lib/schemas.js"
import { buildJO, formatJO } from "../lib/law-parser.js"
import { cleanHtml, flattenContent, groupMokByReset, parseHangNumber } from "../lib/article-parser.js"
import { formatToolError } from "../lib/errors.js"
import { toArray } from "../lib/xml-parser.js"

export const GetArticleDetailSchema = z.object({
  mst: z.string().optional().describe("법령일련번호 (search_law에서 획득)"),
  lawId: z.string().optional().describe("법령ID (search_law에서 획득)"),
  jo: z.string().describe("조문 번호 (예: '제38조' 또는 '003800')"),
  hang: z.string().optional().describe("항 번호 (예: '2')"),
  ho: z.string().optional().describe("호 번호 (예: '3')"),
  mok: z.string().optional().describe("목 번호 (예: '1')"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
}).refine(data => data.mst || data.lawId, {
  message: "mst 또는 lawId 중 하나는 필수입니다"
})

export type GetArticleDetailInput = z.infer<typeof GetArticleDetailSchema>

export async function getArticleDetail(
  apiClient: LawApiClient,
  input: GetArticleDetailInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    // 조문 번호가 한글이면 JO 코드로 변환
    let joCode = input.jo
    if (/제\d+조/.test(joCode)) {
      joCode = buildJO(joCode)
    }

    // eflaw 를 직접 부르면 MST 경로가 #153 이후 매번 HTML 로 실패했다(재시도 4회 뒤 오류).
    // impact_map 은 대상 조문을 늘 NOT_FOUND 로 받아 정방향 인용 갈래가 통째로 비었다
    // (2026-09-23 리뷰 B2·D6). getLawText 가 MST 단독은 target=law, lawId 는 eflaw 로 보낸다.
    // HANG·HO·MOK 은 업스트림이 무시한다(실측: HANG=2 에도 7개 항 전부) → 아래에서 직접 거른다.
    const jsonText = await apiClient.getLawText({
      mst: input.mst,
      lawId: input.lawId,
      jo: String(joCode),
      apiKey: input.apiKey,
    })

    const json = JSON.parse(jsonText)
    const lawData = json?.법령

    if (!lawData) {
      return {
        content: [{ type: "text", text: "[NOT_FOUND] 법령 데이터를 찾을 수 없습니다.\n⚠️ LLM은 조문을 추측하지 마세요." }],
        isError: true
      }
    }

    const basicInfo = lawData.기본정보 || lawData
    const lawName = basicInfo?.법령명_한글 || basicInfo?.법령명한글 || basicInfo?.법령명 || "알 수 없음"

    // 조회 위치 표시. `제N조의M`에 `조`를 덧붙이면 '제401조의2조'가 된다(#118) —
    // 조문 번호 표기는 그대로 재인용되므로 정규 표기(formatJO)로 되돌린다.
    let locationLabel = formatJO(joCode) || input.jo
    if (input.hang) locationLabel += ` 제${input.hang}항`
    if (input.ho) locationLabel += ` 제${input.ho}호`
    if (input.mok) locationLabel += ` ${input.mok}목`

    let resultText = `법령명: ${lawName}\n`
    resultText += `조회 위치: ${locationLabel}\n\n`

    // 조문 추출
    const rawUnits = lawData.조문?.조문단위
    const articleUnits: any[] = toArray(rawUnits)

    if (articleUnits.length === 0) {
      return {
        content: [{ type: "text", text: resultText + "[NOT_FOUND] 해당 조문을 찾을 수 없습니다.\n⚠️ LLM은 조문 내용을 추측/생성하지 마세요." }],
        isError: true
      }
    }

    const misses = new Set<string>()
    for (const unit of articleUnits) {
      if (unit.조문여부 !== "조문") continue

      const joNum = unit.조문번호 || ""
      const joBranch = unit.조문가지번호 || ""
      const joTitle = unit.조문제목 || ""
      const displayNum = joBranch && joBranch !== "0" ? `제${joNum}조의${joBranch}` : `제${joNum}조`

      resultText += `${displayNum}`
      if (joTitle) resultText += ` ${joTitle}`
      resultText += `\n`

      // 조문내용 — JSON API는 문자열 또는 (중첩)배열로 반환한다.
      // String(배열)은 콤마로 뭉개지고 중첩 항목은 [object Object]가 되어
      // 같은 조문을 get_law_text와 다르게(훼손된 채) 출력하던 결함.
      // 형제 도구들처럼 flattenContent로 평탄화한다.
      if (unit.조문내용) {
        const content = flattenContent(unit.조문내용)
        if (content) resultText += `${cleanHtml(content)}\n`
      }

      // 항 내용 — 항내용/호내용/목내용도 조문내용과 같이 (중첩)배열로 올 수 있어 flattenContent 필수
      if (unit.항) {
        const sel = selectUnits(toArray(unit.항), input, misses)
        const renderMok = (mokList: any[]) => {
          for (const mok of sel.mok ? mokList.filter(sel.mok) : mokList) {
            const mokContent = flattenContent(mok.목내용)
            if (mokContent) resultText += `      ${mok.목번호 || ""} ${cleanHtml(mokContent)}\n`
          }
        }
        for (const hang of sel.hangs) {
          const hangNum = hang.항번호 || ""
          const hangContent = flattenContent(hang.항내용)
          if (hangContent) {
            resultText += `  ${hangNum ? `(${hangNum})` : ""} ${cleanHtml(hangContent)}\n`
          }

          const hoList = toArray(hang.호)
          // 법제처 JSON은 목을 호가 아닌 항 레벨 형제 배열로 준다 (article-parser.groupMokByReset 참조)
          const hangMokList = toArray(hang.목)
          const mokGroups = groupMokByReset(hangMokList)
          const alignable = hoList.length > 0 && mokGroups.length === hoList.length

          for (let i = 0; i < hoList.length; i++) {
            const ho = hoList[i]
            if (sel.ho && !sel.ho(ho)) continue
            const hoContent = flattenContent(ho.호내용)
            if (hoContent) {
              resultText += `    ${ho.호번호 || ""} ${cleanHtml(hoContent)}\n`
            }

            if (ho.목) renderMok(toArray(ho.목))
            if (alignable) renderMok(mokGroups[i])
          }

          if (!alignable && hangMokList.length > 0) {
            resultText += `  [참고] 아래 목은 위 각 호의 세부 항목이나 API 응답 구조상 소속 호를 특정할 수 없어 일괄 표시합니다.\n`
            renderMok(hangMokList)
          }
        }
      }

      resultText += `\n`
    }

    if (misses.size > 0) {
      resultText += `[주의] ${[...misses].join(", ")}을(를) 이 조문에서 찾지 못해 해당 단위 전체를 표시했습니다.\n`
    }

    return {
      content: [{ type: "text", text: truncateResponse(resultText) }]
    }
  } catch (error) {
    return formatToolError(error, "get_article_detail")
  }
}

/** 호·목 번호 정규화: "3." → "3", "3의2." → "3의2", "가." → "가" */
function unitNumber(raw: unknown): string {
  return String(raw ?? "").trim().replace(/\.$/, "")
}

const MOK_ORDER = "가나다라마바사아자차카타파하"

/**
 * 요청한 항·호·목만 남기는 선택기. 각 단위는 조문 전체에서 먼저 존재를 확인한다:
 * 있으면 그것만, 없으면 거르지 않고 misses 에 남긴다(없는 단위를 조용히 비우면
 * "그 호는 내용이 없다"로 읽힌다). 항을 안 정하고 호만 물으면 그 호가 있는 항으로 좁힌다.
 * 목은 숫자로 물어도 받는다(1 → 가).
 */
function selectUnits(allHangs: any[], input: { hang?: string; ho?: string; mok?: string }, misses: Set<string>) {
  let hangs = allHangs
  if (input.hang) {
    const matched = allHangs.filter(h => parseHangNumber(h.항번호) === Number(unitNumber(input.hang)))
    if (matched.length > 0) hangs = matched
    else misses.add(`제${input.hang}항`)
  }

  let ho: ((ho: any) => boolean) | undefined
  if (input.ho) {
    const want = unitNumber(input.ho)
    const isWanted = (h: any) => unitNumber(h.호번호) === want
    const withHo = hangs.filter(h => toArray(h.호).some(isWanted))
    if (withHo.length > 0) { hangs = withHo; ho = isWanted }
    else misses.add(`제${input.ho}호`)
  }

  let mok: ((mok: any) => boolean) | undefined
  if (input.mok) {
    const raw = unitNumber(input.mok)
    const want = /^\d+$/.test(raw) ? (MOK_ORDER[Number(raw) - 1] ?? raw) : raw
    const isWanted = (m: any) => unitNumber(m.목번호) === want
    const allMok = hangs.flatMap(h => [...toArray(h.목), ...toArray(h.호).flatMap(x => toArray(x.목))])
    if (allMok.some(isWanted)) mok = isWanted
    else misses.add(`${input.mok}목`)
  }

  return { hangs, ho, mok }
}
