#!/usr/bin/env node

/**
 * Korean Law CLI v2.0
 * 자연어 한 줄로 모든 법령을 조회하는 프로덕션급 CLI
 *
 * Usage:
 *   korean-law "민법 제1조"                    # 자연어 → 자동 라우팅
 *   korean-law "음주운전 처벌 기준"             # 종합 리서치 자동 실행
 *   korean-law "관세법 개정 이력"               # 개정추적 체인 자동 실행
 *   korean-law search_law --query "민법"       # 직접 도구 호출 (기존 방식)
 *   korean-law list                            # 도구 목록
 *   korean-law interactive                     # 대화형 모드
 */

import { Command } from "commander"
import { z } from "zod"
import * as readline from "readline"
import { LawApiClient } from "./lib/api-client.js"
import { allTools } from "./tool-registry.js"
import { routeQuery, explainRoute } from "./lib/query-router.js"
import { SEARCH_DETAIL_CHAINS } from "./lib/tool-chain-config.js"
import type { McpTool, ToolResponse } from "./lib/types.js"
import { VERSION } from "./version.js"

// ────────────────────────────────────────
// CLI Output Formatting
// ────────────────────────────────────────

const isColorSupported = process.stdout.isTTY && !process.env.NO_COLOR

/**
 * ANSI 포맷 유틸.
 * 중첩 시 내부 \x1b[0m이 외부까지 리셋하는 문제 방지:
 * 단일 래퍼만 사용하거나, 복합 스타일은 전용 함수로 처리.
 */
const fmt = {
  bold: (s: string) => isColorSupported ? `\x1b[1m${s}\x1b[22m` : s,
  dim: (s: string) => isColorSupported ? `\x1b[2m${s}\x1b[22m` : s,
  green: (s: string) => isColorSupported ? `\x1b[32m${s}\x1b[39m` : s,
  yellow: (s: string) => isColorSupported ? `\x1b[33m${s}\x1b[39m` : s,
  cyan: (s: string) => isColorSupported ? `\x1b[36m${s}\x1b[39m` : s,
  red: (s: string) => isColorSupported ? `\x1b[31m${s}\x1b[39m` : s,
  blue: (s: string) => isColorSupported ? `\x1b[34m${s}\x1b[39m` : s,
  magenta: (s: string) => isColorSupported ? `\x1b[35m${s}\x1b[39m` : s,
  // 복합 스타일 (중첩 안전)
  boldCyan: (s: string) => isColorSupported ? `\x1b[1;36m${s}\x1b[0m` : s,
  boldGreen: (s: string) => isColorSupported ? `\x1b[1;32m${s}\x1b[0m` : s,
}

function printBanner() {
  console.log()
  console.log(fmt.bold("  Korean Law CLI v" + VERSION))
  console.log(fmt.dim("  법제처 API 기반 · 64개 도구 · 자연어 지원"))
  console.log()
}

function printRouteInfo(tool: string, reason: string) {
  console.log(fmt.dim(`  [라우팅] ${tool} — ${reason}`))
  console.log()
}

function formatOutput(text: string): string {
  if (!isColorSupported) return text

  return text
    // 섹션 헤더
    .replace(/^(═+.*═+)$/gm, (m) => fmt.boldCyan(m))
    .replace(/^(▶\s*.+)$/gm, (m) => fmt.boldGreen(m))
    // 법령명/제목
    .replace(/^(법령명:\s*.+)$/gm, (m) => fmt.bold(m))
    // 안내 메시지
    .replace(/(💡.+)/g, (m) => fmt.yellow(m))
    // 에러
    .replace(/(❌.+)/g, (m) => fmt.red(m))
    // 번호 목록
    .replace(/^(\d+\.\s)/gm, (m) => fmt.cyan(m))
}

// ────────────────────────────────────────
// Schema Extraction (for subcommands)
// ────────────────────────────────────────

interface CliOption {
  name: string
  description: string
  required: boolean
  type: string
  defaultValue?: unknown
}

function extractOptionsFromSchema(schema: z.ZodSchema): CliOption[] {
  let jsonSchema: Record<string, any>
  try {
    jsonSchema = z.toJSONSchema(schema) as Record<string, any>
  } catch {
    return []
  }

  if (jsonSchema?.type !== "object" || !jsonSchema.properties) {
    return []
  }

  const requiredFields = new Set<string>(jsonSchema.required || [])
  const options: CliOption[] = []

  for (const [key, prop] of Object.entries<any>(jsonSchema.properties)) {
    let type = "string"
    const propType = prop.type

    if (propType === "number" || propType === "integer") {
      type = "number"
    } else if (propType === "boolean") {
      type = "boolean"
    } else if (propType === "array") {
      type = "array"
    }

    const hasDefault = prop.default !== undefined
    options.push({
      name: key,
      description: prop.description || "",
      required: hasDefault ? false : requiredFields.has(key),
      type,
      defaultValue: prop.default
    })
  }

  return options
}

function coerceValue(value: string, type: string): unknown {
  switch (type) {
    case "number": return Number(value)
    case "boolean": return value === "true" || value === "1"
    case "array": {
      try { return JSON.parse(value) }
      catch { return value.split(",") }
    }
    default: return value
  }
}

function getCategory(tool: McpTool): string {
  const match = tool.description.match(/^\[(.+?)\]/)
  return match ? match[1] : "기타"
}

// ────────────────────────────────────────
// Core: Execute Tool
// ────────────────────────────────────────

function getApiClient(): LawApiClient {
  const apiKey = process.env.LAW_OC || ""
  if (!apiKey) {
    console.error(fmt.red("LAW_OC 환경변수가 필요합니다."))
    console.error(fmt.dim("API 키 발급: https://open.law.go.kr/LSO/openApi/guideResult.do"))
    process.exit(1)
  }
  return new LawApiClient({ apiKey })
}

async function executeTool(
  apiClient: LawApiClient,
  toolName: string,
  params: Record<string, unknown>
): Promise<ToolResponse> {
  const tool = allTools.find(t => t.name === toolName)
  if (!tool) {
    return {
      content: [{ type: "text", text: `알 수 없는 도구: ${toolName}` }],
      isError: true,
    }
  }

  try {
    const parsed = tool.schema.parse(params)
    return await tool.handler(apiClient, parsed)
  } catch (error) {
    // Zod 검증 실패 등 모든 예외를 ToolResponse로 감싸서 반환
    const msg = error instanceof z.ZodError
      ? error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")
      : (error instanceof Error ? error.message : String(error))
    return {
      content: [{ type: "text", text: `오류 [${toolName}]: ${msg}` }],
      isError: true,
    }
  }
}

/**
 * 자연어 쿼리 실행 (라우팅 + 파이프라인)
 */
async function executeNaturalQuery(
  apiClient: LawApiClient,
  query: string,
  verbose: boolean
): Promise<void> {
  const route = routeQuery(query)

  if (verbose) {
    console.log(fmt.dim(explainRoute(query)))
  } else {
    printRouteInfo(route.tool, route.reason)
  }

  // 날짜 범위가 있으면 검색 파라미터에 주입
  if (route.dateRange) {
    route.params.fromDate = route.dateRange.from
    route.params.toDate = route.dateRange.to
  }

  // 1단계: 메인 도구 실행
  const result = await executeTool(apiClient, route.tool, route.params)

  // 파이프라인이 있으면 1단계 결과에서 ID 추출하여 2단계 실행
  if (route.pipeline && route.pipeline.length > 0 && !result.isError) {
    const firstOutput = result.content[0]?.text || ""
    const pipeId = extractPipelineId(route.tool, firstOutput)

    if (pipeId) {
      // 자동 체인: 검색 결과 요약 먼저 출력
      if (route.autoChain) {
        const summary = extractSearchSummary(firstOutput)
        if (summary) {
          console.log(fmt.dim(summary))
          console.log()
        }
      }

      for (const step of route.pipeline) {
        const pipeParams = { ...step.params, ...pipeId }

        if (verbose) {
          console.log(fmt.dim(`  → 체인: ${step.tool}(${JSON.stringify(pipeParams)})`))
        }

        const pipeResult = await executeTool(apiClient, step.tool, pipeParams)
        console.log(formatOutput(pipeResult.content.map(c => c.text).join("\n")))

        if (pipeResult.isError) {
          process.exitCode = 1
        }
      }
      return
    }

    // ID 추출 실패 → 1단계 결과라도 표시
    console.log(formatOutput(firstOutput))
    if (!route.autoChain) {
      console.log(fmt.yellow("💡 파이프라인: 검색 결과에서 식별자를 추출하지 못했습니다."))
    }
    return
  }

  // 결과 출력
  console.log(formatOutput(result.content.map(c => c.text).join("\n")))

  if (result.isError) {
    process.exitCode = 1
  }
}

/**
 * 파이프라인 ID 추출 (검색 도구별 설정 또는 기본 MST 패턴)
 */
function extractPipelineId(
  searchTool: string,
  output: string
): Record<string, string> | null {
  // 1. 체인 설정이 있으면 해당 regex 사용
  const chain = SEARCH_DETAIL_CHAINS[searchTool]
  if (chain) {
    const match = output.match(chain.idRegex)
    if (match) {
      return { [chain.detailParam]: match[1] }
    }
    return null
  }

  // 2. 기본: search_law → get_law_text 파이프라인 (MST/lawId)
  const mstMatch = output.match(/MST:\s*(\d+)/)
  if (mstMatch) return { mst: mstMatch[1] }

  const lawIdMatch = output.match(/법령ID:\s*(\d+)/)
  if (lawIdMatch) return { lawId: lawIdMatch[1] }

  return null
}

/**
 * 검색 결과에서 요약 헤더를 추출 (첫 3줄 정도)
 */
function extractSearchSummary(output: string): string | null {
  const lines = output.split("\n")
  // 첫 줄(제목)과 결과 건수 라인 추출
  const summaryLines: string[] = []
  for (const line of lines) {
    if (summaryLines.length >= 3) break
    const trimmed = line.trim()
    if (!trimmed) continue
    summaryLines.push(trimmed)
  }
  return summaryLines.length > 0 ? summaryLines.join("\n") : null
}

/**
 * 자연어 쿼리 JSON 출력 (top-level --json 플래그)
 */
async function executeNaturalQueryJson(
  apiClient: LawApiClient,
  query: string
): Promise<void> {
  const route = routeQuery(query)
  try {
    // 날짜 범위가 있으면 검색 파라미터에 주입
    if (route.dateRange) {
      route.params.fromDate = route.dateRange.from
      route.params.toDate = route.dateRange.to
    }

    const result = await executeTool(apiClient, route.tool, route.params)

    let pipelineResult: string | undefined
    if (route.pipeline && route.pipeline.length > 0 && !result.isError) {
      const firstOutput = result.content[0]?.text || ""
      const pipeId = extractPipelineId(route.tool, firstOutput)
      if (pipeId) {
        const pipeParams = { ...route.pipeline[0].params, ...pipeId }
        const pResult = await executeTool(apiClient, route.pipeline[0].tool, pipeParams)
        pipelineResult = pResult.content.map(c => c.text).join("\n")
      }
    }

    console.log(JSON.stringify({
      query,
      route: { tool: route.tool, reason: route.reason, params: route.params },
      result: result.content.map(c => c.text).join("\n"),
      pipelineResult,
      isError: result.isError || false,
    }, null, 2))
  } catch (error) {
    console.log(JSON.stringify({
      query,
      route: { tool: route.tool, reason: route.reason },
      error: error instanceof Error ? error.message : String(error),
    }, null, 2))
    process.exit(1)
  }
}

// ────────────────────────────────────────
// Interactive REPL Mode
// ────────────────────────────────────────

async function runInteractive(): Promise<void> {
  const apiClient = getApiClient()

  printBanner()
  console.log(fmt.green("  대화형 모드 시작"))
  console.log(fmt.dim("  자연어로 법령을 검색하세요. 'exit'로 종료합니다."))
  console.log()
  console.log(fmt.dim("  예시:"))
  console.log(fmt.dim('    > 민법 제1조'))
  console.log(fmt.dim('    > 음주운전 처벌 기준'))
  console.log(fmt.dim('    > 관세법 3단비교'))
  console.log(fmt.dim('    > 건축허가 절차 수수료'))
  console.log()

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: fmt.cyan("법령> "),
    historySize: 100,
  })

  const history: string[] = []
  let executing = false // 레이스 컨디션 방지

  rl.prompt()

  rl.on("line", async (line: string) => {
    const input = line.trim()

    if (!input) {
      rl.prompt()
      return
    }

    // 실행 중이면 무시
    if (executing) {
      console.log(fmt.dim("  (이전 쿼리 실행 중...)"))
      return
    }

    // 특수 명령어 (동기 처리)
    if (input === "exit" || input === "quit" || input === "q") {
      console.log(fmt.dim("\n종료합니다."))
      rl.close()
      return
    }

    if (input === "help" || input === "?") {
      printInteractiveHelp()
      rl.prompt()
      return
    }

    if (input === "history") {
      console.log(fmt.bold("\n검색 이력:"))
      history.forEach((h, i) => console.log(fmt.dim(`  ${i + 1}. ${h}`)))
      console.log()
      rl.prompt()
      return
    }

    if (input === "tools" || input === "list") {
      printToolList()
      rl.prompt()
      return
    }

    if (input.startsWith("explain ")) {
      const q = input.slice(8).trim()
      console.log(fmt.dim(explainRoute(q)))
      rl.prompt()
      return
    }

    // 비동기 실행 (입력 일시 중지)
    executing = true
    rl.pause()

    // 직접 도구 호출: @tool_name {...params}
    if (input.startsWith("@")) {
      await handleDirectCall(apiClient, input)
    } else {
      // 자연어 쿼리 실행
      history.push(input)
      console.log()

      try {
        await executeNaturalQuery(apiClient, input, false)
      } catch (error) {
        console.error(fmt.red(`오류: ${error instanceof Error ? error.message : String(error)}`))
      }
    }

    console.log()
    executing = false
    rl.resume()
    rl.prompt()
  })

  // Ctrl+C: 실행 중이면 중단 알림, 아니면 종료
  rl.on("SIGINT", () => {
    if (executing) {
      console.log(fmt.yellow("\n  (Ctrl+C: 현재 쿼리 완료를 기다립니다. 강제 종료: Ctrl+C x2)"))
    } else {
      console.log(fmt.dim("\n종료합니다."))
      rl.close()
    }
  })

  rl.on("close", () => {
    process.exit(0)
  })
}

async function handleDirectCall(apiClient: LawApiClient, input: string): Promise<void> {
  // @tool_name {"key": "value"} or @tool_name key=value
  const spaceIdx = input.indexOf(" ")
  const toolName = spaceIdx > 0 ? input.slice(1, spaceIdx) : input.slice(1)
  const paramStr = spaceIdx > 0 ? input.slice(spaceIdx + 1).trim() : ""

  let params: Record<string, unknown> = {}
  if (paramStr) {
    try {
      params = JSON.parse(paramStr)
    } catch {
      // key=value 형식 시도
      for (const pair of paramStr.split(/\s+/)) {
        const eqIdx = pair.indexOf("=")
        if (eqIdx > 0) {
          params[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1).replace(/^["']|["']$/g, "")
        }
      }
    }
  }

  const result = await executeTool(apiClient, toolName, params)
  console.log(formatOutput(result.content.map(c => c.text).join("\n")))
}

function printInteractiveHelp() {
  console.log()
  console.log(fmt.bold("  사용법:"))
  console.log(`    ${fmt.cyan("자연어 입력")}       법령을 자연어로 검색 (자동 라우팅)`)
  console.log(`    ${fmt.cyan("@도구명 {...}")}    특정 도구 직접 호출`)
  console.log(`    ${fmt.cyan("explain <질의>")}   라우팅 경로 확인 (실행하지 않음)`)
  console.log(`    ${fmt.cyan("tools / list")}     사용 가능한 도구 목록`)
  console.log(`    ${fmt.cyan("history")}          검색 이력`)
  console.log(`    ${fmt.cyan("exit / q")}         종료`)
  console.log()
  console.log(fmt.bold("  자연어 예시:"))
  console.log(fmt.dim("    민법 제1조                    → 조문 직접 조회"))
  console.log(fmt.dim("    음주운전 처벌 기준             → 종합 리서치"))
  console.log(fmt.dim("    관세법 3단비교                 → 법체계 분석"))
  console.log(fmt.dim("    건축허가 거부 판례             → 판례 검색"))
  console.log(fmt.dim("    관세법 개정 이력               → 개정 추적"))
  console.log(fmt.dim("    서울시 주차 조례               → 자치법규 검색"))
  console.log(fmt.dim("    여권발급 절차 수수료            → 절차/비용 안내"))
  console.log()
}

function printToolList() {
  const grouped = new Map<string, McpTool[]>()
  for (const tool of allTools) {
    const cat = getCategory(tool)
    if (!grouped.has(cat)) grouped.set(cat, [])
    grouped.get(cat)!.push(tool)
  }

  console.log(`\n${fmt.bold(`  ${allTools.length}개 도구`)}\n`)
  for (const [cat, catTools] of grouped) {
    console.log(fmt.bold(`  ── ${cat} ──`))
    for (const t of catTools) {
      const desc = t.description.replace(/^\[.+?\]\s*/, "")
      console.log(`    ${fmt.cyan(t.name.padEnd(35))} ${fmt.dim(desc)}`)
    }
    console.log()
  }
}

// ────────────────────────────────────────
// Program Setup
// ────────────────────────────────────────

function createProgram(): Command {
  const program = new Command()
    .name("korean-law")
    .description("한국 법령 검색 CLI - 자연어 한 줄로 모든 법령 조회")
    .version(VERSION)

  // ── 자연어 쿼리 (기본 명령) ──
  program
    .command("query <question...>")
    .alias("q")
    .description("자연어로 법령 조회 (예: korean-law query 민법 제1조)")
    .option("-v, --verbose", "라우팅 상세 정보 출력")
    .option("--json", "JSON 형식으로 출력")
    .action(async (words: string[], opts: { verbose?: boolean; json?: boolean }) => {
      const apiClient = getApiClient()
      const query = words.join(" ")

      if (opts.json) {
        await executeNaturalQueryJson(apiClient, query)
        return
      }

      await executeNaturalQuery(apiClient, query, opts.verbose || false)
    })

  // ── 대화형 모드 ──
  program
    .command("interactive")
    .alias("i")
    .description("대화형 법령 검색 모드 (REPL)")
    .action(async () => {
      await runInteractive()
    })

  // ── explain (라우팅 경로 확인) ──
  program
    .command("explain <question...>")
    .description("자연어 질의의 라우팅 경로 확인 (실행하지 않음)")
    .action((words: string[]) => {
      const query = words.join(" ")
      console.log(explainRoute(query))
    })

  // ── list 명령 ──
  program
    .command("list")
    .alias("ls")
    .description("사용 가능한 도구 목록")
    .option("-c, --category <category>", "카테고리 필터 (예: 판례, 법령, 비교)")
    .option("--json", "JSON 형식으로 출력")
    .action((opts: { category?: string; json?: boolean }) => {
      let tools = allTools

      if (opts.category) {
        tools = tools.filter(t =>
          getCategory(t).includes(opts.category!)
        )
      }

      if (opts.json) {
        const data = tools.map(t => ({
          name: t.name,
          category: getCategory(t),
          description: t.description
        }))
        console.log(JSON.stringify(data, null, 2))
        return
      }

      printBanner()
      printToolList()
      console.log(fmt.dim("  사용법: korean-law <도구명> [옵션]"))
      console.log(fmt.dim("  자연어: korean-law query \"민법 제1조\""))
      console.log(fmt.dim("  대화형: korean-law interactive"))
      console.log()
    })

  // ── help <tool> 명령 ──
  program
    .command("help <tool-name>")
    .description("도구 상세 도움말")
    .action((toolName: string) => {
      const tool = allTools.find(t => t.name === toolName)
      if (!tool) {
        console.error(fmt.red(`알 수 없는 도구: ${toolName}`))
        console.error(fmt.dim(`'korean-law list'로 사용 가능한 도구를 확인하세요.`))
        process.exit(1)
      }

      const options = extractOptionsFromSchema(tool.schema)

      console.log()
      console.log(fmt.bold(tool.name))
      console.log("─".repeat(tool.name.length))
      console.log(tool.description)
      console.log()

      if (options.length > 0) {
        console.log(fmt.bold("파라미터:"))
        for (const opt of options) {
          const reqLabel = opt.required ? fmt.red("(필수)") : fmt.dim("(선택)")
          const defLabel = opt.defaultValue !== undefined ? fmt.dim(` [기본값: ${opt.defaultValue}]`) : ""
          console.log(`  --${fmt.cyan(opt.name.padEnd(20))} ${reqLabel} ${opt.description}${defLabel}`)
        }
        console.log()
      }

      const example = options
        .filter(o => o.required && o.name !== "apiKey")
        .map(o => `--${o.name} "<값>"`)
        .join(" ")
      console.log(fmt.dim(`예시: korean-law ${tool.name} ${example}`))
      console.log()
    })

  // ── 도구를 동적으로 서브커맨드 등록 ──
  for (const tool of allTools) {
    const cmd = program
      .command(tool.name)
      .description(tool.description)

    const options = extractOptionsFromSchema(tool.schema)

    for (const opt of options) {
      const flag = opt.type === "boolean"
        ? `--${opt.name}`
        : `--${opt.name} <value>`

      if (opt.required) {
        cmd.requiredOption(flag, opt.description)
      } else {
        if (opt.defaultValue !== undefined) {
          cmd.option(flag, opt.description, String(opt.defaultValue))
        } else {
          cmd.option(flag, opt.description)
        }
      }
    }

    cmd.option("--json-input <json>", "JSON 문자열로 전체 파라미터 전달")

    cmd.action(async (cmdOpts: Record<string, string>) => {
      const apiKey = cmdOpts.apiKey || process.env.LAW_OC || ""
      if (!apiKey) {
        console.error(fmt.red("LAW_OC 환경변수 또는 --apiKey 옵션이 필요합니다."))
        console.error(fmt.dim("API 키 발급: https://open.law.go.kr/LSO/openApi/guideResult.do"))
        process.exit(1)
      }

      const apiClient = new LawApiClient({ apiKey })

      let input: Record<string, unknown>

      if (cmdOpts.jsonInput) {
        try {
          input = JSON.parse(cmdOpts.jsonInput)
        } catch {
          console.error(fmt.red("--json-input 파싱 실패: 유효한 JSON을 입력하세요."))
          process.exit(1)
        }
      } else {
        input = {}
        for (const opt of options) {
          const val = cmdOpts[opt.name]
          if (val !== undefined) {
            input[opt.name] = coerceValue(val, opt.type)
          }
        }
      }

      try {
        const parsed = tool.schema.parse(input)
        const result = await tool.handler(apiClient, parsed)

        for (const c of result.content) {
          console.log(formatOutput(c.text))
        }

        if (result.isError) {
          process.exit(1)
        }
      } catch (error) {
        if (error instanceof z.ZodError) {
          console.error(fmt.red("입력 검증 실패:"))
          for (const issue of error.issues) {
            console.error(`  ${issue.path.join(".")}: ${issue.message}`)
          }
          console.error(fmt.dim(`\n'korean-law help ${tool.name}'으로 파라미터를 확인하세요.`))
        } else {
          console.error(fmt.red(error instanceof Error ? error.message : String(error)))
        }
        process.exit(1)
      }
    })
  }

  return program
}

// ────────────────────────────────────────
// Entry Point
// ────────────────────────────────────────

/** CLI 플래그를 쿼리 텍스트에서 분리 */
function separateFlags(args: string[]): { queryArgs: string[]; verbose: boolean; json: boolean } {
  const queryArgs: string[] = []
  let verbose = false
  let json = false
  for (const arg of args) {
    if (arg === "--verbose" || arg === "-v") {
      verbose = true
    } else if (arg === "--json") {
      json = true
    } else {
      queryArgs.push(arg)
    }
  }
  return { queryArgs, verbose, json }
}

async function main() {
  const args = process.argv.slice(2)

  // 인자가 없으면 대화형 모드
  if (args.length === 0) {
    await runInteractive()
    return
  }

  // 인자가 있는데 등록된 명령이 아니고, '-'로 시작하지 않으면 자연어 쿼리
  const knownCommands = new Set([
    "query", "q", "interactive", "i", "explain", "list", "ls", "help",
    ...allTools.map(t => t.name),
  ])

  const firstArg = args[0]
  if (!knownCommands.has(firstArg) && !firstArg.startsWith("-")) {
    // 플래그와 쿼리 분리
    const { queryArgs, verbose, json } = separateFlags(args)
    const query = queryArgs.join(" ")

    if (!query) {
      await runInteractive()
      return
    }

    const apiClient = getApiClient()

    if (json) {
      await executeNaturalQueryJson(apiClient, query)
    } else {
      await executeNaturalQuery(apiClient, query, verbose)
    }
    return
  }

  await createProgram().parseAsync(process.argv)
}

main().catch((error) => {
  console.error(fmt.red(error instanceof Error ? error.message : String(error)))
  process.exit(1)
})
