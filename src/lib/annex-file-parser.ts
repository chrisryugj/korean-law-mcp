/**
 * 별표 파일 파서 (HWPX / HWP / PDF 분기)
 *
 * - HWPX (신형): jszip + xmldom으로 직접 파싱 → Markdown
 * - HWP (구형): hwp.js로 텍스트 추출 → Markdown
 * - PDF: 파싱 불가 → null (LLM이 직접 읽도록 링크 반환)
 *
 * 포팅 원본: lexdiff/lib/hwpx-parser.ts, lexdiff/app/api/hwp-to-html/route.ts
 */

import JSZip from "jszip"
import { DOMParser } from "@xmldom/xmldom"

// ─── 매직바이트 감지 ─────────────────────────────────

function isHwpxFile(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer.slice(0, 4))
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

function isOldHwpFile(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer.slice(0, 4))
  return bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0
}

function isPdfFile(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer.slice(0, 4))
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
}

// ─── 공통 인터페이스 ─────────────────────────────────

export interface AnnexParseResult {
  success: boolean
  markdown?: string
  fileType: "hwpx" | "hwp" | "pdf" | "unknown"
  error?: string
}

// ─── 메인 엔트리 ─────────────────────────────────────

export async function parseAnnexFile(buffer: ArrayBuffer): Promise<AnnexParseResult> {
  if (isHwpxFile(buffer)) {
    return parseHwpx(buffer)
  }
  if (isOldHwpFile(buffer)) {
    return parseHwp(buffer)
  }
  if (isPdfFile(buffer)) {
    return { success: false, fileType: "pdf", error: "PDF 파일은 직접 파싱할 수 없습니다." }
  }
  return { success: false, fileType: "unknown", error: "지원하지 않는 파일 형식입니다." }
}

// ─── HWPX 파서 (lexdiff/lib/hwpx-parser.ts 포팅) ────

async function parseHwpx(buffer: ArrayBuffer): Promise<AnnexParseResult> {
  try {
    const zip = await JSZip.loadAsync(buffer)

    const sectionFile = zip.file("Contents/section0.xml") || zip.file("Contents/Section0.xml")
    if (!sectionFile) {
      return { success: false, fileType: "hwpx", error: "section0.xml을 찾을 수 없습니다" }
    }

    const xml = await sectionFile.async("text")
    const parser = new DOMParser()
    const doc = parser.parseFromString(xml, "text/xml")

    if (doc.documentElement?.tagName === "parsererror") {
      return { success: false, fileType: "hwpx", error: `XML 파싱 에러: ${doc.documentElement.textContent}` }
    }

    const { lines } = parseDocumentStructure(doc)
    const markdown = formatToMarkdown(lines)

    return { success: true, fileType: "hwpx", markdown }
  } catch (err) {
    return { success: false, fileType: "hwpx", error: err instanceof Error ? err.message : "HWPX 파싱 실패" }
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 문서 구조 파싱 - 표와 일반 단락 구분 */
function parseDocumentStructure(doc: any): { lines: string[] } {
  const lines: string[] = []
  const processedTexts = new Set<string>()

  const tablesInDoc = doc.getElementsByTagName("hp:tbl")
  const hasTable = tablesInDoc.length > 0

  const paragraphsInTables = new Set<any>()
  const tableTextsNormalized = new Set<string>()
  let allTableTextCombined = ""

  for (let t = 0; t < tablesInDoc.length; t++) {
    const tbl = tablesInDoc[t]
    const parasInTbl = tbl.getElementsByTagName("hp:p")
    for (let p = 0; p < parasInTbl.length; p++) {
      paragraphsInTables.add(parasInTbl[p])
      const text = extractParagraphText(parasInTbl[p])
      if (text) {
        tableTextsNormalized.add(text.replace(/\s/g, ""))
        allTableTextCombined += text.replace(/\s/g, "")
      }
    }
    const cellsInTbl = tbl.getElementsByTagName("hp:tc")
    for (let c = 0; c < cellsInTbl.length; c++) {
      const cellText = extractCellText(cellsInTbl[c])
      if (cellText) {
        const normalized = cellText.replace(/\s/g, "").replace(/<br>/g, "")
        tableTextsNormalized.add(normalized)
        allTableTextCombined += normalized
      }
    }
  }

  function walkNodes(parent: any) {
    const children = parent.childNodes
    for (let i = 0; i < children.length; i++) {
      const node = children[i]
      if (node.nodeType !== 1) continue
      const el = node as any

      if (el.tagName === "hp:tbl") {
        const tableMarkdown = parseTable(el)
        if (tableMarkdown) lines.push(tableMarkdown)
      } else if (el.tagName === "hp:p" && !paragraphsInTables.has(el)) {
        const text = extractParagraphText(el)
        if (text) {
          const normalized = text.replace(/\s/g, "")
          if (hasTable) {
            if (tableTextsNormalized.has(normalized) || allTableTextCombined.includes(normalized)) {
              walkNodes(el)
              continue
            }
          }
          if (!processedTexts.has(normalized)) {
            processedTexts.add(normalized)
            lines.push(text)
          }
        }
        walkNodes(el)
      } else {
        walkNodes(el)
      }
    }
  }

  walkNodes(doc.documentElement)
  return { lines }
}

function extractParagraphText(para: any): string {
  const textNodes = para.getElementsByTagName("hp:t")
  let text = ""
  for (let i = 0; i < textNodes.length; i++) {
    text += textNodes[i].textContent || ""
  }
  return text.replace(/\s+/g, " ").trim()
}

function extractCellText(cell: any): string {
  const paragraphs = cell.getElementsByTagName("hp:p")
  const texts: string[] = []
  for (let p = 0; p < paragraphs.length; p++) {
    const text = extractParagraphText(paragraphs[p])
    if (text) texts.push(text)
  }
  return texts.join("<br>")
}

function parseTable(tbl: any): string {
  const rows = tbl.getElementsByTagName("hp:tr")
  if (rows.length === 0) return ""

  const tableData: string[][] = []
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r].getElementsByTagName("hp:tc")
    const rowData: string[] = []
    for (let c = 0; c < cells.length; c++) {
      rowData.push(extractCellText(cells[c]))
    }
    if (rowData.length > 0) tableData.push(rowData)
  }
  if (tableData.length === 0) return ""

  return createMarkdownTable(tableData)
}

function createMarkdownTable(data: string[][]): string {
  if (data.length === 0) return ""

  const maxCols = Math.max(...data.map(row => row.length))

  // 첫 번째 열 병합 셀 처리
  const processedData = data.map((row, rowIndex) => {
    const newRow = [...row]
    if (rowIndex > 0) {
      const prevRow = data[rowIndex - 1]
      if (prevRow && prevRow[0] && newRow[0] === prevRow[0] && newRow[0].trim()) {
        newRow[0] = ""
      }
    }
    return newRow
  })

  // 열 수 정규화
  const normalizedData = processedData.map((row, rowIndex) => {
    if (rowIndex === 0) {
      const newRow = [...row]
      while (newRow.length < maxCols) newRow.push("")
      return newRow
    }
    const deficit = maxCols - row.length
    if (deficit > 0) return [...new Array(deficit).fill(""), ...row]
    return [...row]
  })

  // 중복 행 제거
  const uniqueData: string[][] = []
  const seenRows = new Set<string>()
  for (const row of normalizedData) {
    const rowKey = row.join("||")
    if (!seenRows.has(rowKey)) {
      seenRows.add(rowKey)
      uniqueData.push(row)
    }
  }
  if (uniqueData.length === 0) return ""

  // 1행 1열 표는 구조화된 텍스트로 변환
  if (uniqueData.length === 1 && maxCols === 1) {
    const cellContent = uniqueData[0][0]
    const parts: string[] = []
    cellContent.split(/<br>/i).forEach(line => {
      const trimmed = line.trim()
      if (!trimmed) return
      if (/^\d+\.\s/.test(trimmed)) {
        parts.push(`**${trimmed}**`)
      } else if (/^[가-힣]\.\s/.test(trimmed)) {
        parts.push(`  ${trimmed}`)
      } else {
        parts.push(trimmed)
      }
    })
    return parts.join("\n")
  }

  // Markdown 테이블 생성
  const mdLines: string[] = []
  mdLines.push("| " + uniqueData[0].join(" | ") + " |")
  mdLines.push("| " + uniqueData[0].map(() => "---").join(" | ") + " |")
  for (let i = 1; i < uniqueData.length; i++) {
    mdLines.push("| " + uniqueData[i].join(" | ") + " |")
  }
  return mdLines.join("\n")
}

function formatToMarkdown(lines: string[]): string {
  const result: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const block = lines[i]

    if (block.includes("\n")) {
      result.push(block)
      continue
    }

    // [별표 N] 패턴 → ## 제목
    if (/^\[별표\s*\d+/.test(block)) {
      const nextLine = lines[i + 1]
      if (nextLine && (/관련\)?$/.test(nextLine) || /^[가-힣\s]+\([^)]+관련\)$/.test(nextLine))) {
        result.push("")
        result.push(`## ${block} ${nextLine}`)
        result.push("")
        i++
      } else {
        result.push("")
        result.push(`## ${block}`)
        result.push("")
      }
      continue
    }

    if (/^\([^)]*조[^)]*관련\)$/.test(block)) {
      result.push(`*${block}*`)
      result.push("")
      continue
    }

    result.push(block)
  }

  return result.join("\n").trim()
}

// ─── 구형 HWP 파서 (hwp.js 사용) ────────────────────

async function parseHwp(buffer: ArrayBuffer): Promise<AnnexParseResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const hwpjs = require("hwp.js")
    const parse = hwpjs.parse
    const nodeBuffer = Buffer.from(buffer)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hwpDoc: any = parse(nodeBuffer, { type: "buffer" })

    if (!hwpDoc.sections || hwpDoc.sections.length === 0) {
      return { success: false, fileType: "hwp", error: "HWP 문서에 내용이 없습니다" }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function extractTextFromContent(content: any[]): string {
      let text = ""
      for (const item of content) {
        if (item.value !== undefined && typeof item.value === "string") {
          text += item.value
        }
        if (item.content && Array.isArray(item.content)) {
          text += extractTextFromContent(item.content)
        }
      }
      return text
    }

    const parts: string[] = []
    for (const section of hwpDoc.sections) {
      const paragraphs = section.content || []
      for (const paragraph of paragraphs) {
        const content = paragraph.content || []
        const text = extractTextFromContent(content).trim()
        if (text) parts.push(text)
      }
    }

    if (parts.length === 0) {
      return { success: false, fileType: "hwp", error: "HWP 텍스트 추출 실패 (표 형식 문서일 수 있음)" }
    }

    return { success: true, fileType: "hwp", markdown: parts.join("\n\n") }
  } catch (err) {
    return { success: false, fileType: "hwp", error: err instanceof Error ? err.message : "HWP 파싱 실패" }
  }
}
