/**
 * parse_jo_code Tool - JO 코드 양방향 변환
 */

import { z } from "zod"
import { buildJO, formatJO } from "../lib/law-parser.js"

export const ParseJoCodeSchema = z.object({
  joText: z.string().describe("변환할 조문 번호 (예: '제38조', '10조의2', '003800')"),
  direction: z.enum(["to_code", "to_text"]).optional().default("to_code").describe("변환 방향: to_code (한글→코드) 또는 to_text (코드→한글)")
})

export type ParseJoCodeInput = z.infer<typeof ParseJoCodeSchema>

export async function parseJoCode(
  input: ParseJoCodeInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    let result: string

    if (input.direction === "to_code") {
      // 한글 → JO 코드
      result = buildJO(input.joText)
    } else {
      // JO 코드 → 한글
      result = formatJO(input.joText)
    }

    const resultText = JSON.stringify({
      input: input.joText,
      output: result,
      direction: input.direction
    }, null, 2)

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
        text: `조문 번호 변환 실패: ${error instanceof Error ? error.message : String(error)}`
      }],
      isError: true
    }
  }
}
