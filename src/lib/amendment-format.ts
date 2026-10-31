/**
 * 신구조문대비표 — 행 → 마크다운 표
 *
 * 밑줄은 굵은 글씨(**…**)로 적는다. claude.ai 등 채팅 화면은 <u> 를 그리지 않아서, <u> 로 주면
 * Claude 가 표를 굵은 글씨로 다시 쓰다가 줄표를 틀렸다(4.15.16 시연). HWPX 는 진짜 밑줄 그대로다.
 * 칸 안 줄바꿈은 <br>.
 */
import type { Line } from "./amendment-marks.js"
import type { Row } from "./amendment-render.js"

const PUNCT = /[\p{P}\p{S}]/u
const SPACE = /\s/

/**
 * 굵게 감쌀 구간 [a, b) 을 CommonMark 강조 규칙에 맞게 다듬는다. "제65조**(승무정원)**"처럼 글자와 문장부호가
 * 맞붙은 경계에선 ** 가 강조로 안 읽혀 글자째 남는다 — 경계의 문장부호를 굵은 범위 밖으로 뺀다.
 */
function fitBold(line: string, a: number, b: number): [number, number] {
  const opens = (i: number) => !PUNCT.test(line[i]) || i === 0 || SPACE.test(line[i - 1]) || PUNCT.test(line[i - 1])
  const closes = (j: number) => !PUNCT.test(line[j - 1]) || j === line.length || SPACE.test(line[j]) || PUNCT.test(line[j])
  while (a < b && !opens(a)) a++
  while (b > a && !closes(b)) b--
  // 여는 괄호가 밖으로 나갔으면 짝 닫는 괄호도 밖으로: "(**승무정원)**" → "(**승무정원**)"
  const pair: Record<string, string> = { ")": "(", "]": "[", "」": "「", "”": "“" }
  const inside = (ch: string) => [...line.slice(a, b)].filter(c => c === ch).length
  while (b > a && pair[line[b - 1]] && inside(pair[line[b - 1]]) < inside(line[b - 1])) b--
  return [a, b]
}

function lineToMarkdown(line: Line): string {
  const text = line.map(s => s.text).join("")
  const spans: Array<[number, number]> = []
  let at = 0
  for (const s of line) {
    const end = at + s.text.length
    if (s.u && s.text.trim()) {
      const prev = spans[spans.length - 1]
      if (prev && prev[1] === at) prev[1] = end
      else spans.push([at, end])
    }
    at = end
  }
  const esc = (t: string) => t.replace(/([|*\\])/g, "\\$1")
  let out = "", pos = 0
  for (const [a0, b0] of spans) {
    const [a, b] = fitBold(text, a0, b0)
    if (a >= b) continue
    out += esc(text.slice(pos, a)) + "**" + esc(text.slice(a, b)) + "**"
    pos = b
  }
  return out + esc(text.slice(pos))
}

export function rowsToMarkdown(title: string, rows: Row[]): string {
  const cell = (lines: Line[]) => lines.map(lineToMarkdown).join("<br>")
  return [
    `### ${title}`,
    "",
    "| 현      행 | 개   정   안 |",
    "| --- | --- |",
    ...rows.map(r => `| ${cell(r.old)} | ${cell(r.new)} |`),
  ].join("\n")
}

/** 줄 단위 평문 — 밑줄 구간을 ‹›로 감싼다(표를 못 그리는 화면·검수용) */
export function lineToPlain(line: Line): string {
  return line.map(s => s.u ? `‹${s.text}›` : s.text).join("").replace(/›‹/g, "")
}
