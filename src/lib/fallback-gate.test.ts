import { describe, expect, it } from "vitest"
import { createFallbackGate, fallbackDeniedMessage } from "./fallback-gate.js"

const T0 = 1_700_000_000_000
const gate = (o: Partial<Parameters<typeof createFallbackGate>[0]> = {}) =>
  createFallbackGate({ rpm: 10, burst: 10, dailyCap: 0, perClientRpm: 4, perClientBurst: 4, ...o })

describe("createFallbackGate", () => {
  // 2026-11-17 13:33 KST: IP 하나가 공유 몫을 다 써서 다른 무키 사용자까지 429
  it("한 클라이언트가 몰아 보내도 다른 클라이언트 몫이 남는다", () => {
    const g = gate()
    for (let i = 0; i < 4; i++) expect(g.take("heavy", 1, T0).ok).toBe(true)
    for (let i = 0; i < 100; i++) expect(g.take("heavy", 1, T0)).toMatchObject({ ok: false, scope: "client" })
    // 공유 10 중 heavy 는 4만 썼다: 다른 클라이언트 둘이 3씩, 합 6까지 통과하고 그다음은 공유 한도
    for (let i = 0; i < 6; i++) expect(g.take(`user${i % 2}`, 1, T0).ok).toBe(true)
    expect(g.take("user2", 1, T0)).toMatchObject({ ok: false, scope: "minute" })
  })

  it("클라이언트 몫에서 거부된 요청은 공유 토큰을 쓰지 않는다", () => {
    const g = gate({ rpm: 5, burst: 5 })
    for (let i = 0; i < 50; i++) g.take("heavy", 1, T0) // 4 통과, 46 거부 → 공유는 1 남음
    expect(g.take("a", 1, T0).ok).toBe(true)
    expect(g.take("b", 1, T0)).toMatchObject({ ok: false, scope: "minute" })
  })

  it("공유 버킷이 거부하면 클라이언트 몫을 돌려준다", () => {
    const g = gate({ rpm: 2, burst: 2 })
    expect(g.take("a", 1, T0).ok).toBe(true)
    expect(g.take("b", 1, T0).ok).toBe(true)
    for (let i = 0; i < 10; i++) expect(g.take("c", 1, T0)).toMatchObject({ ok: false, scope: "minute" })
    // c 는 공유 거부만 받았으니 자기 몫 4가 그대로다: 공유가 다시 차면 바로 통과
    expect(g.take("c", 4, T0 + 120_000).ok).toBe(false) // 공유 용량 2 < 4
    expect(g.take("c", 2, T0 + 120_000).ok).toBe(true)
  })

  it("perClientRpm 0 이면 종전 동작(공유 버킷만)", () => {
    const g = gate({ perClientRpm: 0, perClientBurst: 1 })
    for (let i = 0; i < 10; i++) expect(g.take("heavy", 1, T0).ok).toBe(true)
    expect(g.take("other", 1, T0)).toMatchObject({ ok: false, scope: "minute" })
  })

  it("일일 총량은 분당 게이트를 통과한 요청만 센다", () => {
    const g = gate({ dailyCap: 3 })
    for (let i = 0; i < 3; i++) expect(g.take(`u${i}`, 1, T0).ok).toBe(true)
    expect(g.take("u9", 1, T0)).toMatchObject({ ok: false, scope: "daily" })
  })
})

describe("fallbackDeniedMessage", () => {
  it("거부 원인과 할 일을 적는다", () => {
    expect(fallbackDeniedMessage({ ok: false, scope: "client", retryAfterSec: 15 }, 60))
      .toMatch(/60 tool calls\/min per client.*retry in 15s.*own key/)
    expect(fallbackDeniedMessage({ ok: false, scope: "minute", retryAfterSec: 3 }, 60)).toMatch(/^Shared API quota exceeded/)
    expect(fallbackDeniedMessage({ ok: false, scope: "daily", retryAfterSec: 3 }, 60)).toMatch(/^Shared API daily cap reached/)
  })
})
