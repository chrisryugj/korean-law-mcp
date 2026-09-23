/**
 * 삼키면 안 되는 오류 판정: 요청 예산 소진·요청 취소.
 *
 * 보조 조회를 `catch { return [] }` 로 감싸면 이 둘까지 "0건"으로 둔갑한다. 예산이 바닥난
 * 요청에서 시행예정 병기가 조용히 빠지거나(search_law_bulk diff 오탐), 개정 통계가
 * "총 0건"으로 나가던 것이 이 유형이다(2026-09-23 리뷰). 보조 조회의 catch 첫 줄에서 부른다.
 */
import { ExecutionLimitError } from "./execution-limits.js"
import { getRequestSignal } from "./session-state.js"

export function isFatalRequestError(error: unknown): boolean {
  return error instanceof ExecutionLimitError || Boolean(getRequestSignal()?.aborted)
}

export function rethrowIfFatal(error: unknown): void {
  if (isFatalRequestError(error)) throw error
}
