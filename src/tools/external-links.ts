/**
 * get_external_links Tool - 외부 링크 생성 (법제처, 법원도서관 등)
 */

import { z } from "zod"

export const ExternalLinksSchema = z.object({
  linkType: z.enum(["law", "precedent", "interpretation"]).describe(
    "링크 유형: law (법령), precedent (판례), interpretation (해석례)"
  ),
  lawId: z.string().optional().describe("법령ID (법령 링크 생성 시)"),
  mst: z.string().optional().describe("법령일련번호 (법령 링크 생성 시)"),
  precedentId: z.string().optional().describe("판례일련번호 (판례 링크 생성 시)"),
  interpretationId: z.string().optional().describe("법령해석례일련번호 (해석례 링크 생성 시)")
})

export type ExternalLinksInput = z.infer<typeof ExternalLinksSchema>

export async function getExternalLinks(
  input: ExternalLinksInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    let resultText = "🔗 외부 링크\n\n"

    switch (input.linkType) {
      case "law": {
        if (!input.lawId && !input.mst) {
          return {
            content: [{
              type: "text",
              text: "법령 링크 생성을 위해 lawId 또는 mst가 필요합니다."
            }],
            isError: true
          }
        }

        const lawLinks = generateLawLinks(input.lawId, input.mst)
        resultText += lawLinks
        break
      }

      case "precedent": {
        if (!input.precedentId) {
          return {
            content: [{
              type: "text",
              text: "판례 링크 생성을 위해 precedentId가 필요합니다."
            }],
            isError: true
          }
        }

        const precedentLinks = generatePrecedentLinks(input.precedentId)
        resultText += precedentLinks
        break
      }

      case "interpretation": {
        if (!input.interpretationId) {
          return {
            content: [{
              type: "text",
              text: "해석례 링크 생성을 위해 interpretationId가 필요합니다."
            }],
            isError: true
          }
        }

        const interpretationLinks = generateInterpretationLinks(input.interpretationId)
        resultText += interpretationLinks
        break
      }

      default:
        return {
          content: [{
            type: "text",
            text: "지원하지 않는 링크 유형입니다."
          }],
          isError: true
        }
    }

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

/**
 * 법령 외부 링크 생성
 */
function generateLawLinks(lawId?: string, mst?: string): string {
  let links = "📜 법령 관련 링크:\n\n"

  // 법제처 국가법령정보센터
  if (lawId) {
    links += `1. 법제처 법령 상세:\n`
    links += `   https://www.law.go.kr/법령/${lawId}\n\n`

    links += `2. 법령 전문 (영문):\n`
    links += `   https://www.law.go.kr/eng/법령/${lawId}\n\n`
  }

  if (mst) {
    links += `3. 법령 연혁:\n`
    links += `   https://www.law.go.kr/LSW/lsStmdInfoP.do?lsiSeq=${mst}\n\n`
  }

  links += `4. 법제처 홈페이지:\n`
  links += `   https://www.law.go.kr/\n\n`

  return links
}

/**
 * 판례 외부 링크 생성
 */
function generatePrecedentLinks(precedentId: string): string {
  let links = "⚖️ 판례 관련 링크:\n\n"

  links += `1. 법제처 판례 상세:\n`
  links += `   https://www.law.go.kr/LSW/precInfoP.do?precSeq=${precedentId}\n\n`

  links += `2. 대법원 종합법률정보:\n`
  links += `   https://glaw.scourt.go.kr/\n`
  links += `   (판례일련번호: ${precedentId}로 검색)\n\n`

  links += `3. 법원도서관:\n`
  links += `   https://library.scourt.go.kr/\n\n`

  return links
}

/**
 * 법령해석례 외부 링크 생성
 */
function generateInterpretationLinks(interpretationId: string): string {
  let links = "📖 법령해석례 관련 링크:\n\n"

  links += `1. 법제처 해석례 상세:\n`
  links += `   https://www.law.go.kr/LSW/lsExpcInfoP.do?lsExpcSeq=${interpretationId}\n\n`

  links += `2. 법제처 법령해석:\n`
  links += `   https://www.moleg.go.kr/\n\n`

  return links
}
