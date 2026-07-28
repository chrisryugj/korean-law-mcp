import { spawn } from "node:child_process"
import { lstatSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { homedir, platform } from "node:os"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import {
  getLawCredentialPath,
  readStoredLawApiKey,
  saveLawApiKey,
} from "../lib/law-credential.js"
import { promptSecret } from "./secret-prompt.js"
import type { SetupOptions } from "./setup-options.js"

const SKILLS_CLI_NAME = "skills"
const SKILL_NAME = "korean-law"
const SKILLS_CLI_VERSION = "1.5.18"
const TARGET_AGENTS = ["claude-code", "codex"] as const
const TARGET_SKILL_DIRECTORIES = [
  [".claude", "skills", SKILL_NAME],
  [".agents", "skills", SKILL_NAME],
] as const
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
  readonly userHome?: string
}

const SkillListSchema = z.array(z.object({
  name: z.string(),
  path: z.string(),
  scope: z.literal("global"),
  agents: z.array(z.string()),
}))

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
      ...TARGET_AGENTS,
      "--yes",
      "--copy",
    ],
    env,
  }
}

function buildSkillListInvocation(
  installInvocation: CommandInvocation
): CommandInvocation {
  return {
    command: installInvocation.command,
    args: [
      "--yes",
      "--ignore-scripts",
      `${SKILLS_CLI_NAME}@${SKILLS_CLI_VERSION}`,
      "list",
      "--global",
      "--json",
    ],
    env: installInvocation.env,
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

async function captureCommand(invocation: CommandInvocation): Promise<string> {
  return await new Promise<string>((resolvePromise, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: invocation.env,
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
    child.once("error", reject)
    child.once("exit", (code) => {
      if (code === 0) {
        resolvePromise(Buffer.concat(stdout).toString("utf8"))
        return
      }
      const detail = Buffer.concat(stderr).toString("utf8").trim()
      reject(new Error(
        `Skill verification exited with code ${code ?? "unknown"}${detail ? `: ${detail}` : ""}`
      ))
    })
  })
}

export function getExpectedGlobalSkillFiles(userHome: string): readonly string[] {
  return TARGET_SKILL_DIRECTORIES.map((segments) =>
    join(userHome, ...segments, "SKILL.md")
  )
}

function isExpectedSkillFile(skillFile: string): boolean {
  try {
    const stat = lstatSync(skillFile)
    const content = readFileSync(skillFile, "utf8")
    return stat.isFile() &&
      !stat.isSymbolicLink() &&
      /^---\s*\nname: korean-law$/m.test(content)
  } catch {
    return false
  }
}

function verifySkillFiles(userHome: string): void {
  for (const skillFile of getExpectedGlobalSkillFiles(userHome)) {
    if (isExpectedSkillFile(skillFile)) continue
    throw new Error(
      `Skill 파일 검증 실패 / Skill file verification failed: ${skillFile}`
    )
  }
}

async function verifySkillInstallation(
  installInvocation: CommandInvocation,
  userHome: string
): Promise<void> {
  const output = await captureCommand(buildSkillListInvocation(installInvocation))
  const installed = SkillListSchema.parse(JSON.parse(output))
  const listed = installed.some((skill) =>
    skill.name === SKILL_NAME
  )
  if (!listed) {
    throw new Error(
      "전역 Skill 목록에서 korean-law를 확인하지 못했습니다. / " +
      "korean-law was not found in the global Skill list."
    )
  }
  verifySkillFiles(userHome)
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
    writeLine("  + Claude Code·Codex 전역 Skill을 설치합니다.")
    writeLine("    Installing the global Skill for Claude Code and Codex.")
    const invocation = buildSkillInstallInvocation(getPackageRoot())
    await runCommand(invocation)
    await verifySkillInstallation(invocation, runtime.userHome ?? homedir())
    writeLine("  + 두 전역 설치 경로를 검증했습니다. / Verified both global install paths.")
  }

  writeLine("\n설정 완료 / Setup complete")
  writeLine(`  인증 설정 / Credential config: ${runtime.credentialPath}`)
  writeLine("  사용 / Usage: korean-law query --stdin")
  writeLine("  MCP 서버는 상시 등록되지 않습니다. / No persistent MCP server was registered.\n")
}
