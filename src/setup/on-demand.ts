import { dirname, resolve } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"
import {
  getLawCredentialPath,
  readStoredLawApiKey,
  saveLawApiKey,
} from "../lib/law-credential.js"
import { promptSecret } from "./secret-prompt.js"
import type { SetupOptions } from "./setup-options.js"
import { installGlobalSkill } from "./skill-installer.js"

interface OnDemandRuntime {
  readonly credentialPath: string
  readonly userHome?: string
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
    await installGlobalSkill(getPackageRoot(), runtime.userHome ?? homedir())
    writeLine("  + 두 전역 설치 경로를 검증했습니다. / Verified both global install paths.")
  }

  writeLine("\n설정 완료 / Setup complete")
  writeLine(`  인증 설정 / Credential config: ${runtime.credentialPath}`)
  writeLine("  사용 / Usage: korean-law query --stdin")
  writeLine("  MCP 서버는 상시 등록되지 않습니다. / No persistent MCP server was registered.\n")
}
