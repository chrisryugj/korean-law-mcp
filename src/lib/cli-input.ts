import { z } from "zod"
import type { Readable } from "node:stream"
import { StringDecoder } from "node:string_decoder"

const MAX_CLI_QUERY_CHARACTERS = 20_000
const CliQuerySchema = z.string()
  .trim()
  .min(
    1,
    "질문을 입력하세요. / Enter a question."
  )
  .max(
    MAX_CLI_QUERY_CHARACTERS,
    "질문은 20,000자 이하여야 합니다. / The question must be 20,000 characters or fewer."
  )

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

export function parseCliQueryInput(rawInput: string): string {
  return CliQuerySchema.parse(rawInput)
}

async function readCliQueryFromStdin(
  input: Readable = process.stdin
): Promise<string> {
  const decoder = new StringDecoder("utf8")
  let query = ""
  try {
    for await (const chunk of input) {
      query += typeof chunk === "string"
        ? chunk
        : decoder.write(Buffer.from(chunk))
      if (query.length > MAX_CLI_QUERY_CHARACTERS) {
        return parseCliQueryInput(query)
      }
    }
    return parseCliQueryInput(query + decoder.end())
  } catch (error) {
    if (error instanceof z.ZodError) throw error
    throw new Error(
      "표준입력에서 질문을 읽지 못했습니다. / Failed to read the question from stdin."
    )
  }
}

export async function resolveCliQuery(
  words: readonly string[] | undefined,
  useStdin: boolean,
  input: Readable = process.stdin
): Promise<string> {
  if (useStdin && words?.length) {
    throw new Error(
      "--stdin과 위치 인자를 함께 사용할 수 없습니다. / " +
      "Do not combine --stdin with positional question arguments."
    )
  }
  return useStdin
    ? readCliQueryFromStdin(input)
    : parseCliQueryInput((words ?? []).join(" "))
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
