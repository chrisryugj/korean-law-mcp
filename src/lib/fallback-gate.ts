/**
 * 서버 LAW_OC 폴백 게이트 — 자체 키 없는 요청이 서버 키를 얼마나 쓸 수 있는지 판정한다.
 *
 * 세 단계를 차례로 본다:
 *   1. 클라이언트(접속 IP)별 몫 — FALLBACK_PER_IP_RPM. 0 이면 끈다
 *   2. 전원 공유 분당 토큰버킷 — FALLBACK_RATE_LIMIT_RPM
 *   3. 롤링 24시간 총량 — FALLBACK_DAILY_CAP
 *
 * 1 이 없던 때는 한 클라이언트가 공유 버킷을 혼자 비울 수 있었다. 2026-11-17 13:33 KST 실측:
 * IP 하나(omp/18.22.0)가 1분에 POST 1,146건을 보내 공유 몫(분당 240)을 다 쓰고, 같은 분의 다른 무키
 * 사용자도 429 를 받았다. 같은 날 claude.ai·OpenAI 의 egress IP 는 IP 하나당 분당 최대 36·56건이었다.
 *
 * 1 이 거부하면 공유 토큰을 건드리지 않고, 2·3 이 거부하면 1 에서 뺀 몫을 돌려준다.
 */

import { createDailyCap, createKeyedTokenBuckets, createTokenBucket } from "./rate-limit.js"

export interface FallbackGateOptions {
  rpm: number
  burst: number
  dailyCap: number
  perClientRpm: number
  perClientBurst: number
}

export type FallbackScope = "client" | "minute" | "daily"

export type FallbackVerdict =
  | { ok: true }
  | { ok: false; scope: FallbackScope; retryAfterSec: number }

export interface FallbackGate {
  /** n = 이 요청이 소모하는 tools/call 개수 (배치는 개수만큼 서버 키를 쓴다) */
  take(client: string, n: number, now?: number): FallbackVerdict
  sweep(now?: number): void
}

export function createFallbackGate(opts: FallbackGateOptions): FallbackGate {
  const perClient = createKeyedTokenBuckets(opts.perClientRpm, opts.perClientBurst)
  const minute = createTokenBucket(opts.rpm, opts.burst)
  const day = createDailyCap(opts.dailyCap)

  return {
    take(client, n, now = Date.now()) {
      const mine = perClient.take(client, n, now)
      if (!mine.ok) return { ok: false, scope: "client", retryAfterSec: mine.retryAfterSec }
      const shared = minute.take(n, now)
      if (!shared.ok) {
        perClient.refund(client, n)
        return { ok: false, scope: "minute", retryAfterSec: shared.retryAfterSec }
      }
      // 분당 게이트를 통과한 요청만 일일 총량을 소모한다 (거부분 낭비 방지)
      const daily = day.take(n, now)
      if (!daily.ok) {
        perClient.refund(client, n)
        return { ok: false, scope: "daily", retryAfterSec: daily.retryAfterSec }
      }
      return { ok: true }
    },
    sweep: (now) => perClient.sweep(now),
  }
}

const OWN_KEY = "provide your own key via 'apiKey' header (free: https://open.law.go.kr)"

/** 429 본문 메시지. 에이전트가 읽고 사용자에게 옮길 수 있게 원인과 할 일을 같이 적는다 */
export function fallbackDeniedMessage(verdict: Extract<FallbackVerdict, { ok: false }>, perClientRpm: number): string {
  if (verdict.scope === "daily") return `Shared API daily cap reached. Provide your own key via 'apiKey' header (free: https://open.law.go.kr).`
  if (verdict.scope === "client") {
    return `This client exceeded its share of the shared API key (${perClientRpm} tool calls/min per client). Slow down and retry in ${verdict.retryAfterSec}s, or ${OWN_KEY}.`
  }
  return `Shared API quota exceeded — retry in ${verdict.retryAfterSec}s, or ${OWN_KEY}.`
}
