import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, relative } from "node:path"
import { allTools } from "./tool-registry.js"
import { V3_EXPOSED } from "./lib/tool-profiles.js"

/**
 * 출력 안내 게이트: 도구 출력이 "다음엔 X(...)를 부르라"고 할 때 X 는 ListTools 에 있어야 한다.
 *
 * 노출 도구는 V3_EXPOSED 10개뿐이라, 나머지 이름을 그대로 적으면 클라이언트가 그 호출을
 * 막는다. 강한 모델은 execute_tool 로 우회하지만 도구 호출이 약한 로컬 모델은 거기서 멈춘다.
 * 숨은 도구는 execute_tool(tool_name="X", params={…}) 로, 노출 도구로 대체되면 그쪽으로 적는다.
 *
 * 판정: 소스 문자열 안의 `숨은도구명(` (괄호 바로 붙음). `→ impact_map (설명)` 처럼 띄운 서술은 대상 아님.
 */
const SRC = dirname(fileURLToPath(import.meta.url))
const hidden = new Set(allTools.map(t => t.name).filter(n => !V3_EXPOSED.has(n)))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return sourceFiles(p)
    return p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : []
  })
}

describe("출력 안내는 노출 도구 경로로 적는다", () => {
  it("숨은 도구를 직접 호출하라는 문자열이 없다", () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (!/[`"']/.test(line) || /^\s*(\/\/|\*)/.test(line)) return
        for (const m of line.matchAll(/\b([a-z]+(?:_[a-z]+)+)\(/g)) {
          if (!hidden.has(m[1])) continue
          if (/tool_name\s*[=:]\s*["']?$/.test(line.slice(0, m.index))) continue
          offenders.push(`${relative(SRC, file)}:${i + 1} ${m[1]}(`)
        }
      })
    }
    expect(offenders).toEqual([])
  })
})
