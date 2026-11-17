import { describe, it, expect } from "vitest"
import { createTokenBucket, createDailyCap, createKeyedTokenBuckets } from "./rate-limit.js"

const T0 = 1_700_000_000_000

describe("createTokenBucket", () => {
  it("버킷 용량만큼 즉시 통과하고 그 다음을 거부한다", () => {
    const b = createTokenBucket(60, 60)
    for (let i = 0; i < 60; i++) expect(b.take(1, T0).ok).toBe(true)
    const denied = b.take(1, T0)
    expect(denied.ok).toBe(false)
    expect(denied.retryAfterSec).toBe(1) // 60rpm = 1초에 1개 리필
  })

  it("소진 후 리필된 만큼 다시 통과한다 (고정창과 달리 창 끝을 안 기다린다)", () => {
    const b = createTokenBucket(60, 60)
    for (let i = 0; i < 60; i++) b.take(1, T0)
    expect(b.take(1, T0 + 999).ok).toBe(false)   // 1초 미만 → 아직
    expect(b.take(1, T0 + 5_000).ok).toBe(true)  // 5초 → 5개 리필
    expect(b.take(4, T0 + 5_000).ok).toBe(true)
    expect(b.take(1, T0 + 5_000).ok).toBe(false)
  })

  it("리필은 버킷 용량을 넘지 않는다", () => {
    const b = createTokenBucket(60, 60)
    b.take(60, T0)
    b.take(60, T0 + 3_600_000) // 1시간 방치해도 용량까지만
    expect(b.take(1, T0 + 3_600_000).ok).toBe(false)
  })

  it("배치 n개를 한 번에 차감한다", () => {
    const b = createTokenBucket(120, 120)
    expect(b.take(100, T0).ok).toBe(true)
    expect(b.take(21, T0).ok).toBe(false)
    expect(b.take(20, T0).ok).toBe(true)
  })

  it("용량보다 큰 요청은 유한한 대기 안내와 함께 거부한다", () => {
    const b = createTokenBucket(60, 60)
    const v = b.take(1000, T0)
    expect(v.ok).toBe(false)
    expect(v.retryAfterSec).toBeGreaterThan(0)
    expect(Number.isFinite(v.retryAfterSec)).toBe(true)
  })

  it("rate 0은 폴백 비활성 — 전부 거부", () => {
    const b = createTokenBucket(0)
    expect(b.take(1, T0).ok).toBe(false)
  })

  it("burst를 rate보다 크게 잡으면 초기 버스트를 더 흡수한다", () => {
    const b = createTokenBucket(60, 180)
    expect(b.take(180, T0).ok).toBe(true)
    expect(b.take(1, T0).ok).toBe(false)
  })
})

describe("createKeyedTokenBuckets", () => {
  it("키마다 따로 센다: 한 키가 다 써도 다른 키는 통과", () => {
    const b = createKeyedTokenBuckets(60, 3)
    for (let i = 0; i < 3; i++) expect(b.take("a", 1, T0).ok).toBe(true)
    expect(b.take("a", 1, T0)).toEqual({ ok: false, retryAfterSec: 1 })
    expect(b.take("b", 1, T0).ok).toBe(true)
  })

  it("rate 0 은 몫 제한 없음(항상 통과, 키도 안 쌓는다)", () => {
    const b = createKeyedTokenBuckets(0)
    for (let i = 0; i < 1000; i++) expect(b.take("a", 5, T0).ok).toBe(true)
    expect(b.size()).toBe(0)
  })

  it("refund 는 뺀 몫을 돌려주되 용량을 넘기지 않는다", () => {
    const b = createKeyedTokenBuckets(60, 2)
    b.take("a", 2, T0)
    b.refund("a", 5)
    expect(b.take("a", 2, T0).ok).toBe(true)
    expect(b.take("a", 1, T0).ok).toBe(false)
  })

  it("sweep 은 다 찬 버킷만 지운다", () => {
    const b = createKeyedTokenBuckets(60, 60)
    b.take("old", 1, T0)
    b.take("busy", 60, T0 + 59_000)
    b.sweep(T0 + 60_000) // old 는 1초 만에 다시 찼다, busy 는 1개만 찼다
    expect(b.size()).toBe(1)
    expect(b.take("busy", 2, T0 + 60_000).ok).toBe(false)
  })

  it("키 수 상한을 넘지 않는다", () => {
    const b = createKeyedTokenBuckets(60, 60, 3)
    for (let i = 0; i < 10; i++) b.take(`ip${i}`, 60, T0)
    expect(b.size()).toBe(3)
  })
})

describe("createDailyCap", () => {
  it("limit 0이면 캡 없음", () => {
    const c = createDailyCap(0)
    expect(c.take(1_000_000, T0).ok).toBe(true)
    expect(c.used(T0)).toBe(0)
  })

  it("한도까지 통과하고 초과분을 거부한다", () => {
    const c = createDailyCap(100)
    expect(c.take(99, T0).ok).toBe(true)
    expect(c.take(1, T0).ok).toBe(true)
    const denied = c.take(1, T0)
    expect(denied.ok).toBe(false)
    expect(denied.retryAfterSec).toBeGreaterThan(0)
    expect(c.used(T0)).toBe(100)
  })

  it("거부된 요청은 총량을 소모하지 않는다", () => {
    const c = createDailyCap(10)
    c.take(10, T0)
    c.take(5, T0)
    expect(c.used(T0)).toBe(10)
  })

  it("24시간 뒤 창이 리셋된다", () => {
    const c = createDailyCap(10)
    c.take(10, T0)
    expect(c.take(1, T0 + 86_399_000).ok).toBe(false)
    expect(c.take(1, T0 + 86_400_001).ok).toBe(true)
  })
})
