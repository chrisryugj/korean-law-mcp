/**
 * Scenario 공통 타입
 * 체인 도구의 scenario 확장을 위한 인터페이스
 */
import type { LawApiClient } from "../../lib/api-client.js"
import type { LooseToolResponse } from "../../lib/types.js"

/** 시나리오 실행 결과: 추가 섹션 + 후속 액션 제안 */
export interface ScenarioResult {
  /** 추가로 표시할 섹션 배열 (▶ title + content) */
  sections: ScenarioSection[]
  /** 사용자에게 제안할 후속 쿼리 */
  suggestedActions: string[]
}

export interface ScenarioSection {
  title: string
  content: string
  /** true면 조회 실패 — 간략 표시 */
  isError?: boolean
}

/** 시나리오 공통 컨텍스트 (체인에서 이미 확보한 정보 전달) */
export interface ScenarioContext {
  apiClient: LawApiClient
  query: string
  /** 체인이 검색한 법령 정보 */
  law?: {
    lawName: string
    lawId: string
    mst: string
    lawType: string
  }
  apiKey?: string
  /** 시나리오별 추가 파라미터 (time_travel: fromDate/toDate, action_plan: situation 등) */
  extras?: Record<string, unknown>
}

/** 지원하는 시나리오 목록 */
export type ScenarioType =
  | "penalty"       // chain_action_basis: 처분·벌칙 기준 종합
  | "customs"       // chain_full_research: 관세·통관 종합
  | "manual"        // chain_procedure_detail: 공무원 처리 매뉴얼
  | "delegation"    // chain_law_system: 위임입법 미이행 감시
  | "impact"        // chain_law_system: 법령 개정 영향도
  | "timeline"      // chain_amendment_track: 시계열 타임라인 (판례·해석례 매핑)
  | "time_travel"   // chain_amendment_track: 두 시점 본문 자동 diff (v4.0)
  | "compliance"    // chain_ordinance_compare: 상위법 적합성
  | "action_plan"   // chain_full_research: 시민 친화 step-by-step 가이드 (v4.0)

/** callTool 래퍼 — 체인과 동일 시그니처 */
export async function callTool(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (apiClient: LawApiClient, input: any) => Promise<LooseToolResponse>,
  apiClient: LawApiClient,
  input: Record<string, unknown>
): Promise<{ text: string; isError: boolean }> {
  try {
    const result = await handler(apiClient, input)
    return { text: result.content?.[0]?.text || "", isError: !!result.isError }
  } catch (e) {
    return { text: `오류: ${e instanceof Error ? e.message : String(e)}`, isError: true }
  }
}

/** ScenarioSection → 포맷팅된 문자열 */
export function formatSections(sections: ScenarioSection[]): string {
  return sections
    .map(s => {
      if (s.isError) {
        return s.content ? `\n▶ ${s.title} (조회 실패: ${s.content.slice(0, 80)})\n` : `\n▶ ${s.title} (조회 실패)\n`
      }
      if (!s.content?.trim()) return ""
      return `\n▶ ${s.title}\n${s.content}\n`
    })
    .filter(Boolean)
    .join("")
}

/** suggested_actions → 포맷팅된 문자열 */
export function formatSuggestedActions(actions: string[]): string {
  if (actions.length === 0) return ""
  const lines = actions.map((a, i) => `${i + 1}. "${a}"`)
  return `\n━━━ 이어서 할 수 있는 조회 ━━━\n${lines.join("\n")}\n`
}
