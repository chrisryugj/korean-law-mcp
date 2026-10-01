/**
 * Scenario: compliance — 조례 상위법 적합성 검증기
 * 호스트 체인: chain_ordinance_compare
 *
 * 추가 조회: 상위법 위임근거 + 헌재 위헌 판결 + 권익위 심판례
 */
import type { ScenarioContext, ScenarioResult, ScenarioSection } from "./types.js"
import { callTool, pushResultSection } from "./types.js"
import { searchConstitutionalDecisions } from "../constitutional-decisions.js"
import { searchAdminAppeals } from "../admin-appeals.js"
import { getLinkedLawsFromOrdinance } from "../law-linkage.js"

export async function runComplianceScenario(ctx: ScenarioContext): Promise<ScenarioResult> {
  const sections: ScenarioSection[] = []
  const suggestedActions: string[] = []

  // 병렬: 헌재 결정 + 행정심판(조례 위법) + 상위법 연계
  const [constR, appealR, linkedR] = await Promise.all([
    callTool(searchConstitutionalDecisions, ctx.apiClient, {
      query: `조례 위헌`,
      display: 5,
      apiKey: ctx.apiKey,
    }),
    callTool(searchAdminAppeals, ctx.apiClient, {
      query: `조례 위법`,
      display: 5,
      apiKey: ctx.apiKey,
    }),
    callTool(getLinkedLawsFromOrdinance, ctx.apiClient, {
      query: ctx.query,
      display: 10,
      apiKey: ctx.apiKey,
    }),
  ])

  pushResultSection(sections, "조례의 상위법 근거", linkedR)

  pushResultSection(sections, "헌재 결정 (조례 위헌·위법)", constR)

  pushResultSection(sections, "행정심판 (조례 취소 사례)", appealR)

  // 후속 액션
  suggestedActions.push(
    `${ctx.query} 상위법 3단비교`,
    `${ctx.query} 해석례`,
    `${ctx.query} 전국 조례 비교`,
  )

  return { sections, suggestedActions }
}
