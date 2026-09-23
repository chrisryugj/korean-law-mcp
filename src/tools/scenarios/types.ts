/**
 * Scenario 공통 타입
 * 체인 도구의 scenario 확장을 위한 인터페이스
 */
import type { LawApiClient } from "../../lib/api-client.js"
import type { LooseToolResponse } from "../../lib/types.js"
import type { ScenarioName } from "../../lib/scenario-rules.js"

/**
 * 시나리오가 응답에 이미 싣는 자원.
 * 체인은 이 선언을 읽고 같은 것을 중복 조회하지 않는다 — 체인 쪽에 시나리오 이름을
 * 하드코딩하면 별표를 싣는 새 시나리오가 생길 때마다 중복이 되살아난다(#131).
 */
export type ScenarioResource = "annex"

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

/**
 * 지원하는 시나리오 목록.
 * 이름·소속 체인·감지 어휘의 원본은 lib/scenario-rules.ts 하나다 (#101).
 */
export type ScenarioType = ScenarioName

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

/**
 * 조회 결과 하나를 섹션으로 싣는다 (2026-09-23 리뷰 B#9).
 * 0건([NOT_FOUND])·빈 결과는 종전대로 싣지 않되, 조회 실패는 isError 섹션으로 남긴다. 종전엔 실패도
 * 조용히 빠졌는데, 별표를 싣는 시나리오(PROVIDES annex)가 붙으면 체인이 제 별표 조회를 건너뛰므로
 * 시나리오의 별표 실패가 흔적 없이 사라졌다.
 */
export function pushResultSection(
  sections: ScenarioSection[],
  title: string,
  result: { text: string; isError: boolean } | null
): void {
  if (!result) return
  if (!result.isError && result.text.trim()) {
    sections.push({ title, content: result.text })
  } else if (result.isError && !/\[NOT_FOUND\]/.test(result.text)) {
    sections.push({ title, content: result.text || "원인 미상", isError: true })
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
