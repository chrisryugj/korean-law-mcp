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

describe("analyze_document: 긴 조항의 분석 범위", () => {
  it("조항 500자 이후의 일방 해지 문구도 분석한다", async () => {
    const text = "제1조(계약) " + "계약 내용의 일반적인 설명이다. ".repeat(40) + "회사는 사전 통지 없이 즉시 해지할 수 있다."
    const result = await analyzeDocument(null, { text, maxClauses: 15 })
    expect(result.content[0].text).toContain("일방 해지 조항 (제1조)")
  })

  it("긴 조항 말미의 충돌 문구도 조항 간 대조에 포함한다", async () => {
    const text = "제1조 " + "계약 내용의 일반적인 설명이다. ".repeat(40) + "해지 통보는 30일 전에 한다.\n제2조 회사는 즉시 해지할 수 있다."
    const result = await analyzeDocument(null, { text, maxClauses: 15 })
    expect(result.content[0].text).toContain("해지통보 vs 즉시해지 (제1조 vs 제2조)")
  })
})
