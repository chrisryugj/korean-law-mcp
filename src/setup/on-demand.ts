import { spawn } from "node:child_process"
import { dirname, resolve } from "node:path"
import { platform } from "node:os"
import { fileURLToPath } from "node:url"
import {
  getLawCredentialPath,
  readStoredLawApiKey,
  saveLawApiKey,
} from "../lib/law-credential.js"
import { promptSecret } from "./secret-prompt.js"
import type { SetupOptions } from "./setup-options.js"

const SKILLS_CLI_NAME = "skills"
const SKILL_NAME = "korean-law"
const ALL_AGENTS = "*"
const SKILLS_CLI_VERSION = "1.5.18"
const INSTALLER_ENV_KEYS = [
  "PATH",
  "Path",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "XDG_CONFIG_HOME",
  "SystemRoot",
  "ComSpec",
  "PATHEXT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "SHELL",
  "TERM",
  "COLORTERM",
  "LANG",
  "LC_ALL",
] as const

interface CommandInvocation {
  readonly command: string
  readonly args: readonly string[]
  readonly env: Readonly<NodeJS.ProcessEnv>
}

interface OnDemandRuntime {
  readonly credentialPath: string
}

function writeLine(message = ""): void {
  process.stdout.write(`${message}\n`)
}

function getPackageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..")
}

function getEnvironmentApiKey(): string {
  return process.env.LAW_OC?.trim() ||
    process.env.KOREAN_LAW_API_KEY?.trim() ||
    ""
}

export function buildSkillInstallInvocation(
  packageRoot: string,
  os: NodeJS.Platform = platform(),
  sourceEnv: NodeJS.ProcessEnv = process.env,
  nodeExecutable = process.execPath
): CommandInvocation {
  const env = Object.fromEntries(
    INSTALLER_ENV_KEYS.flatMap((key) => {
      const value = sourceEnv[key]
      return value === undefined ? [] : [[key, value]]
    })
  )
  return {
    command: resolve(
      dirname(nodeExecutable),
      os === "win32" ? "npx.cmd" : "npx"
    ),
    args: [
      "--yes",
      "--ignore-scripts",
      `${SKILLS_CLI_NAME}@${SKILLS_CLI_VERSION}`,
      "add",
      packageRoot,
      "--global",
      "--skill",
      SKILL_NAME,
      "--agent",
      ALL_AGENTS,
      "--yes",
      "--copy",
    ],
    env,
  }
}

async function runCommand(invocation: CommandInvocation): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      stdio: "inherit",
      env: invocation.env,
    })
    child.once("error", reject)
    child.once("exit", (code) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      reject(new Error(`Skill installer exited with code ${code ?? "unknown"}`))
    })
  })
}

async function configureCredential(configPath: string): Promise<void> {
  const environmentKey = getEnvironmentApiKey()
  const existingKey = readStoredLawApiKey(configPath)
  const suffix = existingKey
    ? " (Enter: 기존 키 유지 / keep existing key)"
    : environmentKey
      ? " (Enter: 환경변수만 사용 / use environment without saving)"
    : " (Enter: 건너뛰기 / skip)"
  const apiKey = await promptSecret(`  법제처 API 키 / MOLEG API key${suffix}: `)

  if (apiKey) {
    await saveLawApiKey(apiKey, configPath)
    writeLine("  + API 키를 저장했습니다. / Saved the API key.")
  } else if (existingKey) {
    writeLine("  = 기존 API 키를 유지했습니다. / Kept the existing API key.")
  } else if (environmentKey) {
    writeLine("  = 환경변수 키를 영구 저장하지 않았습니다.")
    writeLine("    Used the environment key without persisting it.")
  } else {
    writeLine("  ! API 키를 건너뛰었습니다. / Skipped the API key.")
  }
}

export async function runOnDemandSetup(
  options: SetupOptions,
  runtime: OnDemandRuntime = { credentialPath: getLawCredentialPath() }
): Promise<void> {
  writeLine("\nKorean Law 온디맨드 설치 / On-demand setup\n")
  await configureCredential(runtime.credentialPath)

  if (options.skipSkillInstall) {
    writeLine("  - Skill 설치를 건너뛰었습니다. / Skipped Skill installation.")
  } else {
    writeLine("  + 전역 Agent Skill을 설치합니다. / Installing the global Agent Skill.")
    await runCommand(buildSkillInstallInvocation(getPackageRoot()))
  }

  writeLine("\n설정 완료 / Setup complete")
  writeLine(`  인증 설정 / Credential config: ${runtime.credentialPath}`)
  writeLine("  사용 / Usage: korean-law query \"민법 제1조\"")
  writeLine("  MCP 서버는 상시 등록되지 않습니다. / No persistent MCP server was registered.\n")
}
