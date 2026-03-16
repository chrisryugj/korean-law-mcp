/**
 * 별표 파일 파서 (HWPX / HWP / PDF 분기)
 *
 * - HWPX (신형): hwpx-parser.ts (manifest 멀티섹션, colSpan/rowSpan, 중첩 테이블)
 * - HWP (구형): hwp5-parser.ts (OLE2 직접 파싱, UTF-16LE 텍스트, 레코드 기반 테이블)
 * - PDF: 파싱 불가 → null (LLM이 직접 읽도록 링크 반환)
 *
 * 참고: https://github.com/roboco-io/hwp2md
 */

import { parseHwpxDocument } from "./hwpx-parser.js"
import { parseHwp5Document } from "./hwp5-parser.js"

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

// ─── HWPX 파서 (hwpx-parser.ts 위임) ────────────────

async function parseHwpx(buffer: ArrayBuffer): Promise<AnnexParseResult> {
  try {
    const markdown = await parseHwpxDocument(buffer)
    return { success: true, fileType: "hwpx", markdown }
  } catch (err) {
    return { success: false, fileType: "hwpx", error: err instanceof Error ? err.message : "HWPX 파싱 실패" }
  }
}

// ─── 구형 HWP 파서 (hwp5-parser.ts 위임) ────────────

async function parseHwp(buffer: ArrayBuffer): Promise<AnnexParseResult> {
  try {
    const markdown = parseHwp5Document(Buffer.from(buffer))
    return { success: true, fileType: "hwp", markdown }
  } catch (err) {
    return { success: false, fileType: "hwp", error: err instanceof Error ? err.message : "HWP 파싱 실패" }
  }
}
