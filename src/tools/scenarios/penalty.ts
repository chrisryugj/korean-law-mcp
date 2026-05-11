/**
 * Scenario: penalty — 처분·벌칙 기준 종합 조회기
 * 호스트 체인: chain_action_basis
 *
 * 추가 조회: 별표(처분기준표) + 감경/취소 행심 + 벌칙 조항 개정이력
 */
import type { ScenarioContext, ScenarioResult, ScenarioSection } from "./types.js"
import { callTool } from "./types.js"
import { getAnnexes } from "../annex.js"
import { searchAdminAppeals } from "../admin-appeals.js"
import { getArticleHistory } from "../article-history.js"
import { getLawText } from "../law-text.js"

export async function runPenaltyScenario(ctx: ScenarioContext): Promise<ScenarioResult> {
  const sections: ScenarioSection[] = []
  const suggestedActions: string[] = []

  if (!ctx.law) {
    return { sections, suggestedActions }
  }

  const { lawName, lawId, mst } = ctx.law

  // 병렬 실행: 별표(처분기준표) + 감경 행심 + 벌칙 조문
  const [annexR, appealR, penaltyR] = await Promise.all([
    callTool(getAnnexes, ctx.apiClient, { lawName, apiKey: ctx.apiKey }),
    callTool(searchAdminAppeals, ctx.apiClient, {
      query: `${lawName} 감경`,
      display: 5,
      apiKey: ctx.apiKey,
    }),
    callTool(getLawText, ctx.apiClient, {
      mst,
      search: "벌칙",
      apiKey: ctx.apiKey,
    }),
  ])

  if (!annexR.isError && annexR.text.trim()) {
    sections.push({ title: "별표 (행정처분/과태료 기준표)", content: annexR.text })
  }

  if (!penaltyR.isError && penaltyR.text.trim()) {
    sections.push({ title: "벌칙·과태료 조항", content: penaltyR.text })
  }

  if (!appealR.isError && appealR.text.trim()) {
    sections.push({ title: "감경·취소 행정심판례", content: appealR.text })
  }

  // 조문 개정이력 (lawId 있을 때만)
  if (lawId) {
    const histR = await callTool(getArticleHistory, ctx.apiClient, { lawId, apiKey: ctx.apiKey })
    if (!histR.isError && histR.text.trim()) {
      sections.push({ title: "벌칙 조항 개정이력", content: histR.text })
    }
  }

  // 후속 액션 제안
  suggestedActions.push(
    `${lawName} 과태료 불복 방법`,
    `${lawName} 감경 판례`,
    `${lawName} 시행령 처분기준 별표`,
  )

  return { sections, suggestedActions }
}
