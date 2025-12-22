/**
 * get_annexes Tool - 별표/서식 조회
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"

export const GetAnnexesSchema = z.object({
  lawName: z.string().describe("법령명 (예: '관세법')"),
  knd: z.enum(["1", "2", "3", "4", "5"]).optional().describe("1=별표, 2=서식, 3=부칙별표, 4=부칙서식, 5=전체"),
  LAW_OC: z.string().optional().describe("사용자 API 키 (https://open.law.go.kr 에서 발급, 없으면 서버 기본값 사용)")
})

export type GetAnnexesInput = z.infer<typeof GetAnnexesSchema>

export async function getAnnexes(
  apiClient: LawApiClient,
  input: GetAnnexesInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const jsonText = await apiClient.getAnnexes({
      lawName: input.lawName,
      knd: input.knd,
      apiKey: input.LAW_OC
    })

    const json = JSON.parse(jsonText)

    // LexDiff 방식: 법령 타입별 응답 구조 분기
    // - 행정규칙: admRulBylSearch.admbyl[]
    // - 일반 법령/조례: licBylSearch.licbyl[] 또는 licBylSearch.ordinbyl[]
    const adminResult = json?.admRulBylSearch
    const licResult = json?.licBylSearch

    let annexList: any[] = []
    let lawType: string = "law"

    if (adminResult?.admbyl && Array.isArray(adminResult.admbyl)) {
      // 📋 행정규칙 (훈령, 예규, 고시, 지침, 내규)
      annexList = adminResult.admbyl
      lawType = "admin"
    } else if (licResult?.ordinbyl && Array.isArray(licResult.ordinbyl)) {
      // 🏛️ 조례/규칙 (자치법규)
      annexList = licResult.ordinbyl
      lawType = "ordinance"
    } else if (licResult?.licbyl && Array.isArray(licResult.licbyl)) {
      // ⚖️ 일반 법령 (법률, 대통령령, 총리령, 부령 등)
      annexList = licResult.licbyl
      lawType = "law"
    }

    if (annexList.length === 0) {
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

      // 공통 필드
      const annexTitle = annex.별표명 || "제목 없음"
      const annexType = annex.별표종류 || ""
      const annexNum = annex.별표번호 || ""

      resultText += `${i + 1}. `
      if (annexNum) resultText += `[${annexNum}] `
      resultText += `${annexTitle}`
      if (annexType) resultText += ` (${annexType})`
      resultText += `\n`

      // 파일 링크 (타입별로 다른 필드)
      let fileLink = ""
      if (lawType === "law") {
        // ⚖️ 일반 법령: PDF 링크 우선
        fileLink = annex.별표서식PDF파일링크 || annex.별표서식파일링크 || ""
      } else {
        // 🏛️ 조례 또는 📋 행정규칙: 파일 링크 단일
        fileLink = annex.별표서식파일링크 || ""
      }

      if (fileLink) {
        resultText += `   📎 파일: ${fileLink}\n`
      }

      // 관련 법령/기관 (타입별 처리)
      if (lawType === "ordinance") {
        // 🏛️ 조례: 자치법규명 + 지자체기관명
        const relatedLaw = annex.관련자치법규명
        const localGov = annex.지자체기관명
        if (relatedLaw) {
          const cleanLawName = relatedLaw.replace(/<[^>]+>/g, '')
          resultText += `   📚 관련법규: ${cleanLawName}\n`
        }
        if (localGov) {
          resultText += `   🏛️  지자체: ${localGov}\n`
        }
      } else if (lawType === "admin") {
        // 📋 행정규칙: 행정규칙명 + 소관부처
        const relatedLaw = annex.관련행정규칙명
        const dept = annex.소관부처
        if (relatedLaw) {
          resultText += `   📚 행정규칙: ${relatedLaw}\n`
        }
        if (dept) {
          resultText += `   🏢 소관부처: ${dept}\n`
        }
      } else {
        // ⚖️ 일반 법령: 법령명
        const relatedLaw = annex.관련법령명
        if (relatedLaw) {
          resultText += `   📚 관련법령: ${relatedLaw}\n`
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
