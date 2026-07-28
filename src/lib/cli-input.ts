import { z } from "zod"

const CliToolInputSchema = z.record(z.string(), z.unknown()).refine(
  (input) => !Object.prototype.hasOwnProperty.call(input, "apiKey"),
  {
    message:
      "apiKey는 명령행에 넣을 수 없습니다. 환경변수 또는 사용자 설정을 사용하세요. / " +
      "Do not pass apiKey via CLI; use an environment variable or user config.",
  }
)

export function validateCliToolInput(input: unknown): Record<string, unknown> {
  return CliToolInputSchema.parse(input)
}

export function parseCliJsonInput(rawInput: string): Record<string, unknown> {
  try {
    return validateCliToolInput(JSON.parse(rawInput))
  } catch (error) {
    if (error instanceof z.ZodError) throw error
    throw new Error(
      "--json-input 파싱 실패: 유효한 JSON을 입력하세요. / " +
      "Failed to parse --json-input: enter valid JSON."
    )
  }
}

function parseKeyValueInput(rawInput: string): Record<string, unknown> {
  return Object.fromEntries(
    rawInput.split(/\s+/).flatMap((pair) => {
      const separatorIndex = pair.indexOf("=")
      return separatorIndex <= 0
        ? []
        : [[
            pair.slice(0, separatorIndex),
            pair.slice(separatorIndex + 1).replace(/^["']|["']$/g, ""),
          ]]
    })
  )
}

export function parseDirectToolInput(rawInput: string): Record<string, unknown> {
  if (!rawInput) return {}

  try {
    return validateCliToolInput(JSON.parse(rawInput))
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return validateCliToolInput(parseKeyValueInput(rawInput))
  }
}
