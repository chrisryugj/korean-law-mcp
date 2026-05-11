/**
 * Scenario: customs — 관세·통관 종합 법률 체크
 * 호스트 체인: chain_full_research
 *
 * 추가 조회: 관세3법 체계 + 관세청 해석례 + FTA 조약 + 세율 별표 + 조세심판
 */
import type { ScenarioContext, ScenarioResult, ScenarioSection } from "./types.js"
import { callTool } from "./types.js"
import { searchCustomsInterpretations } from "../customs-interpretations.js"
import { searchTreaties } from "../treaties.js"
import { getAnnexes } from "../annex.js"
import { searchTaxTribunalDecisions } from "../tax-tribunal-decisions.js"
import { getThreeTier } from "../three-tier.js"

export async function runCustomsScenario(ctx: ScenarioContext): Promise<ScenarioResult> {
  const sections: ScenarioSection[] = []
  const suggestedActions: string[] = []

  // 병렬: 관세청 해석례 + 조세심판(관세) + 조약(FTA) + 별표(세율표)
  const promises: Promise<{ text: string; isError: boolean }>[] = [
    callTool(searchCustomsInterpretations, ctx.apiClient, {
      query: ctx.query,
      display: 5,
      apiKey: ctx.apiKey,
    }),
    callTool(searchTaxTribunalDecisions, ctx.apiClient, {
      query: `관세 ${ctx.query}`,
      display: 5,
      apiKey: ctx.apiKey,
    }),
    callTool(searchTreaties, ctx.apiClient, {
      query: /FTA|자유무역/.test(ctx.query) ? ctx.query : "FTA",
      display: 5,
      apiKey: ctx.apiKey,
    }),
  ]

  // 법령 정보 있으면 별표 + 3단비교도 추가
  if (ctx.law) {
    promises.push(
      callTool(getAnnexes, ctx.apiClient, { lawName: ctx.law.lawName, apiKey: ctx.apiKey }),
      callTool(getThreeTier, ctx.apiClient, { mst: ctx.law.mst, apiKey: ctx.apiKey }),
    )
  }

  const results = await Promise.all(promises)
  const [customsR, taxR, treatyR, annexR, threeTierR] = results

  if (!customsR.isError && customsR.text.trim()) {
    sections.push({ title: "관세청 해석례", content: customsR.text })
  }

  if (!taxR.isError && taxR.text.trim()) {
    sections.push({ title: "조세심판원 (관세 사건)", content: taxR.text })
  }

  if (!treatyR.isError && treatyR.text.trim()) {
    sections.push({ title: "관련 조약/FTA", content: treatyR.text })
  }

  if (annexR && !annexR.isError && annexR.text.trim()) {
    sections.push({ title: "세율표/별표", content: annexR.text })
  }

  if (threeTierR && !threeTierR.isError && threeTierR.text.trim()) {
    sections.push({ title: "관세법 체계 (법률·시행령·시행규칙)", content: threeTierR.text })
  }

  // 후속 액션
  const lawName = ctx.law?.lawName || "관세법"
  suggestedActions.push(
    `${lawName} 별표 세율표`,
    `관세 품목분류 해석례`,
    `FTA 원산지 결정기준`,
    `관세 과태료 불복 방법`,
  )

  return { sections, suggestedActions }
}
