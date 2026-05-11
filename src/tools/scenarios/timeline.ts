/**
 * Scenario: timeline — 법령 시계열 종합 타임라인
 * 호스트 체인: chain_amendment_track
 *
 * 추가 조회: 개정 구간별 판례 + 해석례 + 과거 법령 조회
 */
import type { ScenarioContext, ScenarioResult, ScenarioSection } from "./types.js"
import { callTool } from "./types.js"
import { searchPrecedents } from "../precedents.js"
import { searchInterpretations } from "../interpretations.js"

export async function runTimelineScenario(ctx: ScenarioContext): Promise<ScenarioResult> {
  const sections: ScenarioSection[] = []
  const suggestedActions: string[] = []

  const lawName = ctx.law?.lawName || ctx.query

  // 병렬: 판례 + 해석례 (법령명 기반 검색)
  const [precR, interpR] = await Promise.all([
    callTool(searchPrecedents, ctx.apiClient, {
      query: lawName,
      display: 8,
      apiKey: ctx.apiKey,
    }),
    callTool(searchInterpretations, ctx.apiClient, {
      query: lawName,
      display: 5,
      apiKey: ctx.apiKey,
    }),
  ])

  if (!precR.isError && precR.text.trim()) {
    sections.push({ title: "관련 판례 (시계열 참조)", content: precR.text })
  }

  if (!interpR.isError && interpR.text.trim()) {
    sections.push({ title: "법령해석례 (시계열 참조)", content: interpR.text })
  }

  // 후속 액션
  suggestedActions.push(
    `${lawName} 3단비교 체계`,
    `${lawName} 별표 변경사항`,
    `${lawName} 처분기준 개정`,
  )

  return { sections, suggestedActions }
}
