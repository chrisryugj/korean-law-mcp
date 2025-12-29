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
 * API 키 스키마
 */
export const apiKeySchema = z.string().optional().describe("API 키 (생략시 환경변수 사용)")

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
 * 응답 크기 제한 적용
 */
export function truncateResponse(text: string, maxSize: number = MAX_RESPONSE_SIZE): string {
  if (text.length <= maxSize) return text

  const truncated = text.slice(0, maxSize)
  return truncated + `\n\n⚠️ 응답이 너무 길어 ${maxSize.toLocaleString()}자로 잘렸습니다.`
}
