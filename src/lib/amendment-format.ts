/**
 * 신구조문대비표 — 행 → 마크다운 표 (밑줄은 <u>…</u>, 칸 안 줄바꿈은 <br>)
 */
import type { Line } from "./amendment-marks.js"
import type { Row } from "./amendment-render.js"

const cellText = (lines: Line[]) =>
  lines.map(line => line.map(s => {
    const t = s.text.replace(/\|/g, "\\|")
    return s.u ? `<u>${t}</u>` : t
  }).join("").replace(/<\/u><u>/g, "")).join("<br>")

export function rowsToMarkdown(title: string, rows: Row[]): string {
  const out = [
    `### ${title}`,
    "",
    "| 현      행 | 개   정   안 |",
    "| --- | --- |",
    ...rows.map(r => `| ${cellText(r.old)} | ${cellText(r.new)} |`),
  ]
  return out.join("\n")
}

/** 줄 단위 평문 — 밑줄 구간을 ‹›로 감싼다(표를 못 그리는 화면·검수용) */
export function lineToPlain(line: Line): string {
  return line.map(s => s.u ? `‹${s.text}›` : s.text).join("").replace(/›‹/g, "")
}
