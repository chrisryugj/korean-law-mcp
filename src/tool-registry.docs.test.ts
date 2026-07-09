import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { TOOL_COUNTS } from "./tool-registry.js"

/**
 * 문서-코드 동기화 게이트 (korea-public-data-mcp의 verify-docs 아이디어 차용).
 * tool-registry.ts의 TOOL_COUNTS를 유일 진실원(SoT)으로, 문서에 하드코딩된
 * "N개 (통합) 도구" 숫자가 실제 노출/전체 도구 수와 어긋나면 실패시킨다.
 *
 * "N개 API" · "N개 시나리오" · "N개 파일" 등은 매칭되지 않으므로 오탐 없음.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
// README.md는 제외 — 버전 히스토리(changelog)에 과거 버전의 도구 수(v3=14개 등)를
// 정당하게 서술하므로 "현재값" 자동 게이트 대상이 아니다.
const DOC_FILES = [
  "CLAUDE.md",
  "docs/API.md",
  "docs/DEVELOPMENT.md",
  "docs/ARCHITECTURE.md",
]
const TOOL_NUM = /(\d+)\s*개\s*(?:통합\s*)?도구/g

describe("문서-코드 도구 수 정합성", () => {
  const allowed = new Set([TOOL_COUNTS.exposed, TOOL_COUNTS.total])

  it.each(DOC_FILES)("%s 의 '도구 수' 표기가 코드와 일치", (rel) => {
    const text = readFileSync(join(ROOT, rel), "utf8")
    const drift: string[] = []
    for (const m of text.matchAll(TOOL_NUM)) {
      const n = Number(m[1])
      if (!allowed.has(n)) drift.push(`"${m[0].trim()}" (${n})`)
    }
    expect(
      drift,
      `${rel}: 코드 기준 노출 ${TOOL_COUNTS.exposed} / 전체 ${TOOL_COUNTS.total}개인데 문서엔 ${drift.join(", ")}`,
    ).toEqual([])
  })
})
