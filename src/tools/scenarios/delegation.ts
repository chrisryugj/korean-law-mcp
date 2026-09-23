/**
 * Scenario: delegation — 위임입법 미이행 감시기
 * 호스트 체인: chain_law_system
 *
 * 추가 조회: 법체계(행정규칙 포함) + 조문 이력
 */
import type { ScenarioContext, ScenarioResult, ScenarioSection } from "./types.js"
import { callTool, pushResultSection } from "./types.js"
import { getLawSystemTree } from "../law-system-tree.js"
import { getArticleHistory } from "../article-history.js"

/**
 * 위임법령 연계(lnkDep) 조회는 뺐다 (2026-09-23 리뷰 B#9).
 * 이 목록 API 는 query 를 무시하고 전체 목록(실측 109,918건)을 돌려줘, 1페이지 100건 안에서만
 * 법령명을 거를 수 있다. 실측 '관세법' 매칭 0건: "위임입법 현황" 섹션은 사실상 실리지 못한 채
 * 업스트림 1회만 썼고, 빠진 사실도 알리지 않았다. 대신 무엇을 보라는지 밝힌다.
 */
const DELEGATION_STATUS_NOTE =
  "자동 대조 미제공: 법제처 위임 연계 목록이 법령명 검색 필터를 지원하지 않아 미제정 하위법령을 자동으로 집계하지 못합니다. " +
  "위 '3단 비교' 섹션의 위임 조문(대통령령·부령으로 정한다)과 아래 법체계의 하위법령을 대조하세요. " +
  "LLM은 이 섹션을 근거로 '미이행 위임 없음'이라고 단정하지 마세요."

export async function runDelegationScenario(ctx: ScenarioContext): Promise<ScenarioResult> {
  const sections: ScenarioSection[] = []
  const suggestedActions: string[] = []

  if (!ctx.law) {
    return { sections, suggestedActions }
  }

  const { lawName, lawId, mst } = ctx.law

  // 병렬: 법체계(행정규칙 포함) + 조문 이력
  const [treeR, histR] = await Promise.all([
    // 법체계도 (행정규칙=훈령/예규/고시 포함)
    callTool(getLawSystemTree, ctx.apiClient, {
      mst,
      apiKey: ctx.apiKey,
    }),
    lawId
      ? callTool(getArticleHistory, ctx.apiClient, { lawId, apiKey: ctx.apiKey })
      : Promise.resolve(null),
  ])

  sections.push({ title: "위임입법 현황 (미제정 포함)", content: DELEGATION_STATUS_NOTE })
  pushResultSection(sections, "법체계 + 행정규칙", treeR)
  pushResultSection(sections, "조문별 개정이력 (위임 조항 변동 추적)", histR)

  // 후속 액션
  suggestedActions.push(
    `${lawName} 시행령 체계`,
    `${lawName} 개정이력`,
    `${lawName} 연계 자치법규`,
  )

  return { sections, suggestedActions }
}
