/**
 * get_annexes Tool - 별표/서식 조회
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"

export const GetAnnexesSchema = z.object({
  lawName: z.string().describe("법령명 (예: '관세법')"),
  knd: z.enum(["1", "2", "3", "4", "5"]).optional().describe("1=별표, 2=서식, 3=부칙별표, 4=부칙서식, 5=전체")
})

export type GetAnnexesInput = z.infer<typeof GetAnnexesSchema>

export async function getAnnexes(
  apiClient: LawApiClient,
  input: GetAnnexesInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const jsonText = await apiClient.getAnnexes({
      lawName: input.lawName,
      knd: input.knd
    })

    const json = JSON.parse(jsonText)

    const annexList = json?.별표서식 || []

    if (!Array.isArray(annexList) || annexList.length === 0) {
      return {
        content: [{
          type: "text",
          text: `"${input.lawName}"에 대한 별표/서식이 없습니다.`
        }]
      }
    }

    const kndLabel = input.knd === "1" ? "별표"
                   : input.knd === "2" ? "서식"
                   : input.knd === "3" ? "부칙별표"
                   : input.knd === "4" ? "부칙서식"
                   : "별표/서식"

    let resultText = `법령명: ${input.lawName}\n`
    resultText += `${kndLabel} 목록 (총 ${annexList.length}건):\n\n`

    const maxItems = Math.min(annexList.length, 20)

    for (let i = 0; i < maxItems; i++) {
      const annex = annexList[i]

      const annexTitle = annex.별표서식명 || annex.제목 || "제목 없음"
      const annexType = annex.구분 || ""
      const annexNum = annex.번호 || ""

      resultText += `${i + 1}. `
      if (annexNum) resultText += `[${annexNum}] `
      resultText += `${annexTitle}`
      if (annexType) resultText += ` (${annexType})`
      resultText += `\n`

      // 내용 미리보기
      if (annex.내용) {
        const preview = annex.내용
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
          .trim()
          .substring(0, 100)

        if (preview) {
          resultText += `   ${preview}...\n`
        }
      }

      resultText += `\n`
    }

    if (annexList.length > maxItems) {
      resultText += `\n... 외 ${annexList.length - maxItems}개 항목 (생략)\n`
    }

    resultText += `\n💡 별표/서식은 법령 본문과 함께 제공되는 첨부 자료입니다.`

    return {
      content: [{
        type: "text",
        text: resultText
      }]
    }
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Error: ${error instanceof Error ? error.message : String(error)}`
      }],
      isError: true
    }
  }
}
