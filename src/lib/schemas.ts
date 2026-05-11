/**
 * 공통 Zod 스키마
 */

import { z } from "zod"

/**
 * 날짜 스키마 (YYYYMMDD 형식)
 */
export const dateSchema = z
  .string()
  .regex(/^\d{8}$/, "날짜 형식: YYYYMMDD (예: 20240101)")
  .refine(
    (val) => {
      const year = parseInt(val.slice(0, 4), 10)
      const month = parseInt(val.slice(4, 6), 10)
      const day = parseInt(val.slice(6, 8), 10)

      if (year < 1900 || year > 2100) return false
      if (month < 1 || month > 12) return false
      if (day < 1 || day > 31) return false

      // 월별 일수 체크
      const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
      const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
      if (month === 2 && isLeapYear) {
        return day <= 29
      }
      return day <= daysInMonth[month - 1]
    },
    { message: "유효하지 않은 날짜입니다." }
  )

/**
 * 선택적 날짜 스키마
 */
export const optionalDateSchema = dateSchema.optional()

/**
 * 페이지네이션 스키마
 */
export const paginationSchema = z.object({
  display: z.number().min(1).max(100).default(20).describe("결과 수 (기본:20, 최대:100)"),
  page: z.number().min(1).default(1).describe("페이지 번호 (기본:1)"),
})

/**
 * 응답 크기 제한 (50KB)
 */
export const MAX_RESPONSE_SIZE = 50000

/**
 * 날짜 포맷 (YYYYMMDD → YYYY.MM.DD)
 */
export function formatDateDot(dateStr: string): string {
  if (!dateStr || dateStr.length < 8) return dateStr || "N/A"
  return `${dateStr.substring(0, 4)}.${dateStr.substring(4, 6)}.${dateStr.substring(6, 8)}`
}

/**
 * truncateResponse 옵션
 */
interface TruncateOptions {
  maxLength?: number
  /** true이면 초과 시 핵심 내용만 요약 추출 */
  summary?: boolean
}

/**
 * 응답 크기 제한 적용
 *
 * @param text - 원본 텍스트
 * @param maxSizeOrOpts - 숫자(최대 길이) 또는 옵션 객체
 */
export function truncateResponse(text: string, maxSizeOrOpts?: number): string
export function truncateResponse(text: string, maxSizeOrOpts?: TruncateOptions): string
export function truncateResponse(text: string, maxSizeOrOpts: number | TruncateOptions = MAX_RESPONSE_SIZE): string {
  let maxSize: number
  let summary = false

  if (typeof maxSizeOrOpts === "object" && maxSizeOrOpts !== null) {
    maxSize = maxSizeOrOpts.maxLength ?? MAX_RESPONSE_SIZE
    summary = !!maxSizeOrOpts.summary
  } else {
    maxSize = maxSizeOrOpts
  }

  if (text.length <= maxSize) return text

  // summary 모드: 핵심 내용(첫 줄 + 섹션 제목들 + 마지막 줄) 추출
  if (summary) {
    return _extractSummary(text, maxSize)
  }

  // 기본 동작: 단순 잘라내기
  const truncated = text.slice(0, maxSize)
  return truncated + `\n\n⚠️ 응답이 너무 길어 ${maxSize.toLocaleString()}자로 잘렸습니다.`
}

/**
 * 핵심 내용 요약 추출 (summary 모드 내부 함수)
 * 첫 줄 + 모든 섹션 헤더(▶ ...) + 각 섹션의 처음 2줄 + 말미 안내
 */
function _extractSummary(text: string, maxSize: number): string {
  const lines = text.split("\n")
  const collected: string[] = []
  let budget = maxSize - 100 // 말미 안내 여유

  // 첫 줄(제목) 항상 포함
  if (lines.length > 0) {
    collected.push(lines[0])
    budget -= lines[0].length + 1
  }

  let i = 1
  while (i < lines.length && budget > 0) {
    const line = lines[i]
    // 섹션 헤더이거나 빈 줄이 아닌 경우
    if (/^▶|^#{1,4}\s|^=====|^-----/.test(line)) {
      collected.push("")
      collected.push(line)
      budget -= line.length + 2
      // 헤더 다음 2줄까지 포함
      let j = 1
      for (; j <= 2 && i + j < lines.length && budget > 0; j++) {
        const nextLine = lines[i + j]
        if (/^▶|^#{1,4}\s/.test(nextLine)) break // 다음 섹션이면 중단
        collected.push(nextLine)
        budget -= nextLine.length + 1
      }
      i += j // j 루프로 소비한 만큼 i를 추가 증가
    }
    i++
  }

  const tail = `\n\n📋 요약 모드: 원문 ${text.length.toLocaleString()}자 중 핵심만 추출 (${collected.join("\n").length.toLocaleString()}자)`
  return collected.join("\n") + tail
}

/**
 * 체인 도구용 섹션별 truncation
 *
 * 형식이 "▶ 섹션제목\n내용" 패턴인 텍스트에서
 * 각 섹션을 개별적으로 길이 제한하여 전체 균형 유지.
 *
 * @param text - "▶ 제목\n내용\n\n▶ 제목\n내용" 형태
 * @param totalMax - 전체 최대 길이
 * @param sectionMax - 섹션당 최대 길이 (기본: totalMax / 섹션 수)
 */
export function truncateSections(
  text: string,
  totalMax: number = MAX_RESPONSE_SIZE,
  sectionMax?: number
): string {
  if (text.length <= totalMax) return text

  // "▶ " 패턴으로 섹션 분리
  const sectionPattern = /(?=▶\s)/g
  const parts = text.split(sectionPattern)

  // 첫 조각이 빈 문자열이거나 헤더 이전 텍스트인 경우 분리
  let preamble = ""
  let sections = parts
  if (parts.length > 0 && !parts[0].startsWith("▶")) {
    preamble = parts[0]
    sections = parts.slice(1)
  }

  if (sections.length === 0) {
    // 섹션 패턴이 없으면 일반 truncation
    return truncateResponse(text, totalMax)
  }

  const perSection = sectionMax || Math.floor((totalMax - preamble.length - 100) / sections.length)

  const truncatedSections = sections.map((sec) => {
    if (sec.length <= perSection) return sec
    const truncated = sec.slice(0, perSection)
    // 마지막 완전한 줄에서 자르기
    const lastNewline = truncated.lastIndexOf("\n")
    const clean = lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated
    return clean + `\n   ⚠️ (이 섹션 ${sec.length.toLocaleString()}자 → ${perSection.toLocaleString()}자로 축약)`
  })

  let result = preamble + truncatedSections.join("\n\n")

  // 전체 길이 재확인
  if (result.length > totalMax) {
    result = result.slice(0, totalMax) + `\n\n⚠️ 전체 응답이 ${totalMax.toLocaleString()}자로 잘렸습니다.`
  }

  return result
}
