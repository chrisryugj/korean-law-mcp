/**
 * Scenario 통합 실행기
 * 시나리오 타입에 따라 적절한 모듈을 호출하고 결과를 반환
 */
export type { ScenarioType, ScenarioResult, ScenarioContext } from "./types.js"
export { formatSections, formatSuggestedActions } from "./types.js"

import type { ScenarioType, ScenarioContext, ScenarioResult } from "./types.js"
import { runPenaltyScenario } from "./penalty.js"
import { runCustomsScenario } from "./customs.js"
import { runManualScenario } from "./manual.js"
import { runDelegationScenario } from "./delegation.js"
import { runImpactScenario } from "./impact.js"
import { runTimelineScenario } from "./timeline.js"
import { runComplianceScenario } from "./compliance.js"
import { runTimeTravelScenario } from "./time-travel.js"
import { runActionPlanScenario } from "./action-plan.js"

const SCENARIO_RUNNERS: Record<ScenarioType, (ctx: ScenarioContext) => Promise<ScenarioResult>> = {
  penalty: runPenaltyScenario,
  customs: runCustomsScenario,
  manual: runManualScenario,
  delegation: runDelegationScenario,
  impact: runImpactScenario,
  timeline: runTimelineScenario,
  compliance: runComplianceScenario,
  time_travel: runTimeTravelScenario,
  action_plan: runActionPlanScenario,
}

/** 시나리오 실행 — 알 수 없는 타입이면 빈 결과 반환 */
export async function runScenario(
  type: ScenarioType,
  ctx: ScenarioContext
): Promise<ScenarioResult> {
  const runner = SCENARIO_RUNNERS[type]
  if (!runner) {
    return { sections: [], suggestedActions: [] }
  }
  try {
    return await runner(ctx)
  } catch (e) {
    // 시나리오 실패는 체인 전체를 중단시키지 않되, 무음 증발 금지 —
    // 실패 섹션을 반환해 LLM이 "결과 없음"과 "실행 실패"를 구분하게 한다 (secOrSkip과 동일 원칙)
    const msg = e instanceof Error ? e.message : String(e)
    return {
      sections: [{
        title: `시나리오(${type}) [FAILED]`,
        content: `⚠️ 시나리오 실행 실패 — LLM은 이 섹션 내용을 추측/생성하지 마세요.\n사유: ${msg.slice(0, 200)}`,
        isError: true,
      }],
      suggestedActions: [],
    }
  }
}

/** query-router 자동감지용: 쿼리에서 시나리오 타입 추론 */
export function detectScenario(query: string, hostChain: string): ScenarioType | null {
  // 각 체인별 시나리오 감지 패턴
  if (hostChain === "chain_action_basis") {
    if (/과태료|벌칙|벌금|처분\s*기준|영업\s*정지|감경|행정\s*처분|과징금|이행\s*강제금/.test(query)) {
      return "penalty"
    }
  }

  if (hostChain === "chain_full_research") {
    if (/관세|수출|수입|통관|FTA|원산지|HS\s*코드|품목\s*분류|관세사/.test(query)) {
      return "customs"
    }
  }

  if (hostChain === "chain_procedure_detail") {
    if (/처리\s*방법|처리\s*절차|업무\s*매뉴얼|담당|민원|공무원|처리\s*기한/.test(query)) {
      return "manual"
    }
  }

  if (hostChain === "chain_law_system") {
    if (/위임\s*입법|미이행|미제정|위임\s*현황|하위\s*법령\s*제정/.test(query)) {
      return "delegation"
    }
    if (/영향\s*도|영향\s*분석|연쇄\s*개정|파급|하위\s*법령\s*영향/.test(query)) {
      return "impact"
    }
  }

  if (hostChain === "chain_amendment_track") {
    // time_travel 우선 (두 시점 명시 패턴)
    if (/\d{4}\s*[\.\-년]\s*\d{1,2}.*(?:vs|와|과|↔|~|부터|에서)/.test(query) ||
        /시점\s*비교|버전\s*비교|두\s*시점|time\s*travel/i.test(query)) {
      return "time_travel"
    }
    if (/시계열|타임라인|판례\s*변화|해석\s*변화|적용\s*시점|소급/.test(query)) {
      return "timeline"
    }
  }

  if (hostChain === "chain_full_research") {
    // 시민 시나리오 키워드 (action_plan)
    if (/(?:받았어|걸렸어|당했어|돼\?|되나|어떻게\s*해야|뭘\s*해야|뭐\s*해야)/.test(query) ||
        /실행\s*가이드|단계\s*별|step\s*by\s*step|시민\s*가이드|action\s*plan/i.test(query)) {
      return "action_plan"
    }
  }

  if (hostChain === "chain_ordinance_compare") {
    if (/적합성|상위법\s*위반|위법|초과|저촉|법제\s*심사/.test(query)) {
      return "compliance"
    }
  }

  return null
}
