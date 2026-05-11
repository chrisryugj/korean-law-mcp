/**
 * Scenario: delegation — 위임입법 미이행 감시기
 * 호스트 체인: chain_law_system
 *
 * 추가 조회: 위임법령(미제정) + 법체계(행정규칙 포함) + 조문 이력
 */
import type { ScenarioContext, ScenarioResult, ScenarioSection } from "./types.js"
import { callTool } from "./types.js"
import { getDelegatedLaws } from "../law-linkage.js"
import { getLawSystemTree } from "../law-system-tree.js"
import { getArticleHistory } from "../article-history.js"

export async function runDelegationScenario(ctx: ScenarioContext): Promise<ScenarioResult> {
  const sections: ScenarioSection[] = []
  const suggestedActions: string[] = []

  if (!ctx.law) {
    return { sections, suggestedActions }
  }

  const { lawName, lawId, mst } = ctx.law

  // 병렬: 위임법령 + 법체계(행정규칙 포함) + 조문 이력
  const promises: Promise<{ text: string; isError: boolean }>[] = [
    // 위임법령 (소관부처별 미이행 현황)
    callTool(getDelegatedLaws, ctx.apiClient, {
      query: lawName,
      display: 20,
      apiKey: ctx.apiKey,
    }),
    // 법체계도 (행정규칙=훈령/예규/고시 포함)
    callTool(getLawSystemTree, ctx.apiClient, {
      mst,
      apiKey: ctx.apiKey,
    }),
  ]

  if (lawId) {
    promises.push(
      callTool(getArticleHistory, ctx.apiClient, { lawId, apiKey: ctx.apiKey })
    )
  }

  const results = await Promise.all(promises)
  const [delegR, treeR, histR] = results

  if (!delegR.isError && delegR.text.trim()) {
    sections.push({ title: "위임입법 현황 (미제정 포함)", content: delegR.text })
  }

  if (!treeR.isError && treeR.text.trim()) {
    sections.push({ title: "법체계 + 행정규칙", content: treeR.text })
  }

  if (histR && !histR.isError && histR.text.trim()) {
    sections.push({ title: "조문별 개정이력 (위임 조항 변동 추적)", content: histR.text })
  }

  // 후속 액션
  suggestedActions.push(
    `${lawName} 시행령 체계`,
    `${lawName} 개정이력`,
    `${lawName} 연계 자치법규`,
  )

  return { sections, suggestedActions }
}
