/**
 * compare_old_new Tool - 신구법 대조
 */

import { z } from "zod"
import { DOMParser } from "@xmldom/xmldom"
import type { LawApiClient } from "../lib/api-client.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"
import { cleanHtml } from "../lib/article-parser.js"
import { findLaws, resolvedLawMatches } from "../lib/law-search.js"

/** 조문 머리 "제43조(…)"·"제43조의2". 본문 속 "제43조에 따라" 같은 인용이 아니라 줄 맨 앞만 */
const ARTICLE_HEAD = /^제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/

export const CompareOldNewSchema = z.object({
  mst: z.string().optional().describe("법령일련번호"),
  lawId: z.string().optional().describe("법령ID"),
  ld: z.string().optional().describe("공포일자 (YYYYMMDD)"),
  ln: z.string().optional().describe("공포번호"),
  lawName: z.string().optional().describe("법령명 (mst·lawId 대신)"),
  jo: z.string().optional().describe("이 조만 (예: '제43조', '43', '제5조의2')"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
}).refine(data => data.mst || data.lawId || data.lawName, {
  message: "mst·lawId·lawName 중 하나는 필수입니다"
})

export type CompareOldNewInput = z.infer<typeof CompareOldNewSchema>

export async function compareOldNew(
  apiClient: LawApiClient,
  input: CompareOldNewInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    let { mst, lawId } = input
    if (!mst && !lawId) {
      const hits = await findLaws(apiClient, input.lawName!, input.apiKey, 3)
      const hit = hits.find(h => resolvedLawMatches(input.lawName!, h.lawName)) ?? hits[0]
      if (!hit) return { content: [{ type: "text", text: `[NOT_FOUND] '${input.lawName}' 법령을 찾지 못했습니다. 정식 법령명이나 공식 약칭으로 다시 찾으세요.` }], isError: true }
      lawId = hit.lawId
      mst = lawId ? undefined : hit.mst
    }
    const wantJo = input.jo?.replace(/\s+/g, "").match(/^(?:제)?(\d+)(?:조)?(?:의(\d+))?$/)
    const xmlText = await apiClient.compareOldNew({
      mst,
      lawId,
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

    let resultText = `법령명: ${lawName}\n`
    if (revisionType) resultText += `개정구분: ${revisionType}\n`
    if (oldDate) resultText += `구법 공포일: ${oldDate}\n`
    if (newDate) resultText += `신법 공포일: ${newDate}\n`
    resultText += `\n---\n`
    resultText += `신구법 대조\n`
    resultText += `---\n\n`

    // 구조문목록과 신조문목록 파싱
    const oldArticleList = doc.getElementsByTagName("구조문목록")[0]
    const newArticleList = doc.getElementsByTagName("신조문목록")[0]

    if (!oldArticleList || !newArticleList) {
      return {
        content: [{
          type: "text",
          text: resultText + "[NOT_FOUND] 개정 이력이 없거나 신구법 대조 데이터가 없습니다.\n⚠️ LLM은 대조 내용을 추측하지 마세요."
        }],
        isError: true
      }
    }

    const oldArticles = oldArticleList.getElementsByTagName("조문")
    const newArticles = newArticleList.getElementsByTagName("조문")

    if (oldArticles.length === 0 && newArticles.length === 0) {
      return {
        content: [{
          type: "text",
          text: resultText + "[NOT_FOUND] 개정 이력이 없거나 신구법 대조 데이터가 없습니다.\n⚠️ LLM은 대조 내용을 추측하지 마세요."
        }],
        isError: true
      }
    }

    // 구/신 조문을 쌍으로 매칭 (동일 인덱스 기반. API가 대응 쌍을 순서대로 반환). 한 조가 항·호 줄 여러 쌍으로 오므로 조 머리로
    // 시작하는 쌍에서 묶음을 열고, 머리 없는 쌍(항·호 줄)은 앞 조에 딸린다. 종전엔 쌍마다 본문 첫 "제N조"를 라벨로 써서
    // 호 줄이 그 줄이 인용한 조("제43조")나 "조문 2" 로 찍히고, <P> 태그가 남고, 30쌍에서 잘렸다(도로교통법)
    const maxArticles = Math.max(oldArticles.length, newArticles.length)
    type Group = { label: string; key?: string; rows: Array<[string, string]> }
    const groups: Group[] = []
    for (let i = 0; i < maxArticles; i++) {
      const oldContent = cleanHtml(oldArticles[i]?.textContent || "").trim()
      const newContent = cleanHtml(newArticles[i]?.textContent || "").trim()
      const head = (newContent.match(ARTICLE_HEAD) ?? oldContent.match(ARTICLE_HEAD))
      if (head || !groups.length) {
        groups.push({ label: head ? head[0].replace(/\s+/g, "") : `조문 ${groups.length + 1}`, key: head ? `${head[1]}-${head[2] ?? "0"}` : undefined, rows: [] })
      }
      groups[groups.length - 1].rows.push([oldContent, newContent])
    }
    const picked = wantJo ? groups.filter(g => g.key === `${parseInt(wantJo[1], 10)}-${wantJo[2] ? parseInt(wantJo[2], 10) : 0}`) : groups
    if (wantJo && !picked.length) {
      return { content: [{ type: "text", text: resultText + `[NOT_FOUND] 이 개정에서 ${input.jo} 는 바뀌지 않았습니다. 바뀐 조: ${groups.map(g => g.label).join(", ")}` }] }
    }
    const displayCount = Math.min(picked.length, 40)

    for (const g of picked.slice(0, displayCount)) {
      resultText += `\n---\n${g.label}\n---\n\n`
      const olds = g.rows.map(r => r[0]).filter(Boolean)
      const news = g.rows.map(r => r[1]).filter(Boolean)
      resultText += olds.length ? `[개정 전]\n${olds.join("\n")}\n\n` : `[개정 전] (신설)\n\n`
      resultText += news.length ? `[개정 후]\n${news.join("\n")}\n\n` : `[개정 후] (삭제)\n\n`
    }

    if (picked.length > displayCount) {
      resultText += `\n... 외 ${picked.length - displayCount}개 조문 (생략): ${picked.slice(displayCount).map(g => g.label).join(", ")}\n`
      resultText += `전체 ${picked.length}개 조문 중 ${displayCount}개만 표시합니다. 특정 조는 jo 로 골라 보세요.\n`
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
