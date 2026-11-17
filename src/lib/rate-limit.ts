/**
 * 요청 한도 게이트 — 토큰버킷 + 롤링 일일 캡
 *
 * 고정창(fixed window)은 창 초반에 요청이 몰리면 남은 수십 초를 통째로 차단한다.
 * MCP는 한 대화 턴에 도구를 여러 번 부르는 게 정상이라 이 패턴에 특히 취약하다.
 * 토큰버킷은 연속 리필이라 소진 후에도 몇 초만 기다리면 다시 통과한다 —
 * 같은 평균 처리율에서 체감 429가 크게 준다.
 *
 * now를 주입받아 타이머 없이 테스트 가능하게 유지한다.
 */

export interface Verdict {
  ok: boolean
  /** 거부 시 클라이언트에 안내할 재시도 대기 초 (허용 시 0) */
  retryAfterSec: number
}

const OK: Verdict = { ok: true, retryAfterSec: 0 }

export interface TokenBucket {
  take(n: number, now?: number): Verdict
}

/**
 * @param ratePerMin 분당 리필량. 0 이하면 모든 요청 거부(기능 비활성 신호)
 * @param burst 버킷 용량. 기본은 1분치 — 평균은 종전과 같고 버스트만 흡수한다
 */
export function createTokenBucket(ratePerMin: number, burst = ratePerMin): TokenBucket {
  let tokens = burst
  let last = 0

  return {
    take(n: number, now = Date.now()): Verdict {
      if (ratePerMin <= 0) return { ok: false, retryAfterSec: 60 }
      if (last === 0) last = now
      tokens = Math.min(burst, tokens + ((now - last) / 60_000) * ratePerMin)
      last = now

      if (tokens >= n) {
        tokens -= n
        return OK
      }
      // 부족분이 채워질 때까지 걸리는 시간. 버킷 용량보다 큰 요청은 영원히 못 받으므로
      // 그 경우도 대기 초는 유한하게 안내하고 거부한다.
      const deficit = Math.min(n, burst) - tokens
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((deficit / ratePerMin) * 60)) }
    },
  }
}

export interface KeyedTokenBuckets {
  take(key: string, n: number, now?: number): Verdict
  /** take 로 뺀 토큰을 돌려준다. 뒤 게이트가 거부한 요청이 이 몫을 쓰지 않게 */
  refund(key: string, n: number): void
  /** 다 찬 버킷(=기본 상태)을 지운다. 지워도 판정은 같다 */
  sweep(now?: number): void
  size(): number
}

/**
 * 키(접속 IP)마다 따로 도는 토큰버킷. 공용 버킷을 한 클라이언트가 다 쓰지 못하게 몫을 나눈다.
 * createTokenBucket 과 달리 rate 0 은 "몫 제한 없음"(항상 통과)이다.
 * @param maxKeys 키 수 상한. 넘으면 다 찬 버킷부터, 그래도 넘으면 가장 오래된 키를 지운다
 */
export function createKeyedTokenBuckets(ratePerMin: number, burst = ratePerMin, maxKeys = 50_000): KeyedTokenBuckets {
  const buckets = new Map<string, { tokens: number; last: number }>()
  const refill = (b: { tokens: number; last: number }, now: number) =>
    Math.min(burst, b.tokens + ((now - b.last) / 60_000) * ratePerMin)

  function sweep(now = Date.now()) {
    for (const [key, b] of buckets) if (refill(b, now) >= burst) buckets.delete(key)
  }

  return {
    take(key: string, n: number, now = Date.now()): Verdict {
      if (ratePerMin <= 0) return OK
      let b = buckets.get(key)
      if (!b) {
        if (buckets.size >= maxKeys) {
          sweep(now)
          if (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value as string)
        }
        b = { tokens: burst, last: now }
        buckets.set(key, b)
      }
      b.tokens = refill(b, now)
      b.last = now
      if (b.tokens >= n) {
        b.tokens -= n
        return OK
      }
      const deficit = Math.min(n, burst) - b.tokens
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((deficit / ratePerMin) * 60)) }
    },
    refund(key: string, n: number) {
      const b = buckets.get(key)
      if (b) b.tokens = Math.min(burst, b.tokens + n)
    },
    sweep,
    size: () => buckets.size,
  }
}

export interface DailyCap {
  take(n: number, now?: number): Verdict
  used(now?: number): number
}

/**
 * 롤링 24시간 총량 캡. 분당 한도를 풀어도 하루 총 호출량은 묶어두기 위한 안전판.
 * @param limit 24시간 허용량. 0 이하면 캡 없음(항상 통과)
 */
export function createDailyCap(limit: number): DailyCap {
  let count = 0
  let resetAt = 0

  function roll(now: number) {
    if (limit > 0 && now >= resetAt) {
      count = 0
      resetAt = now + 86_400_000
    }
  }

  return {
    take(n: number, now = Date.now()): Verdict {
      if (limit <= 0) return OK
      roll(now)
      if (count + n > limit) {
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((resetAt - now) / 1000)) }
      }
      count += n
      return OK
    },
    used(now = Date.now()): number {
      if (limit <= 0) return 0
      roll(now)
      return count
    },
  }
}
