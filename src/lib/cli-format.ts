/**
 * CLI 출력 포맷팅 유틸리티
 * 색상, 배너, 도구 목록, 스키마 추출 등
 */

import { z } from "zod"
import { allTools } from "../tool-registry.js"
import type { McpTool } from "./types.js"
import { VERSION } from "../version.js"

// ────────────────────────────────────────
// ANSI Color Formatting
// ────────────────────────────────────────

export const isColorSupported = process.stdout.isTTY && !process.env.NO_COLOR

/**
 * ANSI 포맷 유틸.
 * 중첩 시 내부 \x1b[0m이 외부까지 리셋하는 문제 방지:
 * 단일 래퍼만 사용하거나, 복합 스타일은 전용 함수로 처리.
 */
export const fmt = {
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

// ────────────────────────────────────────
// Output Formatting
// ────────────────────────────────────────

export function printBanner() {
  console.log()
  console.log(fmt.bold("  Korean Law CLI v" + VERSION))
  console.log(fmt.dim(`  법제처 API 기반 · ${allTools.length}개 도구 · 자연어 지원`))
  console.log()
}

export function printRouteInfo(tool: string, reason: string) {
  console.log(fmt.dim(`  [라우팅] ${tool} — ${reason}`))
  console.log()
}

export function formatOutput(text: string): string {
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
// Interactive Help & Tool List
// ────────────────────────────────────────

export function printInteractiveHelp() {
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

export function getCategory(tool: McpTool): string {
  const match = tool.description.match(/^\[(.+?)\]/)
  return match ? match[1] : "기타"
}

export function printToolList(tools: McpTool[] = allTools) {
  const grouped = new Map<string, McpTool[]>()
  for (const tool of tools) {
    const cat = getCategory(tool)
    if (!grouped.has(cat)) grouped.set(cat, [])
    grouped.get(cat)!.push(tool)
  }

  console.log(`\n${fmt.bold(`  ${tools.length}개 도구`)}\n`)
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
// Schema Extraction (for subcommands)
// ────────────────────────────────────────

export interface CliOption {
  name: string
  description: string
  required: boolean
  type: string
  defaultValue?: unknown
}

export function extractOptionsFromSchema(schema: z.ZodSchema): CliOption[] {
  let jsonSchema: Record<string, unknown>
  try {
    jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>
  } catch {
    return []
  }

  const schemaObj = jsonSchema as { type?: string; properties?: Record<string, Record<string, unknown>>; required?: string[] }
  if (schemaObj?.type !== "object" || !schemaObj.properties) {
    return []
  }

  const requiredFields = new Set<string>(schemaObj.required || [])
  const options: CliOption[] = []

  for (const [key, prop] of Object.entries(schemaObj.properties)) {
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
      description: (prop.description as string) || "",
      required: hasDefault ? false : requiredFields.has(key),
      type,
      defaultValue: prop.default
    })
  }

  return options
}

export function coerceValue(value: string | boolean, type: string): unknown {
  if (typeof value === "boolean") return value
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
