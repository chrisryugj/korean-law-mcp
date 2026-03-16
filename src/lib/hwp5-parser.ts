/** HWP 5.x 바이너리 파서 - OLE2 → 섹션 → Markdown (참고: github.com/roboco-io/hwp2md) */

import { createRequire } from "module"
import {
  readRecords, decompressStream, parseFileHeader, extractText,
  TAG_PARA_HEADER, TAG_PARA_TEXT, TAG_CTRL_HEADER, TAG_LIST_HEADER, TAG_TABLE,
  FLAG_COMPRESSED, FLAG_ENCRYPTED, FLAG_DRM,
  type HwpRecord,
} from "./hwp5-record.js"
import { buildTable, blocksToMarkdown } from "./hwpx-table.js"
import type { CellContext, IRBlock } from "./hwpx-table.js"

const esmRequire = createRequire(import.meta.url)

export function parseHwp5Document(buffer: Buffer): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CFB = esmRequire("cfb") as any
  const cfb = CFB.parse(buffer)

  const headerEntry = CFB.find(cfb, "/FileHeader")
  if (!headerEntry?.content) throw new Error("FileHeader 스트림 없음")
  const header = parseFileHeader(Buffer.from(headerEntry.content))
  if (header.signature !== "HWP Document File") throw new Error("HWP 시그니처 불일치")
  if (header.flags & FLAG_ENCRYPTED) throw new Error("암호화된 HWP는 지원하지 않습니다")
  if (header.flags & FLAG_DRM) throw new Error("DRM 보호된 HWP는 지원하지 않습니다")
  const compressed = (header.flags & FLAG_COMPRESSED) !== 0

  const sections = findSections(cfb, CFB)
  if (sections.length === 0) throw new Error("섹션 스트림을 찾을 수 없습니다")

  const blocks: IRBlock[] = []
  for (const sectionData of sections) {
    const data = compressed ? decompressStream(Buffer.from(sectionData)) : Buffer.from(sectionData)
    const records = readRecords(data)
    blocks.push(...parseSection(records))
  }

  return blocksToMarkdown(blocks)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findSections(cfb: any, CFB: any): Buffer[] {
  const sections: Array<{ idx: number; content: Buffer }> = []

  for (let i = 0; ; i++) {
    const entry = CFB.find(cfb, `/BodyText/Section${i}`)
    if (!entry?.content) break
    sections.push({ idx: i, content: Buffer.from(entry.content) })
  }

  // fallback: root-level Section 검색
  if (sections.length === 0 && cfb.FileIndex) {
    for (const entry of cfb.FileIndex) {
      if (entry.name?.startsWith("Section") && entry.content) {
        const idx = parseInt(entry.name.replace("Section", ""), 10) || 0
        sections.push({ idx, content: Buffer.from(entry.content) })
      }
    }
  }

  return sections.sort((a, b) => a.idx - b.idx).map(s => s.content)
}

function parseSection(records: HwpRecord[]): IRBlock[] {
  const blocks: IRBlock[] = []
  let i = 0

  while (i < records.length) {
    const rec = records[i]

    if (rec.tagId === TAG_PARA_HEADER && rec.level === 0) {
      const { paragraph, tables, nextIdx } = parseParagraphWithTables(records, i)
      if (paragraph) blocks.push({ type: "paragraph", text: paragraph })
      for (const t of tables) blocks.push({ type: "table", table: t })
      i = nextIdx
      continue
    }

    if (rec.tagId === TAG_CTRL_HEADER && rec.level <= 1 && rec.data.length >= 4) {
      const ctrlId = rec.data.subarray(0, 4).toString("ascii")
      if (ctrlId === " lbt" || ctrlId === "tbl ") {
        const { table, nextIdx } = parseTableBlock(records, i)
        if (table) blocks.push({ type: "table", table })
        i = nextIdx
        continue
      }
    }

    i++
  }

  return blocks
}

function parseParagraphWithTables(records: HwpRecord[], startIdx: number) {
  const startLevel = records[startIdx].level
  let text = ""
  const tables: ReturnType<typeof buildTable>[] = []
  let i = startIdx + 1

  while (i < records.length) {
    const rec = records[i]
    if (rec.tagId === TAG_PARA_HEADER && rec.level <= startLevel) break

    if (rec.tagId === TAG_PARA_TEXT) {
      text = extractText(rec.data)
    }

    if (rec.tagId === TAG_CTRL_HEADER && rec.data.length >= 4) {
      const ctrlId = rec.data.subarray(0, 4).toString("ascii")
      if (ctrlId === " lbt" || ctrlId === "tbl ") {
        const { table, nextIdx } = parseTableBlock(records, i)
        if (table) tables.push(table)
        i = nextIdx
        continue
      }
    }
    i++
  }

  const trimmed = text.trim()
  return { paragraph: trimmed || null, tables, nextIdx: i }
}

function parseTableBlock(records: HwpRecord[], startIdx: number) {
  const tableLevel = records[startIdx].level
  let i = startIdx + 1
  let rows = 0, cols = 0
  const cells: CellContext[] = []

  while (i < records.length) {
    const rec = records[i]
    if (rec.tagId === TAG_PARA_HEADER && rec.level <= tableLevel) break
    if (rec.tagId === TAG_CTRL_HEADER && rec.level <= tableLevel) break

    if (rec.tagId === TAG_TABLE && rec.data.length >= 8) {
      rows = rec.data.readUInt16LE(4)
      cols = rec.data.readUInt16LE(6)
    }

    if (rec.tagId === TAG_LIST_HEADER) {
      const { cell, nextIdx } = parseCellBlock(records, i, tableLevel)
      if (cell) cells.push(cell)
      i = nextIdx
      continue
    }
    i++
  }

  if (rows === 0 || cols === 0 || cells.length === 0) return { table: null, nextIdx: i }

  // 셀을 2D 행 배열로 배치
  const cellRows = arrangeCells(rows, cols, cells)
  return { table: buildTable(cellRows), nextIdx: i }
}

function parseCellBlock(records: HwpRecord[], startIdx: number, tableLevel: number) {
  const cellLevel = records[startIdx].level
  const texts: string[] = []
  let i = startIdx + 1

  while (i < records.length) {
    const rec = records[i]
    if (rec.tagId === TAG_LIST_HEADER && rec.level <= cellLevel) break
    if (rec.level <= tableLevel && (rec.tagId === TAG_PARA_HEADER || rec.tagId === TAG_CTRL_HEADER)) break

    if (rec.tagId === TAG_PARA_TEXT) {
      const t = extractText(rec.data).trim()
      if (t) texts.push(t)
    }
    i++
  }

  return { cell: { text: texts.join("\n"), colSpan: 1, rowSpan: 1 } as CellContext, nextIdx: i }
}

function arrangeCells(rows: number, cols: number, cells: CellContext[]): CellContext[][] {
  const grid: (CellContext | null)[][] = Array.from({ length: rows }, () => Array(cols).fill(null))
  let cellIdx = 0

  for (let r = 0; r < rows && cellIdx < cells.length; r++) {
    for (let c = 0; c < cols && cellIdx < cells.length; c++) {
      if (grid[r][c] !== null) continue
      const cell = cells[cellIdx++]
      grid[r][c] = cell

      for (let dr = 0; dr < cell.rowSpan; dr++) {
        for (let dc = 0; dc < cell.colSpan; dc++) {
          if (dr === 0 && dc === 0) continue
          if (r + dr < rows && c + dc < cols)
            grid[r + dr][c + dc] = { text: "", colSpan: 1, rowSpan: 1 }
        }
      }
    }
  }

  return grid.map(row => row.map(c => c || { text: "", colSpan: 1, rowSpan: 1 }))
}
