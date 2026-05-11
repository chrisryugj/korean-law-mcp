/**
 * Scenario: impact — 법령 개정 영향도 분석
 * 호스트 체인: chain_law_system
 *
 * 추가 조회: 법체계 트리 + 연계 조례 + 연계 조문 + 행정규칙
 */
import type { ScenarioContext, ScenarioResult, ScenarioSection } from "./types.js"
import { callTool } from "./types.js"
import { getLawSystemTree } from "../law-system-tree.js"
import { getLinkedOrdinances, getLinkedOrdinanceArticles } from "../law-linkage.js"
import { searchAdminRule } from "../admin-rule.js"

export async function runImpactScenario(ctx: ScenarioContext): Promise<ScenarioResult> {
  const sections: ScenarioSection[] = []
  const suggestedActions: string[] = []

  if (!ctx.law) {
    return { sections, suggestedActions }
  }

  const { lawName, mst } = ctx.law

  // 병렬: 법체계 트리 + 연계 조례 + 연계 조문 + 행정규칙
  const [treeR, ordinR, artOrdinR, adminR] = await Promise.all([
    callTool(getLawSystemTree, ctx.apiClient, {
      mst,
      apiKey: ctx.apiKey,
    }),
    callTool(getLinkedOrdinances, ctx.apiClient, {
      query: lawName,
      display: 20,
      apiKey: ctx.apiKey,
    }),
    callTool(getLinkedOrdinanceArticles, ctx.apiClient, {
      query: lawName,
      display: 20,
      apiKey: ctx.apiKey,
    }),
    callTool(searchAdminRule, ctx.apiClient, {
      query: ctx.law.lawName,
      display: 10,
      apiKey: ctx.apiKey,
    }),
  ])

  if (!treeR.isError && treeR.text.trim()) {
    sections.push({ title: "법체계 관계도 (상위법·하위법·관련법)", content: treeR.text })
  }

  if (!ordinR.isError && ordinR.text.trim()) {
    sections.push({ title: "영향받는 자치법규 (전국)", content: ordinR.text })
  }

  if (!artOrdinR.isError && artOrdinR.text.trim()) {
    sections.push({ title: "조문별 자치법규 연계", content: artOrdinR.text })
  }

  if (!adminR.isError && adminR.text.trim()) {
    sections.push({ title: "관련 행정규칙 (훈령·예규·고시)", content: adminR.text })
  }

  // 후속 액션
  suggestedActions.push(
    `${lawName} 위임입법 현황`,
    `${lawName} 신구대조표`,
    `${lawName} 시행령 별표`,
  )

  return { sections, suggestedActions }
}
