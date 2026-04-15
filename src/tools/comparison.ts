/**
 * compare_old_new Tool - 신구법 대조
 *
 * 개선 사항:
 *  - 개정이유 추출 (여러 XML 태그명 시도)
 *  - 항·호·목 수준 변경 요약 자동 생성
 *  - 소관부처명 표시
 *  - 박스 스타일 출력으로 가독성 향상
 */

import { z } from "zod"
import { DOMParser } from "@xmldom/xmldom"
import type { LawApiClient } from "../lib/api-client.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"

export const CompareOldNewSchema = z.object({
  mst: z.string().optional().describe("법령일련번호"),
  lawId: z.string().optional().describe("법령ID"),
  ld: z.string().optional().describe("공포일자 (YYYYMMDD)"),
  ln: z.string().optional().describe("공포번호"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
}).refine(data => data.mst || data.lawId, {
  message: "mst 또는 lawId 중 하나는 필수입니다"
})

export type CompareOldNewInput = z.infer<typeof CompareOldNewSchema>

// ──────────────────────────────────────────────
// 항·호·목 수준 변경 요약 헬퍼
// ──────────────────────────────────────────────

/** 한글 원문자(①②③...) 또는 '제N항' 기준으로 텍스트 분할 */
function splitByHang(text: string): string[] {
  return text
    .split(/(?=[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]|제\d+항\s)/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

/** 호 구분: '1. 2. 3.' 또는 '가. 나. 다.' 패턴 */
function splitByHo(text: string): string[] {
  return text
    .split(/(?=\d+\.\s|[가나다라마바사아자차카타파하]\.\s)/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

/** 항 레이블 추출 (원문자 > 제N항 > 순번) */
function extractHangLabel(text: string, fallbackIndex: number): string {
  const circled = text.match(/^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/)
  if (circled) return circled[0]
  const formal = text.match(/^(제\d+항)/)
  if (formal) return formal[1]
  return `제${fallbackIndex}항`
}

/**
 * 구문(oldText)과 신문(newText)을 비교하여 변경 요약 1줄 생성
 * 반환 예: "  → 변경: ② 수정 / ③ 신설"
 */
function buildChangeSummary(oldText: string, newText: string): string {
  if (!oldText && newText) return "  → [신설]"
  if (oldText && !newText) return "  → [삭제]"
  if (oldText === newText) return ""

  const oldHangs = splitByHang(oldText)
  const newHangs = splitByHang(newText)

  // 항 단위 비교 (2항 이상일 때 의미 있음)
  if (oldHangs.length > 1 || newHangs.length > 1) {
    const changes: string[] = []
    const maxLen = Math.max(oldHangs.length, newHangs.length)
    for (let i = 0; i < maxLen; i++) {
      const o = oldHangs[i] || ""
      const n = newHangs[i] || ""
      const label = extractHangLabel(n || o, i + 1)
      if (!o && n) changes.push(`${label} 신설`)
      else if (o && !n) changes.push(`${label} 삭제`)
      else if (o !== n) changes.push(`${label} 수정`)
    }
    if (changes.length > 0) return `  → 변경: ${changes.join(" / ")}`
    return ""
  }

  // 단항 조문: 호 단위 비교
  const oldHos = splitByHo(oldText)
  const newHos = splitByHo(newText)
  if (oldHos.length > 1 || newHos.length > 1) {
    const parts: string[] = []
    const added = Math.max(0, newHos.length - oldHos.length)
    const removed = Math.max(0, oldHos.length - newHos.length)
    if (added > 0) parts.push(`${added}호 신설`)
    if (removed > 0) parts.push(`${removed}호 삭제`)
    if (parts.length === 0) parts.push("일부 수정")
    return `  → 변경: ${parts.join(", ")}`
  }

  return "  → 내용 수정"
}

/** 텍스트 각 줄 앞에 │ 들여쓰기 */
function indentBox(text: string): string {
  return text
    .split("\n")
    .map(l => `│   ${l}`)
    .join("\n")
}

// ──────────────────────────────────────────────
// 메인 핸들러
// ──────────────────────────────────────────────

export async function compareOldNew(
  apiClient: LawApiClient,
  input: CompareOldNewInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const xmlText = await apiClient.compareOldNew({
      mst: input.mst,
      lawId: input.lawId,
      ld: input.ld,
      ln: input.ln,
      apiKey: input.apiKey
    })

    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlText, "text/xml")

    const lawName = doc.getElementsByTagName("법령명")[0]?.textContent || "알 수 없음"
    const oldInfo = doc.getElementsByTagName("구조문_기본정보")[0]
    const newInfo = doc.getElementsByTagName("신조문_기본정보")[0]

    const oldDate = oldInfo?.getElementsByTagName("공포일자")[0]?.textContent || ""
    const newDate = newInfo?.getElementsByTagName("공포일자")[0]?.textContent || ""
    const revisionType = newInfo?.getElementsByTagName("제개정구분명")[0]?.textContent || ""
    const orgName = newInfo?.getElementsByTagName("소관부처명")[0]?.textContent || ""

    // 개정이유 — 여러 XML 태그명을 순서대로 시도
    const amendReason = (
      doc.getElementsByTagName("개정이유")[0]?.textContent ||
      doc.getElementsByTagName("개정이유내용")[0]?.textContent ||
      newInfo?.getElementsByTagName("개정이유")[0]?.textContent ||
      newInfo?.getElementsByTagName("개정이유내용")[0]?.textContent ||
      ""
    ).trim()

    // ── 헤더 ──────────────────────────────────
    let resultText = `══════════════════════════════\n`
    resultText += `법령명: ${lawName}\n`
    if (revisionType) resultText += `개정구분: ${revisionType}\n`
    if (orgName)      resultText += `소관부처: ${orgName}\n`
    if (oldDate)      resultText += `구법 공포일: ${oldDate}\n`
    if (newDate)      resultText += `신법 공포일: ${newDate}\n`
    resultText += `══════════════════════════════\n`

    // ── 개정이유 ──────────────────────────────
    if (amendReason) {
      resultText += `\n▶ 개정이유\n`
      resultText += `${amendReason}\n`
      resultText += `──────────────────────────────\n`
    }

    // ── 신구대조표 ────────────────────────────
    resultText += `\n▶ 신구대조표\n`

    const oldArticleList = doc.getElementsByTagName("구조문목록")[0]
    const newArticleList = doc.getElementsByTagName("신조문목록")[0]

    if (!oldArticleList || !newArticleList) {
      return {
        content: [{
          type: "text",
          text: resultText + "개정 이력이 없거나 신구법 대조 데이터가 없습니다."
        }]
      }
    }

    const oldArticles = oldArticleList.getElementsByTagName("조문")
    const newArticles = newArticleList.getElementsByTagName("조문")

    if (oldArticles.length === 0 && newArticles.length === 0) {
      return {
        content: [{
          type: "text",
          text: resultText + "개정 이력이 없거나 신구법 대조 데이터가 없습니다."
        }]
      }
    }

    const maxArticles = Math.max(oldArticles.length, newArticles.length)
    const displayCount = Math.min(maxArticles, 30)

    for (let i = 0; i < displayCount; i++) {
      const oldContent = oldArticles[i]?.textContent?.trim() || ""
      const newContent = newArticles[i]?.textContent?.trim() || ""

      // 조문 번호 추출
      const articleNumMatch = (newContent || oldContent).match(/제\d+조(?:의\d+)?/)
      const articleLabel = articleNumMatch ? articleNumMatch[0] : `조문 ${i + 1}`

      // 항·호·목 수준 변경 요약
      const summary = buildChangeSummary(oldContent, newContent)

      resultText += `\n┌─ ${articleLabel} ─────────────────────────\n`
      if (summary) {
        resultText += `│ ${summary.trimStart()}\n│\n`
      }

      if (oldContent) {
        resultText += `│ [개정 전]\n`
        resultText += indentBox(oldContent)
        resultText += `\n│\n`
      } else {
        resultText += `│ [개정 전] (신설)\n│\n`
      }

      if (newContent) {
        resultText += `│ [개정 후]\n`
        resultText += indentBox(newContent)
        resultText += `\n`
      } else {
        resultText += `│ [개정 후] (삭제)\n`
      }
      resultText += `└───────────────────────────────\n`
    }

    if (maxArticles > displayCount) {
      resultText += `\n... 외 ${maxArticles - displayCount}개 조문 (생략)\n`
      resultText += `전체 ${maxArticles}개 조문 중 ${displayCount}개만 표시합니다.\n`
    }

    return {
      content: [{
        type: "text",
        text: truncateResponse(resultText)
      }]
    }
  } catch (error) {
    return formatToolError(error, "compare_old_new")
  }
}
