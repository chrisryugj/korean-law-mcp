import { resolve } from "node:path"
import { homedir, platform } from "node:os"
import { z } from "zod"
import {
  readPrivateJsonFileSync,
  writePrivateJsonFile,
} from "./private-json-file.js"

const CONFIG_DIRECTORY = "korean-law"
const CONFIG_FILENAME = "config.json"
const ApiKeySchema = z.string().trim().min(1).max(512)
const CredentialFileSchema = z.object({
  lawOc: ApiKeySchema,
}).strict()

interface CredentialPathOptions {
  readonly env?: NodeJS.ProcessEnv
  readonly homeDir?: string
  readonly os?: NodeJS.Platform
}

interface ResolveLawApiKeyOptions extends CredentialPathOptions {
  readonly configPath?: string
}

function getConfigRoot(
  os: NodeJS.Platform,
  homeDir: string,
  env: NodeJS.ProcessEnv
): string {
  if (os === "win32") {
    return env.APPDATA || resolve(homeDir, "AppData/Roaming")
  }
  if (os === "darwin") {
    return resolve(homeDir, "Library/Application Support")
  }
  return env.XDG_CONFIG_HOME || resolve(homeDir, ".config")
}

export function getLawCredentialPath(options: CredentialPathOptions = {}): string {
  const env = options.env ?? process.env
  const homeDir = options.homeDir ?? homedir()
  const os = options.os ?? platform()
  return resolve(getConfigRoot(os, homeDir, env), CONFIG_DIRECTORY, CONFIG_FILENAME)
}

export function readStoredLawApiKey(configPath = getLawCredentialPath()): string {
  try {
    const parsed = CredentialFileSchema.safeParse(
      readPrivateJsonFileSync(configPath)
    )
    return parsed.success ? parsed.data.lawOc : ""
  } catch {
    return ""
  }
}

export function resolveLawApiKey(options: ResolveLawApiKeyOptions = {}): string {
  const env = options.env ?? process.env
  const environmentKey = env.LAW_OC?.trim() || env.KOREAN_LAW_API_KEY?.trim()
  if (environmentKey) return environmentKey

  const configPath = options.configPath ?? getLawCredentialPath(options)
  return readStoredLawApiKey(configPath)
}

export async function saveLawApiKey(
  apiKey: string,
  configPath = getLawCredentialPath()
): Promise<void> {
  const lawOc = ApiKeySchema.parse(apiKey)
  await writePrivateJsonFile(configPath, { lawOc })
}
