/**
 * 행정규칙 관련 Tools
 */

import { z } from "zod"
import { DOMParser } from "@xmldom/xmldom"
import type { LawApiClient } from "../lib/api-client.js"

// search_admin_rule 스키마
export const SearchAdminRuleSchema = z.object({
  query: z.string().describe("검색할 행정규칙명"),
  knd: z.string().optional().describe("행정규칙 종류 (1=훈령, 2=예규, 3=고시, 4=공고, 5=일반)"),
  maxResults: z.number().optional().default(20).describe("최대 결과 개수")
})

export type SearchAdminRuleInput = z.infer<typeof SearchAdminRuleSchema>

export async function searchAdminRule(
  apiClient: LawApiClient,
  input: SearchAdminRuleInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const xmlText = await apiClient.searchAdminRule({
      query: input.query,
      knd: input.knd
    })

    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlText, "text/xml")

    const rules = doc.getElementsByTagName("admrul")

    if (rules.length === 0) {
      return {
        content: [{
          type: "text",
          text: "검색 결과가 없습니다. 행정규칙명을 확인해주세요."
        }]
      }
    }

    let resultText = `행정규칙 검색 결과 (총 ${rules.length}건):\n\n`

    const maxResults = Math.min(rules.length, input.maxResults)

    for (let i = 0; i < maxResults; i++) {
      const rule = rules[i]

      const ruleName = rule.getElementsByTagName("행정규칙명")[0]?.textContent || "알 수 없음"
      const ruleId = rule.getElementsByTagName("행정규칙ID")[0]?.textContent || ""
      const promDate = rule.getElementsByTagName("발령일자")[0]?.textContent || ""
      const ruleType = rule.getElementsByTagName("행정규칙종류")[0]?.textContent || ""
      const orgName = rule.getElementsByTagName("소관부처명")[0]?.textContent || ""

      resultText += `${i + 1}. ${ruleName}\n`
      resultText += `   - 행정규칙ID: ${ruleId}\n`
      resultText += `   - 공포일: ${promDate}\n`
      resultText += `   - 구분: ${ruleType}\n`
      resultText += `   - 소관부처: ${orgName}\n\n`
    }

    resultText += `\n💡 상세 내용을 조회하려면 get_admin_rule Tool을 사용하세요.`

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

// get_admin_rule 스키마
export const GetAdminRuleSchema = z.object({
  id: z.string().describe("행정규칙ID (search_admin_rule에서 획득)")
})

export type GetAdminRuleInput = z.infer<typeof GetAdminRuleSchema>

export async function getAdminRule(
  apiClient: LawApiClient,
  input: GetAdminRuleInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const jsonText = await apiClient.getAdminRule(input.id)
    const json = JSON.parse(jsonText)

    const rule = json?.행정규칙

    if (!rule) {
      return {
        content: [{
          type: "text",
          text: "행정규칙 데이터를 찾을 수 없습니다."
        }],
        isError: true
      }
    }

    let resultText = `행정규칙명: ${rule.행정규칙명 || "알 수 없음"}\n`
    resultText += `공포일: ${rule.공포일자 || ""}\n`
    resultText += `소관부처: ${rule.소관부처 || ""}\n`
    resultText += `\n━━━━━━━━━━━━━━━━━━━━━━\n\n`

    // 조문 내용
    const articles = rule.조문 || []

    if (Array.isArray(articles)) {
      const maxArticles = Math.min(articles.length, 10)

      for (let i = 0; i < maxArticles; i++) {
        const article = articles[i]

        if (article.조문번호) {
          resultText += `${article.조문번호}`
        }
        if (article.조문제목) {
          resultText += ` ${article.조문제목}`
        }
        resultText += `\n`

        if (article.조문내용) {
          const content = article.조문내용
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .trim()

          resultText += `${content}\n\n`
        }
      }

      if (articles.length > maxArticles) {
        resultText += `\n... 외 ${articles.length - maxArticles}개 조문 (생략)\n`
      }
    } else if (typeof rule.조문내용 === 'string') {
      // 단일 조문인 경우
      const content = rule.조문내용
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .trim()

      resultText += `${content}\n`
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
