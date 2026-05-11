/**
 * Scenario: manual — 공무원 처리 매뉴얼 생성기
 * 호스트 체인: chain_procedure_detail
 *
 * 추가 조회: 법령체계(행정규칙 포함) + 자치법규 특칙 + 법령해석례
 */
import type { ScenarioContext, ScenarioResult, ScenarioSection } from "./types.js"
import { callTool } from "./types.js"
import { getLawSystemTree } from "../law-system-tree.js"
import { getLinkedOrdinances } from "../law-linkage.js"
import { searchInterpretations } from "../interpretations.js"

export async function runManualScenario(ctx: ScenarioContext): Promise<ScenarioResult> {
  const sections: ScenarioSection[] = []
  const suggestedActions: string[] = []

  const lawName = ctx.law?.lawName || ctx.query

  // 병렬: 법령체계(행정규칙 포함) + 연계 조례 + 해석례
  const promises: Promise<{ text: string; isError: boolean }>[] = [
    // 법령체계도 (행정규칙=훈령/예규/고시 포함)
    callTool(getLawSystemTree, ctx.apiClient, {
      ...(ctx.law?.mst ? { mst: ctx.law.mst } : { lawName }),
      apiKey: ctx.apiKey,
    }),
    // 법령해석례 (유권해석/질의회신)
    callTool(searchInterpretations, ctx.apiClient, {
      query: lawName,
      display: 5,
      apiKey: ctx.apiKey,
    }),
  ]

  // 법령 정보 있으면 연계 조례도 검색
  if (ctx.law) {
    promises.push(
      callTool(getLinkedOrdinances, ctx.apiClient, {
        query: ctx.law.lawName,
        display: 10,
        apiKey: ctx.apiKey,
      })
    )
  }

  const results = await Promise.all(promises)
  const [treeR, interpR, ordinR] = results

  if (!treeR.isError && treeR.text.trim()) {
    sections.push({ title: "법령체계 + 행정규칙 (훈령·예규·고시)", content: treeR.text })
  }

  if (!interpR.isError && interpR.text.trim()) {
    sections.push({ title: "법령해석례 (유권해석·질의회신)", content: interpR.text })
  }

  if (ordinR && !ordinR.isError && ordinR.text.trim()) {
    sections.push({ title: "연계 자치법규 (조례 특칙)", content: ordinR.text })
  }

  // 후속 액션
  suggestedActions.push(
    `${lawName} 서식 별지`,
    `${lawName} 수수료 별표`,
    `${lawName} 처리기한`,
    `${lawName} 관련 조례`,
  )

  return { sections, suggestedActions }
}
