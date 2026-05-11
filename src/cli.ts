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
import { explainRoute } from "./lib/query-router.js"
import { VERSION } from "./version.js"
import {
  fmt, printBanner, formatOutput,
  printInteractiveHelp, printToolList, getCategory,
  extractOptionsFromSchema, coerceValue,
  type CliOption,
} from "./lib/cli-format.js"
import {
  getApiClient, executeTool,
  executeNaturalQuery, executeNaturalQueryJson,
} from "./lib/cli-executor.js"

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
    sigintCount = 0
    rl.resume()
    rl.prompt()
  })

  // Ctrl+C: 실행 중이면 중단 알림, 2회 연속 시 강제 종료
  let sigintCount = 0
  rl.on("SIGINT", () => {
    if (executing) {
      sigintCount++
      if (sigintCount >= 2) {
        console.log(fmt.dim("\n강제 종료합니다."))
        process.exit(130)
      }
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
