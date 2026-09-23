/**
 * analyze_document 전체 경로 회귀 (2026-09-23 리뷰 C1)
 *
 * 규칙 엔진(risk-rules)만이 아니라 도구 전체가 선형이어야 한다. 종전에는 legal_research
 * document_review 경로에서 100KB 입력 한 건이 이벤트 루프를 11.9초 멈췄다(업스트림 호출 0회).
 */
import { describe, it, expect } from "vitest"
import { analyzeDocument } from "./document-analysis.js"

async function timed(text: string): Promise<{ ms: number, isError?: boolean }> {
  const t0 = performance.now()
  const r = await analyzeDocument(null, { text, maxClauses: 15 })
  return { ms: performance.now() - t0, isError: r.isError }
}

describe("analyze_document: 비정상 입력 10만 자", () => {
  it("해지통보 + 숫자 덩어리", async () => {
    const r = await timed("해지통보" + "1".repeat(100_000))
    expect(r.ms).toBeLessThan(300)
    expect(r.isError).toBeUndefined()
  })

  it("계약금액 + 쉼표 덩어리", async () => {
    const r = await timed("계약금액" + ",".repeat(100_000))
    expect(r.ms).toBeLessThan(300)
    expect(r.isError).toBeUndefined()
  })
})
