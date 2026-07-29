import { lstatSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { platform } from "node:os"
import { z } from "zod"
import {
  captureCommand,
  runCommand,
  type CommandInvocation,
} from "./child-command.js"

const SKILLS_CLI_NAME = "skills"
const SKILL_NAME = "korean-law"
const SKILLS_CLI_VERSION = "1.5.18"
const TARGET_AGENTS = ["claude-code", "codex"] as const
const TARGET_SKILL_DIRECTORIES = [
  [".claude", "skills", SKILL_NAME],
  [".agents", "skills", SKILL_NAME],
] as const
const INSTALLER_ENV_KEYS = [
  "PATH", "Path", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
  "XDG_CONFIG_HOME", "SystemRoot", "ComSpec", "PATHEXT", "TEMP",
  "TMP", "TMPDIR", "SHELL", "TERM", "COLORTERM", "LANG", "LC_ALL",
] as const

const SkillListSchema = z.array(z.object({
  name: z.string(),
  path: z.string(),
  scope: z.literal("global"),
  agents: z.array(z.string()),
}))

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
  if (!installed.some((skill) => skill.name === SKILL_NAME)) {
    throw new Error(
      "전역 Skill 목록에서 korean-law를 확인하지 못했습니다. / " +
      "korean-law was not found in the global Skill list."
    )
  }
  verifySkillFiles(userHome)
}

export async function installGlobalSkill(
  packageRoot: string,
  userHome: string
): Promise<void> {
  const invocation = buildSkillInstallInvocation(packageRoot)
  await runCommand(invocation)
  await verifySkillInstallation(invocation, userHome)
}
