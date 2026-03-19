/**
 * PDF 텍스트 추출 (pdfjs-dist 기반 서버사이드 파싱)
 *
 * 법제처 별표 PDF에서 텍스트를 추출하여 마크다운으로 변환.
 * 이미지 기반 PDF(스캔 문서)는 텍스트 추출이 불가하므로 감지 후 안내.
 */

import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs"
import { createRequire } from "module"
import { pathToFileURL } from "url"

// Node.js 환경: worker를 file:// URL로 설정
const require = createRequire(import.meta.url)
GlobalWorkerOptions.workerSrc = pathToFileURL(
  require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs")
).href

interface PdfParseResult {
  success: boolean
  markdown?: string
  pageCount: number
  /** 추출된 텍스트가 너무 짧으면 이미지 기반 PDF 가능성 */
  isImageBased?: boolean
  error?: string
}

/**
 * PDF ArrayBuffer에서 텍스트 추출 → 마크다운 변환
 */
export async function parsePdfDocument(buffer: ArrayBuffer): Promise<PdfParseResult> {
  try {
    const data = new Uint8Array(buffer)
    const doc = await getDocument({
      data,
      useSystemFonts: true,
      disableFontFace: true,
      isEvalSupported: false,
    }).promise

    const pageCount = doc.numPages
    if (pageCount === 0) {
      return { success: false, pageCount: 0, error: "PDF에 페이지가 없습니다." }
    }

    const pageTexts: string[] = []
    let totalChars = 0

    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i)
      const textContent = await page.getTextContent()

      // 텍스트 아이템을 행 단위로 그룹핑 (y좌표 기반)
      const lines = groupTextItemsByLine(textContent.items)
      const pageText = lines.join("\n")
      totalChars += pageText.replace(/\s/g, "").length
      pageTexts.push(pageText)
    }

    // 이미지 기반 PDF 감지: 페이지당 평균 문자 수가 너무 적으면
    const avgCharsPerPage = totalChars / pageCount
    if (avgCharsPerPage < 10) {
      return {
        success: false,
        pageCount,
        isImageBased: true,
        error: `이미지 기반 PDF로 추정됩니다 (${pageCount}페이지, 추출 텍스트 ${totalChars}자). 텍스트 추출이 불가합니다.`,
      }
    }

    // 페이지별 마크다운 조합
    let markdown = ""
    for (let i = 0; i < pageTexts.length; i++) {
      const cleaned = cleanPdfText(pageTexts[i])
      if (cleaned.trim()) {
        if (i > 0 && markdown) markdown += "\n\n"
        markdown += cleaned
      }
    }

    // 테이블 구조 복원 시도
    markdown = reconstructTables(markdown)

    return {
      success: true,
      markdown,
      pageCount,
      isImageBased: false,
    }
  } catch (err) {
    return {
      success: false,
      pageCount: 0,
      error: err instanceof Error ? err.message : "PDF 파싱 실패",
    }
  }
}

// ─── 텍스트 아이템 → 행 그룹핑 ──────────────────────

interface TextItem {
  str: string
  transform: number[]
  width: number
  height: number
  dir?: string
}

function groupTextItemsByLine(items: any[]): string[] {
  if (items.length === 0) return []

  // y좌표 기준 행 그룹핑 (transform[5] = y)
  const textItems = items.filter((item): item is TextItem =>
    typeof item.str === "string" && item.str.trim() !== ""
  )

  if (textItems.length === 0) return []

  // y 좌표 기준으로 정렬 (위→아래: y 내림차순), 같은 행이면 x 좌표 오름차순
  textItems.sort((a, b) => {
    const yDiff = b.transform[5] - a.transform[5]
    if (Math.abs(yDiff) < 2) return a.transform[4] - b.transform[4]
    return yDiff
  })

  const lines: string[] = []
  let currentY = textItems[0].transform[5]
  let currentLine: { text: string; x: number; width: number }[] = []

  for (const item of textItems) {
    const y = item.transform[5]
    const x = item.transform[4]

    // 새 줄 감지 (y 좌표 차이가 글자 높이의 절반 이상)
    if (Math.abs(currentY - y) > Math.max(item.height * 0.5, 2)) {
      if (currentLine.length > 0) {
        lines.push(mergeLineItems(currentLine))
      }
      currentLine = []
      currentY = y
    }

    currentLine.push({ text: item.str, x, width: item.width })
  }

  if (currentLine.length > 0) {
    lines.push(mergeLineItems(currentLine))
  }

  return lines
}

/**
 * 같은 행의 텍스트 아이템을 간격 기반으로 병합
 */
function mergeLineItems(items: { text: string; x: number; width: number }[]): string {
  if (items.length === 0) return ""
  if (items.length === 1) return items[0].text

  items.sort((a, b) => a.x - b.x)

  let result = items[0].text
  for (let i = 1; i < items.length; i++) {
    const gap = items[i].x - (items[i - 1].x + items[i - 1].width)
    // 큰 간격 = 탭/셀 구분자
    if (gap > 15) {
      result += "\t"
    } else if (gap > 3) {
      result += " "
    }
    result += items[i].text
  }

  return result
}

// ─── 텍스트 정리 ─────────────────────────────────────

function cleanPdfText(text: string): string {
  return text
    // 반복 머리글/바닥글 제거 (페이지 번호 패턴)
    .replace(/^[\s]*[-–—]\s*\d+\s*[-–—][\s]*$/gm, "")
    .replace(/^\s*\d+\s*\/\s*\d+\s*$/gm, "")
    // 연속 빈줄 정리
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

// ─── 테이블 구조 복원 ────────────────────────────────

/**
 * 탭 구분자가 포함된 행들을 마크다운 테이블로 변환 시도
 */
function reconstructTables(text: string): string {
  const lines = text.split("\n")
  const result: string[] = []
  let tableBuffer: string[][] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.includes("\t")) {
      const cells = line.split("\t").map(c => c.trim())
      tableBuffer.push(cells)
    } else {
      // 테이블 버퍼 플러시
      if (tableBuffer.length >= 2) {
        result.push(formatAsMarkdownTable(tableBuffer))
      } else if (tableBuffer.length === 1) {
        // 단일 행은 테이블 아님 - 그냥 텍스트로
        result.push(tableBuffer[0].join(" | "))
      }
      tableBuffer = []
      result.push(line)
    }
  }

  // 마지막 테이블 버퍼 플러시
  if (tableBuffer.length >= 2) {
    result.push(formatAsMarkdownTable(tableBuffer))
  } else if (tableBuffer.length === 1) {
    result.push(tableBuffer[0].join(" | "))
  }

  return result.join("\n")
}

function formatAsMarkdownTable(rows: string[][]): string {
  // 최대 열 수 계산
  const maxCols = Math.max(...rows.map(r => r.length))

  // 열 너비 균일화
  const normalizedRows = rows.map(r => {
    while (r.length < maxCols) r.push("")
    return r
  })

  // 마크다운 테이블 생성
  const lines: string[] = []
  lines.push("| " + normalizedRows[0].join(" | ") + " |")
  lines.push("| " + normalizedRows[0].map(() => "---").join(" | ") + " |")
  for (let i = 1; i < normalizedRows.length; i++) {
    lines.push("| " + normalizedRows[i].join(" | ") + " |")
  }

  return lines.join("\n")
}
