/**
 * 통일된 에러 처리 모듈
 */

import type { ToolResponse } from "./types.js"

/**
 * 에러 코드
 */
export const ErrorCodes = {
  NOT_FOUND: "LAW_NOT_FOUND",
  INVALID_PARAM: "INVALID_PARAMETER",
  API_ERROR: "EXTERNAL_API_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  TIMEOUT: "REQUEST_TIMEOUT",
  PARSE_ERROR: "PARSE_ERROR",
} as const

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes]

/**
 * 법제처 API 에러
 */
export class LawApiError extends Error {
  code: ErrorCode
  suggestions: string[]

  constructor(message: string, code: ErrorCode, suggestions: string[] = []) {
    super(message)
    this.name = "LawApiError"
    this.code = code
    this.suggestions = suggestions
  }

  /**
   * 사용자 친화적 포맷
   */
  format(): string {
    let result = `❌ ${this.message}`
    if (this.suggestions.length > 0) {
      result += "\n\n💡 개선 방법:"
      this.suggestions.forEach((s, i) => {
        result += `\n   ${i + 1}. ${s}`
      })
    }
    return result
  }
}

/**
 * 도구 에러 응답 생성
 */
export function formatToolError(error: unknown, context?: string): ToolResponse {
  let message: string

  if (error instanceof LawApiError) {
    message = error.format()
  } else if (error instanceof Error) {
    message = context ? `[${context}] ${error.message}` : error.message
  } else {
    message = context ? `[${context}] ${String(error)}` : String(error)
  }

  return {
    content: [{ type: "text", text: message }],
    isError: true,
  }
}

/**
 * 법령 없음 에러
 */
export function notFoundError(lawName: string, suggestions?: string[]): LawApiError {
  return new LawApiError(
    `'${lawName}'을(를) 찾을 수 없습니다.`,
    ErrorCodes.NOT_FOUND,
    suggestions || [
      `search_law(query="${lawName}")로 법령 검색`,
      "법령명 철자 확인",
    ]
  )
}

/**
 * API 에러
 */
export function apiError(status: number, endpoint?: string): LawApiError {
  const suggestions =
    status === 429
      ? ["잠시 후 다시 시도", "요청 빈도 줄이기"]
      : status >= 500
        ? ["법제처 API 상태 확인", "잠시 후 다시 시도"]
        : ["요청 파라미터 확인"]

  return new LawApiError(
    `API 오류 (${status})${endpoint ? ` - ${endpoint}` : ""}`,
    status === 429 ? ErrorCodes.RATE_LIMITED : ErrorCodes.API_ERROR,
    suggestions
  )
}

/**
 * 파라미터 검증 에러
 */
export function invalidParamError(param: string, expected: string): LawApiError {
  return new LawApiError(
    `잘못된 파라미터: ${param}`,
    ErrorCodes.INVALID_PARAM,
    [`${param}는 ${expected} 형식이어야 합니다.`]
  )
}
