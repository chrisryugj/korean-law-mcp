/**
 * get_law_tree Tool - 법령 트리 뷰
 * 법률→시행령→시행규칙 트리 구조 시각화
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { getThreeTier } from "./three-tier.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"

export const GetLawTreeSchema = z.object({
  mst: z.string().optional().describe("법령일련번호"),
  lawId: z.string().optional().describe("법령ID"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
}).refine(data => data.mst || data.lawId, {
  // 빈 입력이 그대로 API까지 가서 13초 뒤 "Unexpected end of JSON input"으로
  // 죽던 것 방지 — 형제 도구(get_three_tier)와 동일한 가드
  message: "mst 또는 lawId 중 하나는 필수입니다"
})

export type GetLawTreeInput = z.infer<typeof GetLawTreeSchema>

/**
 * get_three_tier 텍스트 출력에서 트리 구조 추출.
 * 실제 출력 형식(실측): "법령명: X" 헤더, "---" 구분선 사이의 "제N조 …" 법률 조문,
 * "[시행령] …제N조의M (제목)" / "[시행규칙] …" 위임 라인.
 * (종전 코드는 존재하지 않는 "법률명:"·"법률 조항"·"시행령 조항" 헤더를 찾아
 *  유효 입력에도 빈 트리를 반환했다.)
 */
export function parseThreeTierText(text: string): {
  lawName: string
  law: string[]
  decree: string[]
  rule: string[]
} {
  const lines = text.split("\n")
  let lawName = ""
  const law: string[] = []
  const decree: string[] = []
  const rule: string[] = []
  const seen = { law: new Set<string>(), decree: new Set<string>(), rule: new Set<string>() }

  const pushUnique = (bucket: string[], set: Set<string>, article: string) => {
    if (!set.has(article)) { set.add(article); bucket.push(article) }
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const nameMatch = trimmed.match(/^법(?:령|률)명:\s*(.+)$/)
    if (nameMatch) { lawName = nameMatch[1].trim(); continue }

    const articleRe = /제\d+조(?:의\d+)?/
    if (trimmed.startsWith("[시행령]")) {
      const m = trimmed.match(articleRe)
      if (m) pushUnique(decree, seen.decree, m[0])
    } else if (trimmed.startsWith("[시행규칙]")) {
      const m = trimmed.match(articleRe)
      if (m) pushUnique(rule, seen.rule, m[0])
    } else if (/^제\d+조(의\d+)?(\s|$)/.test(trimmed)) {
      // 법률 조문 헤더 라인 ("제4조 제4조(내국세등의 부과ㆍ징수)" 형태)
      const m = trimmed.match(articleRe)
      if (m) pushUnique(law, seen.law, m[0])
    }
  }
  return { lawName, law, decree, rule }
}

export async function getLawTree(
  apiClient: LawApiClient,
  input: GetLawTreeInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    // Get three-tier data
    const result = await getThreeTier(apiClient, {
      mst: input.mst,
      lawId: input.lawId,
      knd: "2", // 위임조문
      apiKey: input.apiKey
    })

    if (result.isError) {
      return result
    }

    const text = result.content[0].text
    const parsed = parseThreeTierText(text)
    const lawName = parsed.lawName
    const structure = { law: parsed.law, decree: parsed.decree, rule: parsed.rule }

    if (structure.law.length === 0 && structure.decree.length === 0 && structure.rule.length === 0) {
      // 위임조문 데이터가 없거나 형식이 예상과 다른 경우 — 빈 껍데기 트리를
      // 정상 결과처럼 내보내지 않는다
      return {
        content: [{
          type: "text",
          text: `[NOT_FOUND] ${lawName || "해당 법령"}의 위임조문 트리를 구성할 데이터가 없습니다.\n⚠️ LLM은 법령 체계를 추측하지 마세요. get_three_tier로 원본 위임조문을 직접 확인하세요.`,
        }],
        isError: true,
      }
    }

    // Build tree visualization
    let output = `=== 법령 트리 구조 ===\n\n`
    output += `${lawName || "법률"}\n`

    if (structure.law.length > 0) {
      output += `\n└─ 법률 (${structure.law.length}개 조항)\n`
      for (const article of structure.law.slice(0, 5)) {
        output += `   ├─ ${article}\n`
      }
      if (structure.law.length > 5) {
        output += `   └─ ... 외 ${structure.law.length - 5}개 조항\n`
      }
    }

    if (structure.decree.length > 0) {
      output += `\n└─ 시행령 (${structure.decree.length}개 조항)\n`
      for (const article of structure.decree.slice(0, 5)) {
        output += `   ├─ ${article}\n`
      }
      if (structure.decree.length > 5) {
        output += `   └─ ... 외 ${structure.decree.length - 5}개 조항\n`
      }
    }

    if (structure.rule.length > 0) {
      output += `\n└─ 시행규칙 (${structure.rule.length}개 조항)\n`
      for (const article of structure.rule.slice(0, 5)) {
        output += `   ├─ ${article}\n`
      }
      if (structure.rule.length > 5) {
        output += `   └─ ... 외 ${structure.rule.length - 5}개 조항\n`
      }
    }

    // 후속 도구 안내 제거 (LLM이 이미 도구 목록을 알고 있음)

    return {
      content: [{
        type: "text",
        text: truncateResponse(output)
      }]
    }
  } catch (error) {
    return formatToolError(error, "get_law_tree")
  }
}
