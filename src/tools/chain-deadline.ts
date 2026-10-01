/**
 * 체인 단위 데드라인 + 부분 결과 (#131)
 *
 * 병렬화는 평균을 줄이지만 업스트림 꼬리는 못 막는다 — 같은 질의가 12초로도, 71초로도
 * 끝나는 것을 실측했다(2026-08-17, action_basis). 60초 클라이언트 한도를 넘기면 이용자는
 * 부분 결과조차 못 받고 타임아웃만 본다.
 *
 * 그래서 시간이 다하면 **받은 것까지 조립하고 못 받은 자리는 마커로 남긴다**.
 * 부분 결과는 유효한 답이므로 isError 가 아니다 — 다만 무엇이 비었는지, 그것만 따로
 * 받으려면 어느 도구를 쓰는지 반드시 밝힌다(침묵 탈락 금지).
 *
 * 정수 검증은 execution-limits.parseIntegerLimit 한 벌을 쓴다(#144) — 경계값 검사가
 * 두 벌이면 한쪽만 `parseInt("20x") → 20` 관용을 되찾는다. 상수는 이 도메인의 것이라 여기 둔다.
 */

import { parseIntegerLimit } from "../lib/execution-limits.js"

/**
 * 기본 45초.
 * MCP 클라이언트 기본 타임아웃이 60초이고, 데드라인이 걸린 뒤에도 섹션 조립·
 * truncateResponse(50KB)·전송이 남는다. 15초 여유는 그 뒷단과 시계 오차를 위한 것이다.
 */
export const DEFAULT_CHAIN_DEADLINE_MS = 45_000

/** 5초 미만은 정상 체인도 못 끝내고, 5분 초과는 어떤 클라이언트도 기다리지 않는다 */
const MIN_DEADLINE_MS = 5_000
const MAX_DEADLINE_MS = 300_000

/** 빈 문자열은 "미설정"으로 본다 — env 에서 지우지 않고 비워 두는 배포가 흔하다 */
export function resolveChainDeadlineMs(env: NodeJS.ProcessEnv = process.env): number {
  return parseIntegerLimit(
    "MCP_CHAIN_DEADLINE_MS",
    env.MCP_CHAIN_DEADLINE_MS || undefined,
    DEFAULT_CHAIN_DEADLINE_MS,
    MIN_DEADLINE_MS,
    MAX_DEADLINE_MS,
  )
}

export interface ChainDeadline {
  /** 갈래들이 공유하는 취소 신호 — 만료 시 진행 중 업스트림 요청을 끊는다 */
  readonly signal: AbortSignal
  expired(): boolean
  /** 타이머 해제. 체인이 끝나면 반드시 부른다(핸들 누수 방지) */
  dispose(): void
}

export function startChainDeadline(ms: number = resolveChainDeadlineMs()): ChainDeadline {
  const controller = new AbortController()
  let fired = false
  const timer = setTimeout(() => {
    fired = true
    controller.abort(new Error(`체인 시간 한도(${ms}ms) 초과`))
  }, ms)
  // 이 타이머 때문에 프로세스가 살아 있으면 안 된다
  timer.unref?.()
  return {
    signal: controller.signal,
    expired: () => fired,
    dispose: () => clearTimeout(timer),
  }
}

export type LegOutcome<T> = { ok: true; value: T } | { ok: false }

/**
 * 한 갈래를 데드라인과 경주시킨다.
 *
 * 데드라인 전에 난 실패는 삼키지 않고 그대로 던진다 — 시간 초과와 진짜 오류를 뭉뚱그리면
 * 파싱 실패가 "느렸나 보다"로 둔갑한다.
 */
export async function raceDeadline<T>(
  deadline: ChainDeadline,
  work: Promise<T>
): Promise<LegOutcome<T>> {
  let onAbort: () => void = () => {}
  const timedOut = new Promise<LegOutcome<T>>(resolve => {
    if (deadline.signal.aborted) return resolve({ ok: false })
    onAbort = () => resolve({ ok: false })
    deadline.signal.addEventListener("abort", onAbort, { once: true })
  })
  const settled = work.then(
    (value): LegOutcome<T> => ({ ok: true, value }),
    (error): LegOutcome<T> => {
      if (deadline.expired()) return { ok: false }
      throw error
    }
  )
  try {
    return await Promise.race([settled, timedOut])
  } finally {
    deadline.signal.removeEventListener("abort", onAbort)
  }
}

/** 시간 안에 못 받은 섹션 자리에 남기는 표시 — 무엇이 비었고 어떻게 받는지 밝힌다 */
export function timedOutSection(title: string, toolHint: string): string {
  return `▶ ${title}\n⏱ 시간 한도로 이 섹션은 수집하지 못했습니다 — 개별 도구(${toolHint})로 조회하세요.`
}

/**
 * 프리픽스(기반 탐색·선행 단계)에서 만료된 체인의 말미 표시 (#150).
 * 섹션 단위 마커와 달리 "여기서부터 전부 못 받았다"를 밝힌다 — 위에 실린 것이
 * 시간 안에 받은 전부라는 사실까지 말해야 소비자가 빈 자리를 추측으로 메우지 않는다.
 */
export function timedOutChainNotice(): string {
  return "⏱ 체인 시간 한도로 이후 단계를 수집하지 못했습니다 — 위까지가 시간 안에 받은 전부입니다. 나머지는 개별 도구로 조회하거나 잠시 후 재시도하세요."
}
