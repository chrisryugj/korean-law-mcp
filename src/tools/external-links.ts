/**
 * get_external_links Tool - 외부 링크 생성 (법제처, 법원도서관 등)
 */

import { z } from "zod"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"

export const ExternalLinksSchema = z.object({
  linkType: z.enum(["law", "precedent", "interpretation", "ordinance", "admin_rule"]).describe(
    "링크 유형: law (법령), precedent (판례), interpretation (해석례), ordinance (자치법규), admin_rule (행정규칙)"
  ),
  lawId: z.string().optional().describe("법령ID (법령 링크 생성 시)"),
  mst: z.string().optional().describe("법령일련번호 (법령/자치법규 링크 생성 시)"),
  lawName: z.string().optional().describe("법령명 (한글 URL 생성용, 예: '관세법')"),
  jo: z.string().optional().describe("조문 번호 (한글 URL 생성용, 예: '제38조')"),
  precedentId: z.string().optional().describe("판례일련번호 (판례 링크 생성 시)"),
  interpretationId: z.string().optional().describe("법령해석례일련번호 (해석례 링크 생성 시)"),
  adminRuleId: z.string().optional().describe("행정규칙일련번호 (행정규칙 링크 생성 시)"),
  ordinanceId: z.string().optional().describe("자치법규ID (자치법규 링크 생성 시)")
})

export type ExternalLinksInput = z.infer<typeof ExternalLinksSchema>

export async function getExternalLinks(
  input: ExternalLinksInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    let resultText = "외부 링크\n\n"

    switch (input.linkType) {
      case "law": {
        if (!input.lawId && !input.mst && !input.lawName) {
          return {
            content: [{
              type: "text",
              text: "법령 링크 생성을 위해 lawId, mst 또는 lawName이 필요합니다."
            }],
            isError: true
          }
        }

        const lawLinks = generateLawLinks(input.lawId, input.mst, input.lawName, input.jo)
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

      case "ordinance": {
        if (!input.ordinanceId && !input.mst && !input.lawName) {
          return {
            content: [{
              type: "text",
              text: "자치법규 링크 생성을 위해 ordinanceId, mst 또는 lawName이 필요합니다."
            }],
            isError: true
          }
        }

        const ordinanceLinks = generateOrdinanceLinks(input.ordinanceId, input.mst, input.lawName, input.jo)
        resultText += ordinanceLinks
        break
      }

      case "admin_rule": {
        if (!input.adminRuleId) {
          return {
            content: [{
              type: "text",
              text: "행정규칙 링크 생성을 위해 adminRuleId가 필요합니다."
            }],
            isError: true
          }
        }

        const adminRuleLinks = generateAdminRuleLinks(input.adminRuleId)
        resultText += adminRuleLinks
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
        text: truncateResponse(resultText)
      }]
    }
  } catch (error) {
    return formatToolError(error, "get_external_links")
  }
}

/**
 * 법령 외부 링크 생성
 */
function generateLawLinks(lawId?: string, mst?: string, lawName?: string, jo?: string): string {
  let links = "법령 관련 링크:\n\n"
  let linkNum = 1

  // 1. 한글 URL (법령명 기반) - 우선순위 최상위
  if (lawName) {
    if (jo) {
      const url = `https://www.law.go.kr/법령/${encodeURIComponent(lawName)}/${encodeURIComponent(jo)}`
      links += `${linkNum++}. [법제처 조문 직접 링크](${url})\n\n`
    } else {
      const url = `https://www.law.go.kr/법령/${encodeURIComponent(lawName)}`
      links += `${linkNum++}. [법제처 법령 직접 링크](${url})\n\n`
    }
  }

  // 2. 법령ID 기반 링크 (쿼리 파라미터)
  if (lawId) {
    const detailUrl = `https://www.law.go.kr/LSW/lawLsInfoP.do?lsiSeq=${lawId}`
    links += `${linkNum++}. [법제처 법령 상세 (ID)](${detailUrl})\n\n`

    const engUrl = `https://www.law.go.kr/eng/LSW/lawLsInfoP.do?lsiSeq=${lawId}`
    links += `${linkNum++}. [법령 전문 (영문)](${engUrl})\n\n`
  }

  // 3. 법령 연혁
  if (mst) {
    const historyUrl = `https://www.law.go.kr/LSW/lsStmdInfoP.do?lsiSeq=${mst}`
    links += `${linkNum++}. [법령 연혁](${historyUrl})\n\n`
  }

  // 4. 법제처 홈페이지
  links += `${linkNum}. [법제처 홈페이지](https://www.law.go.kr/)\n\n`

  return links
}

/**
 * 판례 외부 링크 생성
 */
function generatePrecedentLinks(precedentId: string): string {
  let links = "판례 관련 링크:\n\n"

  const lawUrl = `https://www.law.go.kr/LSW/precInfoP.do?precSeq=${precedentId}`
  links += `1. [법제처 판례 상세](${lawUrl})\n\n`

  links += `2. [대법원 종합법률정보](https://glaw.scourt.go.kr/)\n`
  links += `   (판례일련번호: ${precedentId}로 검색)\n\n`

  links += `3. [법원도서관](https://library.scourt.go.kr/)\n\n`

  return links
}

/**
 * 법령해석례 외부 링크 생성
 */
function generateInterpretationLinks(interpretationId: string): string {
  let links = "법령해석례 관련 링크:\n\n"

  const detailUrl = `https://www.law.go.kr/LSW/lsExpcInfoP.do?lsExpcSeq=${interpretationId}`
  links += `1. [법제처 해석례 상세](${detailUrl})\n\n`

  links += `2. [법제처 법령해석](https://www.moleg.go.kr/)\n\n`

  return links
}

/**
 * 자치법규 외부 링크 생성
 */
function generateOrdinanceLinks(ordinanceId?: string, mst?: string, lawName?: string, jo?: string): string {
  let links = "자치법규 관련 링크:\n\n"
  let linkNum = 1

  // 1. 한글 URL (법령명 기반)
  if (lawName) {
    if (jo) {
      const url = `https://www.law.go.kr/자치법규/${encodeURIComponent(lawName)}/${encodeURIComponent(jo)}`
      links += `${linkNum++}. [법제처 조문 직접 링크](${url})\n\n`
    } else {
      const url = `https://www.law.go.kr/자치법규/${encodeURIComponent(lawName)}`
      links += `${linkNum++}. [법제처 자치법규 직접 링크](${url})\n\n`
    }
  }

  // 2. 자치법규ID 기반 링크
  if (ordinanceId) {
    const detailUrl = `https://www.law.go.kr/LSW/ordinInfoP.do?ordinSeq=${ordinanceId}`
    links += `${linkNum++}. [법제처 자치법규 상세 (ID)](${detailUrl})\n\n`
  }

  // 3. 자치법규 연혁
  if (mst) {
    const historyUrl = `https://www.law.go.kr/LSW/lsStmdInfoP.do?lsiSeq=${mst}`
    links += `${linkNum++}. [자치법규 연혁](${historyUrl})\n\n`
  }

  // 4. 국가법령정보센터 자치법규
  links += `${linkNum++}. [국가법령정보센터 자치법규](https://www.law.go.kr/LSW/lsRvsRqInfoListP.do)\n\n`

  // 5. 자치법규정보시스템 (ELIS)
  links += `${linkNum}. [자치법규정보시스템 (ELIS)](https://www.elis.go.kr/)\n\n`

  return links
}

/**
 * 행정규칙 외부 링크 생성
 */
function generateAdminRuleLinks(adminRuleId: string): string {
  let links = "행정규칙 관련 링크:\n\n"

  const detailUrl = `https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=${adminRuleId}`
  links += `1. [법제처 행정규칙 상세](${detailUrl})\n\n`

  links += `2. [국가법령정보센터 행정규칙](https://www.law.go.kr/LSW/admRulLsInfoP.do)\n\n`

  links += `3. [법제처 홈페이지](https://www.law.go.kr/)\n\n`

  return links
}
