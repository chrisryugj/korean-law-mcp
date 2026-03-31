/**
 * 행정규칙 관련 Tools
 */

import { z } from "zod"
import { DOMParser } from "@xmldom/xmldom"
import type { LawApiClient } from "../lib/api-client.js"
import { truncateResponse } from "../lib/schemas.js"

// search_admin_rule 스키마
export const SearchAdminRuleSchema = z.object({
  query: z.string().describe("검색할 행정규칙명"),
  knd: z.string().optional().describe("행정규칙 종류 (1=훈령, 2=예규, 3=고시, 4=공고, 5=일반)"),
  display: z.number().optional().default(20).describe("최대 결과 개수"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
})

export type SearchAdminRuleInput = z.infer<typeof SearchAdminRuleSchema>

export async function searchAdminRule(
  apiClient: LawApiClient,
  input: SearchAdminRuleInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const xmlText = await apiClient.searchAdminRule({
      query: input.query,
      knd: input.knd,
      apiKey: input.apiKey
    })

    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlText, "text/xml")

    const rules = doc.getElementsByTagName("admrul")

    if (rules.length === 0) {
      let errorMsg = "검색 결과가 없습니다."
      errorMsg += `\n\n💡 개선 방법:`
      errorMsg += `\n   1. 단순 키워드 사용:`
      const words = input.query.split(/\s+/)
      if (words.length > 1) {
        errorMsg += `\n      search_admin_rule(query="${words[0]}")`
      }
      errorMsg += `\n\n   2. 상위 법령명 검색:`
      errorMsg += `\n      search_law(query="관련 법령명")`
      errorMsg += `\n\n   3. 광범위 검색:`
      errorMsg += `\n      search_all(query="${words[0] || input.query}")`

      return {
        content: [{
          type: "text",
          text: errorMsg
        }],
        isError: true
      }
    }

    let resultText = `행정규칙 검색 결과 (총 ${rules.length}건):\n\n`

    const display = Math.min(rules.length, input.display)

    for (let i = 0; i < display; i++) {
      const rule = rules[i]

      const ruleName = rule.getElementsByTagName("행정규칙명")[0]?.textContent || "알 수 없음"
      const ruleSeq = rule.getElementsByTagName("행정규칙일련번호")[0]?.textContent || ""
      const ruleId = rule.getElementsByTagName("행정규칙ID")[0]?.textContent || ""
      const promDate = rule.getElementsByTagName("발령일자")[0]?.textContent || ""
      const ruleType = rule.getElementsByTagName("행정규칙종류")[0]?.textContent || ""
      const orgName = rule.getElementsByTagName("소관부처명")[0]?.textContent || ""

      resultText += `${i + 1}. ${ruleName}\n`
      resultText += `   - 행정규칙일련번호: ${ruleSeq}\n`
      resultText += `   - 행정규칙ID: ${ruleId}\n`
      resultText += `   - 공포일: ${promDate}\n`
      resultText += `   - 구분: ${ruleType}\n`
      resultText += `   - 소관부처: ${orgName}\n\n`
    }

    resultText += `\n💡 상세 내용을 조회하려면 get_admin_rule Tool을 사용하세요.`

    return {
      content: [{
        type: "text",
        text: truncateResponse(resultText)
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

// get_admin_rule 스키마
export const GetAdminRuleSchema = z.object({
  id: z.string().describe("행정규칙ID (search_admin_rule에서 획득)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
})

export type GetAdminRuleInput = z.infer<typeof GetAdminRuleSchema>

export async function getAdminRule(
  apiClient: LawApiClient,
  input: GetAdminRuleInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const xmlText = await apiClient.getAdminRule(input.id, input.apiKey)

    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlText, "text/xml")

    // 행정규칙 정보 추출
    const ruleName = doc.getElementsByTagName("행정규칙명")[0]?.textContent || "알 수 없음"
    const promDate = doc.getElementsByTagName("공포일자")[0]?.textContent || ""
    const orgName = doc.getElementsByTagName("소관부처")[0]?.textContent || ""
    const ruleType = doc.getElementsByTagName("행정규칙종류")[0]?.textContent || ""

    let resultText = `행정규칙명: ${ruleName}\n`
    if (promDate) resultText += `공포일: ${promDate}\n`
    if (ruleType) resultText += `종류: ${ruleType}\n`
    if (orgName) resultText += `소관부처: ${orgName}\n`
    resultText += `\n━━━━━━━━━━━━━━━━━━━━━━\n\n`

    // 조문 추출 - <조문내용> 태그 사용
    const joContents = doc.getElementsByTagName("조문내용")

    if (joContents.length === 0) {
      // 첨부파일 확인
      const attachments = doc.getElementsByTagName("첨부파일링크")
      if (attachments.length > 0) {
        resultText += "⚠️  이 행정규칙은 조문 형식이 아닌 첨부파일로 제공됩니다.\n\n"
        resultText += "📎 첨부파일:\n"
        for (let i = 0; i < attachments.length; i++) {
          const link = attachments[i].textContent || ""
          if (link) {
            resultText += `   ${i + 1}. ${link}\n`
          }
        }
        return {
          content: [{
            type: "text",
            text: truncateResponse(resultText)
          }]
        }
      }

      return {
        content: [{
          type: "text",
          text: "행정규칙 전문을 조회할 수 없습니다.\n\n" +
                "⚠️  법제처 API 제한: 일부 행정규칙은 전문 조회가 지원되지 않습니다.\n" +
                "💡 대안: search_admin_rule 결과의 '행정규칙상세링크'를 통해 웹에서 확인하세요."
        }],
        isError: true
      }
    }

    // 조문내용이 비어있는지 확인
    let hasContent = false
    for (let i = 0; i < joContents.length; i++) {
      const content = joContents[i].textContent?.trim() || ""
      if (content.length > 0) {
        hasContent = true
        break
      }
    }

    if (!hasContent) {
      // 첨부파일 확인
      const attachments = doc.getElementsByTagName("첨부파일링크")
      if (attachments.length > 0) {
        resultText += "⚠️  이 행정규칙은 조문 형식이 아닌 첨부파일로 제공됩니다.\n\n"
        resultText += "📎 첨부파일:\n"
        for (let i = 0; i < attachments.length; i++) {
          const link = attachments[i].textContent || ""
          if (link) {
            resultText += `   ${i + 1}. ${link}\n`
          }
        }
      } else {
        resultText += "⚠️  이 행정규칙은 조문 내용이 비어있습니다."
      }
      return {
        content: [{
          type: "text",
          text: truncateResponse(resultText)
        }]
      }
    }

    // 조문 내용 출력
    for (let i = 0; i < joContents.length; i++) {
      const joContent = joContents[i].textContent?.trim() || ""

      if (joContent.length > 0) {
        resultText += `${joContent}\n\n`
      }
    }

    // 부칙 추가
    const addendums = doc.getElementsByTagName("부칙내용")
    if (addendums.length > 0) {
      resultText += `\n━━━━━━━━━━━━━━━━━━━━━━\n부칙\n━━━━━━━━━━━━━━━━━━━━━━\n\n`
      for (let i = 0; i < addendums.length; i++) {
        const content = addendums[i].textContent?.trim() || ""
        if (content.length > 0) {
          resultText += `${content}\n\n`
        }
      }
    }

    // 별표 추가
    const annexes = doc.getElementsByTagName("별표내용")
    if (annexes.length > 0) {
      resultText += `\n━━━━━━━━━━━━━━━━━━━━━━\n별표\n━━━━━━━━━━━━━━━━━━━━━━\n\n`
      for (let i = 0; i < annexes.length; i++) {
        const title = doc.getElementsByTagName("별표제목")[i]?.textContent?.trim() || ""
        const content = annexes[i].textContent?.trim() || ""

        if (title) {
          resultText += `[${title}]\n`
        }
        if (content.length > 0) {
          resultText += `${content}\n\n`
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
    return {
      content: [{
        type: "text",
        text: `Error: ${error instanceof Error ? error.message : String(error)}`
      }],
      isError: true
    }
  }
}

// compare_admin_rule_old_new 스키마
export const CompareAdminRuleOldNewSchema = z.object({
  query: z.string().optional().describe("행정규칙명 키워드 (검색용)"),
  id: z.string().optional().describe("행정규칙ID (본문 조회용, search_admin_rule에서 획득)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
}).refine(data => data.query || data.id, {
  message: "query(검색) 또는 id(본문조회) 중 하나는 필수입니다"
})

export type CompareAdminRuleOldNewInput = z.infer<typeof CompareAdminRuleOldNewSchema>

export async function compareAdminRuleOldNew(
  apiClient: LawApiClient,
  input: CompareAdminRuleOldNewInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    if (input.id) {
      // 본문 조회: lawService.do, target=admrulOldAndNew
      const xmlText = await apiClient.fetchApi({
        endpoint: "lawService.do",
        target: "admrulOldAndNew",
        type: "XML",
        extraParams: { ID: String(input.id) },
        apiKey: input.apiKey
      })

      const parser = new DOMParser()
      const doc = parser.parseFromString(xmlText, "text/xml")

      const ruleName = doc.getElementsByTagName("행정규칙명")[0]?.textContent || "알 수 없음"

      let resultText = `행정규칙 신구법 대조: ${ruleName}\n`
      resultText += `━━━━━━━━━━━━━━━━━━━━━━\n\n`

      const oldArticles = doc.getElementsByTagName("구조문")
      const newArticles = doc.getElementsByTagName("신조문")
      const maxCount = Math.max(oldArticles.length, newArticles.length)

      if (maxCount === 0) {
        resultText += "신구법 대조 데이터가 없습니다."
        return { content: [{ type: "text", text: resultText }] }
      }

      const displayCount = Math.min(maxCount, 30)
      for (let i = 0; i < displayCount; i++) {
        const oldContent = oldArticles[i]?.textContent?.trim() || ""
        const newContent = newArticles[i]?.textContent?.trim() || ""

        resultText += `━━━━━━━━━━━━━━━━━━━━━━\n`
        resultText += `[개정 전] ${oldContent || "(신설)"}\n\n`
        resultText += `[개정 후] ${newContent || "(삭제)"}\n\n`
      }

      if (maxCount > displayCount) {
        resultText += `\n... 외 ${maxCount - displayCount}개 항목 (생략)\n`
      }

      return { content: [{ type: "text", text: truncateResponse(resultText) }] }
    }

    // 검색: lawSearch.do, target=admrulOldAndNew
    const xmlText = await apiClient.fetchApi({
      endpoint: "lawSearch.do",
      target: "admrulOldAndNew",
      type: "XML",
      extraParams: { query: String(input.query) },
      apiKey: input.apiKey
    })

    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlText, "text/xml")

    const rules = doc.getElementsByTagName("admrul")
    if (rules.length === 0) {
      return {
        content: [{ type: "text", text: "행정규칙 신구법 검색 결과가 없습니다." }],
        isError: true
      }
    }

    let resultText = `행정규칙 신구법 검색 결과 (총 ${rules.length}건):\n\n`

    const display = Math.min(rules.length, 20)
    for (let i = 0; i < display; i++) {
      const rule = rules[i]
      const name = rule.getElementsByTagName("행정규칙명")[0]?.textContent || "알 수 없음"
      const ruleId = rule.getElementsByTagName("행정규칙ID")[0]?.textContent || ""
      const promDate = rule.getElementsByTagName("발령일자")[0]?.textContent || ""
      const orgName = rule.getElementsByTagName("소관부처명")[0]?.textContent || ""

      resultText += `${i + 1}. ${name}\n`
      resultText += `   - 행정규칙ID: ${ruleId}\n`
      resultText += `   - 발령일: ${promDate}\n`
      resultText += `   - 소관부처: ${orgName}\n\n`
    }

    resultText += `\n💡 본문 조회: compare_admin_rule_old_new(id="행정규칙ID")`

    return { content: [{ type: "text", text: truncateResponse(resultText) }] }
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true
    }
  }
}
