/**
 * 신구조문대비표 — 표기 원자: 줄표(----) 치환, 번호 묶기
 *
 * 표기는 법제처 신구법비교 원문 실측을 따른다: "(생  략)"·"(현행과 같음)", 두 개는 "①·②"
 * (U+00B7), 셋 이상은 "① ∼ ⑪"(U+223C), 개정안의 같은 부분은 글자 수만큼 "-"(법제업무편람 예시).
 */
import type { Seg } from "./amendment-diff.js"
import { splitEdges } from "./amendment-units.js"

export type Line = Seg[]

export const OMIT_OLD = "(생  략)"
export const OMIT_NEW = "(현행과 같음)"
export const MARK_NEW = "<신  설>"
export const MARK_DEL = "<삭  제>"

export const plain = (text: string): Seg => ({ text, u: false })
export const under = (text: string): Seg => ({ text, u: true })

/** 개정안 칸의 같은 부분 → 줄표. 문장 끝 마침표와 양 끝 공백(밑줄과의 경계)은 남긴다 */
export function dashify(text: string): string {
  const [lead, core, tail] = splitEdges(text)
  let out = ""
  for (let k = 0; k < core.length; k++) {
    const sentenceEnd = core[k] === "." && (k === core.length - 1 || /\s/.test(core[k + 1])) && /[가-힣)」\]”]/.test(core[k - 1] ?? "")
    if (sentenceEnd) out += "."
    else out += out.endsWith(".") && /\s/.test(core[k]) ? " " : "-"
  }
  return lead + out + tail
}

/** 개정안 칸 세그먼트 — 밑줄 아닌 부분을 줄표로 */
export function dashSegs(segs: Seg[]): Seg[] {
  return segs.map(s => s.u ? s : plain(dashify(s.text)))
}

export function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? ""
  if (labels.length === 2) return `${labels[0]}·${labels[1]}`
  return `${labels[0]} ∼ ${labels[labels.length - 1]}`
}
