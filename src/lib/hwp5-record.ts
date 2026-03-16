/** HWP 5.x 레코드 리더, 텍스트 추출, 스트림 압축해제 (참고: github.com/roboco-io/hwp2md) */

import { inflateRawSync, inflateSync } from "zlib"

// ─── 상수 ─────────────────────────────────────────────

export const TAG_PARA_HEADER = 0x0042
export const TAG_PARA_TEXT = 0x0043
export const TAG_CTRL_HEADER = 0x0047
export const TAG_LIST_HEADER = 0x0048
export const TAG_TABLE = 0x004d

// 특수 문자 코드 (UTF-16LE)
const CHAR_LINE = 0x0000
const CHAR_PARA = 0x000d
const CHAR_TAB = 0x0009
const CHAR_HYPHEN = 0x001e
const CHAR_NBSP = 0x001f
const CHAR_FIXED_NBSP = 0x0018

// FileHeader 플래그
export const FLAG_COMPRESSED = 1 << 0
export const FLAG_ENCRYPTED = 1 << 1
export const FLAG_DRM = 1 << 4

// ─── 레코드 구조 ─────────────────────────────────────

export interface HwpRecord {
  tagId: number
  level: number
  size: number
  data: Buffer
}

// ─── 레코드 리더 ─────────────────────────────────────

export function readRecords(data: Buffer): HwpRecord[] {
  const records: HwpRecord[] = []
  let offset = 0

  while (offset + 4 <= data.length) {
    const header = data.readUInt32LE(offset)
    offset += 4

    const tagId = header & 0x3ff
    const level = (header >> 10) & 0x3ff
    let size = (header >> 20) & 0xfff

    // 확장 크기
    if (size === 0xfff) {
      if (offset + 4 > data.length) break
      size = data.readUInt32LE(offset)
      offset += 4
    }

    if (offset + size > data.length) break
    records.push({ tagId, level, size, data: data.subarray(offset, offset + size) })
    offset += size
  }

  return records
}

// ─── 스트림 압축 해제 ─────────────────────────────────

export function decompressStream(data: Buffer): Buffer {
  // zlib 헤더 확인 (0x78)
  if (data.length >= 2 && data[0] === 0x78) {
    try { return inflateSync(data) } catch { /* fallback */ }
  }
  // raw deflate
  return inflateRawSync(data)
}

// ─── FileHeader 파싱 ──────────────────────────────────

export interface HwpFileHeader {
  signature: string
  versionMajor: number
  flags: number
}

export function parseFileHeader(data: Buffer): HwpFileHeader {
  const sig = data.subarray(0, 32).toString("utf8").replace(/\0+$/, "")
  return {
    signature: sig,
    versionMajor: data[35],
    flags: data.readUInt32LE(36),
  }
}

// ─── 텍스트 추출 (UTF-16LE + 제어문자 처리) ──────────

export function extractText(data: Buffer): string {
  let result = ""
  let i = 0

  while (i + 1 < data.length) {
    const ch = data.readUInt16LE(i)
    i += 2

    switch (ch) {
      case CHAR_LINE: result += "\n"; break
      case CHAR_PARA: break // 문단 끝 (무시)
      case CHAR_TAB: result += "\t"; break
      case CHAR_HYPHEN: result += "-"; break
      case CHAR_NBSP: case CHAR_FIXED_NBSP: result += " "; break
      default:
        if (ch >= 0x0001 && ch <= 0x001f) {
          // Extended(1-3,11-18,21-23) / Inline(4-9,19-20): 14바이트 추가 데이터
          const isExt = (ch >= 1 && ch <= 3) || (ch >= 11 && ch <= 18) || (ch >= 21 && ch <= 23)
          const isInline = (ch >= 4 && ch <= 9) || (ch >= 19 && ch <= 20)
          if ((isExt || isInline) && i + 14 <= data.length) i += 14
        } else if (ch >= 0x0020) {
          result += String.fromCharCode(ch)
        }
        break
    }
  }

  return result
}
