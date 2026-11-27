/**
 * 의무 조문 → 벌칙 조문·부과기준 별표 행 (get_penalties 의 순수 함수).
 *
 * 벌칙 조문은 "제14조, 제39조, …, 제48조, … 를 위반한 자"처럼 의무 조문을 나열하고, 금액은 시행령 별표가
 * "사. 법 제48조제2항에 따른 임금명세서 교부의무를 위반한 경우" 행과 그 아래 하위 행에 적는다.
 */
import { cleanHtml } from "./article-parser.js"

/** "48" · "제48조" · "48의2" · "제48조의2" · "004802" → "48" / "48의2". 못 읽으면 undefined */
export function parseArticleNo(raw: string | undefined): string | undefined {
  const s = String(raw ?? "").replace(/\s+/g, "")
  if (/^\d{6}$/.test(s)) {
    const no = String(Number(s.slice(0, 4))), br = Number(s.slice(4))
    return br ? `${no}의${br}` : no
  }
  const m = s.match(/^제?(\d+)조?(?:의(\d+))?$/)
  return m ? (m[2] ? `${Number(m[1])}의${Number(m[2])}` : String(Number(m[1]))) : undefined
}

const REF_RE = /제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/g
// 범위 사이 괄호도 받는다: 「제32조(제6호는 제외한다)부터 제34조까지」(도로교통법 시행령 별표 6)
const RANGE_RE = /제\s*(\d+)\s*조(?:\s*의\s*\d+)?(?:\s*\([^)]{0,40}\))?\s*부터\s*제\s*(\d+)\s*조(?:\s*의\s*\d+)?\s*까지/g

/**
 * 글에 나온 이 법의 조 번호("48", "44의2"). 「다른 법」 제N조는 뺀다(「민법」 제767조).
 * "제78조부터 제80조까지"는 78·79·80 을 모두 넣는다
 */
export function articleRefs(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.matchAll(REF_RE)) {
    if (/」\s*$/.test(text.slice(Math.max(0, m.index! - 3), m.index))) continue
    out.add(m[2] ? `${Number(m[1])}의${Number(m[2])}` : String(Number(m[1])))
  }
  for (const m of text.matchAll(RANGE_RE)) {
    const a = Number(m[1]), b = Number(m[2])
    if (b > a && b - a <= 200) for (let n = a; n <= b; n++) out.add(String(n))
  }
  return out
}

const HANG_RE = /^[①-⑳㉑-㉟]/
const HO_RE = /^\d+\.\s/

/**
 * 벌칙 조문 본문에서 duty 를 지목한 항·호만 남긴다. 호가 맞으면 그 항 머리(항이 없는 조는 첫 문장)도 함께 싣는다.
 * 맞는 줄이 없으면 undefined
 */
export function filterPenaltyBody(body: string, duty: string): string | undefined {
  const lines = body.split("\n").map(l => l.trimEnd()).filter(l => l.trim())
  const keep = new Set<number>()
  let head = -1
  lines.forEach((l, i) => {
    const t = l.trim()
    if (HANG_RE.test(t) || (!HO_RE.test(t) && head === -1)) head = i
    if (!articleRefs(t).has(duty)) return
    keep.add(i)
    if (HO_RE.test(t) && head >= 0) keep.add(head)
  })
  if (keep.size === 0) return undefined
  return [...keep].sort((a, b) => a - b).map(i => lines[i]).join("\n")
}

/** 벌칙 본문의 "…를 위반한" 줄에서 의무 조문 → 위치("제116조제2항제2호") */
export function dutyIndex(articleLabel: string, body: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  let hang = ""
  for (const raw of body.split("\n")) {
    const t = raw.trim()
    if (!t) continue
    const hm = t.match(HANG_RE)
    if (hm) hang = `제${"①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳".indexOf(hm[0]) + 1}항`
    if (!/위반/.test(t)) continue
    const ho = t.match(/^(\d+)\.\s/)
    const where = `${articleLabel}${hang}${ho ? `제${ho[1]}호` : ""}`
    for (const r of articleRefs(t)) out.set(r, [...(out.get(r) ?? []), where])
  }
  return out
}

const cellText = (html: string) => cleanHtml(html.replace(/<br\s*\/?>/gi, " / ")).replace(/\s+/g, " ").trim()

/** 표 머리 행들(th)을 한 줄 열 이름으로: colspan 은 아래 행 이름과 이어 붙인다("과태료 금액(단위: 만원) 1차 위반") */
function headerNames(rows: string[]): string[] {
  const grid: string[][] = []
  rows.forEach((row, r) => {
    grid[r] ??= []
    let c = 0
    for (const m of row.matchAll(/<t[hd]([^>]*)>([\s\S]*?)<\/t[hd]>/gi)) {
      while (grid[r][c] !== undefined) c++
      const cs = Number(m[1].match(/colspan="?(\d+)/)?.[1] ?? 1), rs = Number(m[1].match(/rowspan="?(\d+)/)?.[1] ?? 1)
      for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) {
        grid[r + dr] ??= []
        grid[r + dr][c + dc] = dr === 0 ? cellText(m[2]).replace(/ \/ /g, " ") : ""
      }
      c += cs
    }
  })
  const width = Math.max(...grid.map(g => g.length))
  return Array.from({ length: width }, (_, c) => grid.map(g => g[c] ?? "").filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(" "))
}

const NUM_HEAD_RE = /^\d+(?:의\d+)?\.\s/
const HANGUL_HEAD_RE = /^[가-힣](?:의\d+)?\.\s/

interface ParsedTable { names: string[]; rows: string[][] }

/** HTML 표: 머리 행은 첫 th 행과 그 행의 가장 큰 rowspan 만큼 아래 행(근로기준법 시행령 별표 7 은 둘째 머리 행이 td 다) */
function htmlTables(text: string): ParsedTable[] {
  return [...text.matchAll(/<table[\s\S]*?<\/table>/gi)].map(m => {
    const rows = [...m[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(r => r[0])
    const headRows: string[] = []
    if (rows.length && /<th/i.test(rows[0])) {
      const span = Math.max(1, ...[...rows[0].matchAll(/rowspan="?(\d+)/gi)].map(x => Number(x[1])))
      headRows.push(...rows.splice(0, span))
    }
    return {
      names: headRows.length ? headerNames(headRows) : [],
      rows: rows.map(row => [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(c => cellText(c[1]))),
    }
  })
}

/** GFM 표(병합 칸 없는 별표): "|" 로 시작하는 줄 묶음. 첫 줄이 머리, 둘째 줄이 구분선 */
function pipeTables(text: string): ParsedTable[] {
  const out: ParsedTable[] = []
  const lines = text.split("\n")
  const split = (l: string) => l.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map(c => cellText(c))
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith("|") || !/^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? "")) continue
    const names = split(lines[i])
    const rows: string[][] = []
    let j = i + 2
    for (; j < lines.length && lines[j].trim().startsWith("|"); j++) rows.push(split(lines[j]))
    out.push({ names, rows })
    i = j
  }
  return out
}

/**
 * 부과기준 별표 본문(HTML 표 또는 GFM 표)에서 duty 가 나오는 행 묶음을 표 머리와 함께 마크다운 표로.
 * 묶음 머리는 표의 맨 위 단계 번호다: 첫 데이터 행이 "1."·"3의2." 꼴이면 숫자, "가." 꼴이면 가나다.
 * 그보다 아래 단계("가."·"1)")와 첫 칸이 빈 행은 앞 묶음에 딸린다(도로교통법 시행령 별표 7 "3. 법 제32조부터…" 아래 "가. 어린이보호구역…")
 */
export function annexRowsFor(annexText: string, duty: string): string | undefined {
  const out: string[] = []
  for (const { names, rows } of [...htmlTables(annexText), ...pipeTables(annexText)]) {
    const groups: string[][][] = []
    let head: RegExp | undefined
    for (const cells of rows) {
      head ??= NUM_HEAD_RE.test(cells[0] ?? "") ? NUM_HEAD_RE : HANGUL_HEAD_RE
      if (!groups.length || head.test(cells[0] ?? "")) groups.push([])
      groups[groups.length - 1].push(cells)
    }
    const hit = groups.filter(g => g.some(cells => cells.some(c => articleRefs(c).has(duty))))
    if (!hit.length) continue
    if (names.length) out.push(`| ${names.join(" | ")} |`, `|${names.map(() => " --- ").join("|")}|`)
    for (const g of hit) for (const cells of g) out.push(`| ${cells.join(" | ")} |`)
  }
  return out.length ? out.join("\n") : undefined
}
