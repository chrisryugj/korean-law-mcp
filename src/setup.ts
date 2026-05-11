/**
 * 대화형 설치 마법사
 *
 * `npx korean-law-mcp setup` 으로 실행.
 * API 키를 입력받고, 선택한 AI 클라이언트 설정 파일에 MCP 서버를 자동 등록합니다.
 */

import { createInterface } from "node:readline/promises"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { homedir, platform } from "node:os"
import { stdin, stdout } from "node:process"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClientConfig {
  readonly name: string
  readonly configPath: string
  readonly format: "mcpServers" | "servers" | "context_servers"
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectClients(): readonly ClientConfig[] {
  const home = homedir()
  const os = platform()
  const clients: ClientConfig[] = []

  // Claude Desktop
  const claudePaths: Record<string, string> = {
    darwin: resolve(home, "Library/Application Support/Claude/claude_desktop_config.json"),
    win32: resolve(process.env["APPDATA"] ?? resolve(home, "AppData/Roaming"), "Claude/claude_desktop_config.json"),
    linux: resolve(home, ".config/Claude/claude_desktop_config.json"),
  }
  const claudePath = claudePaths[os]
  if (claudePath) {
    clients.push({ name: "Claude Desktop", configPath: claudePath, format: "mcpServers" })
  }

  // Claude Code
  clients.push({
    name: "Claude Code (현재 디렉토리)",
    configPath: resolve(process.cwd(), ".mcp.json"),
    format: "mcpServers",
  })

  // Cursor
  clients.push({
    name: "Cursor",
    configPath: resolve(home, ".cursor/mcp.json"),
    format: "mcpServers",
  })

  // VS Code
  clients.push({
    name: "VS Code (현재 디렉토리)",
    configPath: resolve(process.cwd(), ".vscode/mcp.json"),
    format: "servers",
  })

  // Windsurf
  clients.push({
    name: "Windsurf",
    configPath: resolve(home, ".codeium/windsurf/mcp_config.json"),
    format: "mcpServers",
  })

  // Gemini CLI
  clients.push({
    name: "Gemini CLI",
    configPath: resolve(home, ".gemini/settings.json"),
    format: "mcpServers",
  })

  // Zed
  const zedPaths: Record<string, string> = {
    darwin: resolve(home, ".zed/settings.json"),
    linux: resolve(home, ".config/zed/settings.json"),
    win32: resolve(home, ".zed/settings.json"),
  }
  const zedPath = zedPaths[os]
  if (zedPath) {
    clients.push({ name: "Zed", configPath: zedPath, format: "context_servers" })
  }

  // Antigravity
  clients.push({
    name: "Antigravity",
    configPath: resolve(home, ".gemini/antigravity/mcp_config.json"),
    format: "mcpServers",
  })

  return clients
}

async function readJsonFile(path: string): Promise<Record<string, unknown>> {
  if (!existsSync(path)) return {}
  const raw = await readFile(path, "utf-8")
  return JSON.parse(raw) as Record<string, unknown>
}

async function writeJsonFile(path: string, data: Record<string, unknown>): Promise<void> {
  const dir = dirname(path)
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }
  await writeFile(path, JSON.stringify(data, null, 2) + "\n", "utf-8")
}

function buildServerEntry(apiKey: string): Record<string, unknown> {
  const env: Record<string, string> = {}
  if (apiKey) {
    env.LAW_OC = apiKey
  }
  return {
    command: "npx",
    args: ["-y", "korean-law-mcp"],
    env,
  }
}

/** Zed는 context_servers 키에 { command: { path, args, env } } 구조 */
function buildZedEntry(apiKey: string): Record<string, unknown> {
  const env: Record<string, string> = {}
  if (apiKey) {
    env.LAW_OC = apiKey
  }
  return {
    command: {
      path: "npx",
      args: ["-y", "korean-law-mcp"],
      env,
    },
  }
}

// ---------------------------------------------------------------------------
// ANSI helpers (no dependencies)
// ---------------------------------------------------------------------------

const ESC = "\x1b["
const c = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  cyan: `${ESC}36m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  red: `${ESC}31m`,
  magenta: `${ESC}35m`,
  blue: `${ESC}34m`,
  white: `${ESC}37m`,
  bgCyan: `${ESC}46m`,
  bgBlue: `${ESC}44m`,
} as const

function rgb(r: number, g: number, b: number): string {
  return `${ESC}38;2;${r};${g};${b}m`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function typewrite(text: string, delay = 15): Promise<void> {
  for (const ch of text) {
    process.stdout.write(ch)
    await sleep(delay)
  }
  console.log()
}

async function printBanner(): Promise<void> {
  // gradient: cyan → blue → magenta
  const gradients = [
    rgb(0, 220, 255), rgb(0, 200, 255), rgb(0, 180, 255),
    rgb(30, 150, 255), rgb(60, 120, 255), rgb(100, 100, 255),
    rgb(140, 80, 255), rgb(180, 60, 255), rgb(200, 50, 240),
  ]

  const logo = [
    "  _  __                            _                  ",
    " | |/ /___  _ __ ___  __ _ _ __   | |    __ ___      __",
    " | ' // _ \\| '__/ _ \\/ _` | '_ \\  | |   / _` \\ \\ /\\ / /",
    " | . \\ (_) | | |  __/ (_| | | | | | |__| (_| |\\ V  V / ",
    " |_|\\_\\___/|_|  \\___|\\__,_|_| |_| |_____\\__,_| \\_/\\_/  ",
  ]

  console.log()
  for (let i = 0; i < logo.length; i++) {
    const color = gradients[i % gradients.length]
    console.log(`${color}${c.bold}${logo[i]}${c.reset}`)
    await sleep(60)
  }
  console.log()

  const tagline = "  MCP Server v3  ━━  법제처 41개 API → 14개 도구"
  await typewrite(`${c.dim}${tagline}${c.reset}`, 12)
  console.log()

  const bar = `${c.cyan}  ${"━".repeat(52)}${c.reset}`
  console.log(bar)
  console.log()
}

function stepHeader(step: number, total: number, title: string): void {
  const dots = `${c.dim}${"·".repeat(40 - title.length)}${c.reset}`
  console.log(`  ${c.cyan}${c.bold}[${step}/${total}]${c.reset} ${c.white}${c.bold}${title}${c.reset} ${dots}`)
  console.log()
}

function successLine(label: string, detail: string): void {
  console.log(`  ${c.green}${c.bold}+${c.reset} ${c.white}${label}${c.reset}${c.dim} ${detail}${c.reset}`)
}

function failLine(label: string, detail: string): void {
  console.log(`  ${c.red}${c.bold}x${c.reset} ${c.white}${label}${c.reset}${c.dim} ${detail}${c.reset}`)
}

async function printComplete(apiKey: string): Promise<void> {
  console.log()
  const box = [
    `  ${c.green}${c.bold}╔${"═".repeat(50)}╗${c.reset}`,
    `  ${c.green}${c.bold}║${c.reset}${" ".repeat(14)}${c.green}${c.bold}Setup Complete!${c.reset}${" ".repeat(22)}${c.green}${c.bold}║${c.reset}`,
    `  ${c.green}${c.bold}╚${"═".repeat(50)}╝${c.reset}`,
  ]
  for (const line of box) {
    console.log(line)
    await sleep(40)
  }
  console.log()
  if (!apiKey) {
    console.log(`  ${c.yellow}!${c.reset} API 키 미설정 — 환경변수 ${c.bold}LAW_OC${c.reset} 또는 설정 파일의 ${c.bold}env.LAW_OC${c.reset} 수정`)
    console.log()
  }
  console.log(`  ${c.dim}클라이언트를 재시작하면 'korean-law' MCP 서버가 활성화됩니다.${c.reset}`)
  console.log()
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runSetup(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout })

  try {
    await printBanner()

    // Step 1: API 키
    stepHeader(1, 3, "법제처 API 키")
    console.log(`  ${c.dim}발급: https://open.law.go.kr/LSO/openApi/guideResult.do${c.reset}`)
    console.log(`  ${c.dim}Enter로 건너뛰기 — 나중에 환경변수로 설정 가능${c.reset}`)
    console.log()
    const apiKey = (await rl.question(`  ${c.cyan}>${c.reset} API 키: `)).trim()
    if (apiKey) {
      console.log(`  ${c.green}+${c.reset} 키 등록됨`)
    } else {
      console.log(`  ${c.yellow}-${c.reset} 건너뜀`)
    }
    console.log()

    // Step 2: 클라이언트 선택
    stepHeader(2, 3, "MCP 클라이언트 선택")
    const clients = detectClients()
    clients.forEach((cl, i) => {
      const exists = existsSync(cl.configPath)
      const badge = exists ? `${c.green} [감지됨]${c.reset}` : ""
      const num = `${c.cyan}${String(i + 1).padStart(2)}${c.reset}`
      console.log(`  ${num}) ${c.white}${cl.name}${c.reset}${badge}`)
    })
    console.log()
    const clientInput = (await rl.question(`  ${c.cyan}>${c.reset} 번호 (예: 1,3): `)).trim()

    if (!clientInput) {
      console.log(`\n  ${c.yellow}선택 없음${c.reset} — 수동 설정 안내:`)
      printManualConfig(apiKey)
      return
    }

    const indices = clientInput
      .split(",")
      .map((s) => parseInt(s.trim(), 10) - 1)
      .filter((i) => i >= 0 && i < clients.length)

    if (indices.length === 0) {
      console.log(`\n  ${c.yellow}유효한 선택 없음${c.reset} — 수동 설정 안내:`)
      printManualConfig(apiKey)
      return
    }

    // Step 3: 설정 파일 업데이트
    console.log()
    stepHeader(3, 3, "설정 파일 업데이트")
    const entry = buildServerEntry(apiKey)

    for (const idx of indices) {
      const client = clients[idx]
      await sleep(150)
      try {
        const config = await readJsonFile(client.configPath)
        const key = client.format
        const serverEntry = key === "context_servers" ? buildZedEntry(apiKey) : entry
        const servers = (config[key] ?? {}) as Record<string, unknown>
        servers["korean-law"] = serverEntry
        config[key] = servers
        await writeJsonFile(client.configPath, config)
        successLine(client.name, client.configPath)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        failLine(client.name, msg)
      }
    }

    await printComplete(apiKey)
  } finally {
    rl.close()
  }
}

function printManualConfig(apiKey: string): void {
  const entry = buildServerEntry(apiKey)
  console.log()
  console.log(`  ${c.dim}아래 JSON을 설정 파일의 mcpServers에 추가하세요:${c.reset}`)
  console.log()
  console.log(`  ${c.cyan}"korean-law"${c.reset}: ${JSON.stringify(entry, null, 4)}`)
  console.log()
}
