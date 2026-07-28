import { z } from "zod"

const SetupModeSchema = z.enum(["mcp", "on-demand"])

export interface SetupOptions {
  readonly mode: z.infer<typeof SetupModeSchema>
  readonly skipSkillInstall: boolean
  readonly showHelp: boolean
}

export const SETUP_HELP = `
사용법 / Usage:
  korean-law-mcp setup
  korean-law-mcp setup --mode mcp
  korean-law-mcp setup --mode on-demand [--skip-skill-install]

모드 / Modes:
  mcp        AI 클라이언트에 stdio MCP 서버를 등록합니다.
             Register a stdio MCP server in an AI client.
  on-demand  전역 Agent Skill을 설치하고 질의할 때만 CLI를 실행합니다.
             Install a global Agent Skill and run the CLI only when queried.
`.trim()

interface ParseState {
  readonly rawMode: string
  readonly skipSkillInstall: boolean
  readonly showHelp: boolean
}

function parseArgs(
  args: readonly string[],
  index: number,
  state: ParseState
): ParseState {
  if (index >= args.length) return state

  const arg = args[index]
  if (arg === "--mode") {
    return parseArgs(args, index + 2, {
      ...state,
      rawMode: args[index + 1] ?? "",
    })
  }
  if (arg === "--skip-skill-install") {
    return parseArgs(args, index + 1, { ...state, skipSkillInstall: true })
  }
  if (arg === "--help" || arg === "-h") {
    return parseArgs(args, index + 1, { ...state, showHelp: true })
  }
  throw new Error(`알 수 없는 setup 옵션 / Unknown setup option: ${arg}`)
}

export function parseSetupOptions(args: readonly string[]): SetupOptions {
  const state = parseArgs(args, 0, {
    rawMode: "mcp",
    skipSkillInstall: false,
    showHelp: false,
  })
  const mode = SetupModeSchema.parse(state.rawMode)
  if (mode !== "on-demand" && state.skipSkillInstall) {
    throw new Error(
      "--skip-skill-install은 on-demand 모드에서만 사용할 수 있습니다. / " +
      "--skip-skill-install is only available in on-demand mode."
    )
  }

  return {
    mode,
    skipSkillInstall: state.skipSkillInstall,
    showHelp: state.showHelp,
  }
}
