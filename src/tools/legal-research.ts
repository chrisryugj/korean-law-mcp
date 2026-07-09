/**
 * legal_research — 체인 8개 통합 진입점 (v4.4.0)
 *
 * 기존 chain_* 8개를 task 파라미터 하나로 통합해 MCP 노출 도구 수와
 * ListTools 컨텍스트 비용을 줄인다. 기존 chain_* 도구는 allTools에
 * 그대로 남아 직접 호출/execute_tool 경유가 계속 동작한다 (하위호환).
 *
 * task별 허용 scenario는 체인 스키마(chains.ts)에서 직접 파생 —
 * 별도 호환표를 두지 않아 체인 쪽 enum 변경 시 자동 추종된다 (v4.4.1).
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import type { LooseToolResponse } from "../lib/types.js"
import {
  chainLawSystem, chainLawSystemSchema,
  chainActionBasis, chainActionBasisSchema,
  chainDisputePrep,
  chainAmendmentTrack, chainAmendmentTrackSchema,
  chainOrdinanceCompare, chainOrdinanceCompareSchema,
  chainFullResearch, chainFullResearchSchema,
  chainProcedureDetail, chainProcedureDetailSchema,
  chainDocumentReview,
} from "./chains.js"

const TASK_VALUES = new Set([
  "full_research", "law_system", "action_basis", "dispute_prep",
  "amendment_track", "ordinance_compare", "procedure_detail", "document_review",
])

// LLM이 scenario 값(penalty 등)을 task 자리에 잘못 넣어 툴콜이 실패하던 문제를 흡수한다 (v4.7.1).
// description이 "action_basis=penalty"처럼 task·scenario를 한 줄에 섞어 설명해 오인이 잦다.
// 잘못 온 scenario 값은 scenario로 옮기고 task는 호환 task로 승격, 그 외 미지의 값은 full_research로 폴백.
const SCENARIO_TO_TASK: Record<string, string> = {
  penalty: "action_basis",
  delegation: "law_system", impact: "law_system",
  timeline: "amendment_track", time_travel: "amendment_track",
  compliance: "ordinance_compare",
  customs: "full_research", action_plan: "full_research",
  manual: "procedure_detail",
}

export const LegalResearchSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object") return raw
  const o = { ...(raw as Record<string, unknown>) }
  const t = o.task
  if (typeof t === "string" && !TASK_VALUES.has(t)) {
    if (SCENARIO_TO_TASK[t]) {
      if (o.scenario == null) o.scenario = t
      o.task = SCENARIO_TO_TASK[t]
    } else {
      o.task = "full_research"
    }
  }
  return o
}, z.object({
  query: z.string().optional()
    .describe("자연어 질문/법령명/키워드 (예: '음주운전 처벌 기준', '관세법 체계'). document_review 외 모든 task에서 필수"),
  task: z.enum([
    "full_research", "law_system", "action_basis", "dispute_prep",
    "amendment_track", "ordinance_compare", "procedure_detail", "document_review",
  ]).optional().default("full_research")
    .describe("리서치 유형 (도구 설명의 task 표 참조). 미지정 시 full_research"),
  scenario: z.enum([
    "delegation", "impact", "penalty", "timeline", "time_travel",
    "compliance", "customs", "action_plan", "manual",
  ]).optional()
    .describe("확장 시나리오. 미지정 시 쿼리에서 자동 감지. task별 호환: law_system=delegation·impact | action_basis=penalty | amendment_track=timeline·time_travel | ordinance_compare=compliance | full_research=customs·action_plan | procedure_detail=manual"),
  domain: z.enum(["tax", "labor", "privacy", "competition", "general"]).optional()
    .describe("[dispute_prep] 전문 분야 (tax=조세심판, labor=노동위, privacy=개인정보위, competition=공정위). 미지정 시 자동 감지"),
  articles: z.array(z.string()).optional()
    .describe("[law_system] 함께 조회할 조문 번호 (예: ['제38조'])"),
  parentLaw: z.string().optional()
    .describe("[ordinance_compare] 상위 법령명. 미지정 시 자동 검색"),
  mst: z.string().optional().describe("[amendment_track] 법령일련번호 (알고 있으면)"),
  lawId: z.string().optional().describe("[amendment_track] 법령ID (알고 있으면)"),
  fromDate: z.string().regex(/^\d{8}$/).optional()
    .describe("[time_travel] 비교 시작 시점 YYYYMMDD"),
  toDate: z.string().regex(/^\d{8}$/).optional()
    .describe("[time_travel] 비교 종료 시점 YYYYMMDD"),
  text: z.string().optional()
    .describe("[document_review 전용·필수] 검토할 계약서/약관 전문 텍스트"),
  maxClauses: z.number().min(1).max(30).optional()
    .describe("[document_review] 최대 분석 조항 수 (기본 15)"),
  apiKey: z.string().optional(),
}))

export type LegalResearchInput = z.infer<typeof LegalResearchSchema>

type ToolResponse = LooseToolResponse

function inputError(message: string): ToolResponse {
  return { content: [{ type: "text", text: message }], isError: true }
}

/**
 * 체인 스키마의 scenario 필드로 입력 scenario를 검증한다.
 * 비호환이면 버리고(자동 감지로 폴백) 경고 노트를 함께 반환 —
 * 호출 LLM이 자기 파라미터가 무시된 것을 알 수 있게 한다.
 */
export function pickScenario<S extends z.ZodType>(
  schema: S, scenario: string | undefined, task: string
): { value: z.infer<S>; note?: string } {
  const result = schema.safeParse(scenario)
  if (result.success) return { value: result.data as z.infer<S> }
  return {
    value: undefined as z.infer<S>,
    note: `⚠ scenario=${scenario}는 task=${task}와 비호환이라 무시하고 자동 감지로 대체했습니다.`,
  }
}

/** 경고 노트를 응답 첫 줄에 주입 */
export function withNote(note: string | undefined, res: ToolResponse): ToolResponse {
  if (!note) return res
  return { ...res, content: [{ type: "text", text: note }, ...res.content] }
}

/** scenario 필드가 없는 task에 scenario가 들어온 경우의 경고 */
function droppedNote(scenario: string | undefined, task: string): string | undefined {
  return scenario
    ? `⚠ task=${task}는 scenario를 지원하지 않아 scenario=${scenario}를 무시했습니다.`
    : undefined
}

export async function legalResearch(
  apiClient: LawApiClient,
  input: LegalResearchInput
): Promise<ToolResponse> {
  const task = input.task ?? "full_research"

  if (task === "document_review") {
    if (!input.text) return inputError("task=document_review에는 text(문서 전문)가 필요합니다.")
    return withNote(droppedNote(input.scenario, task), await chainDocumentReview(apiClient, {
      text: input.text,
      maxClauses: input.maxClauses ?? 15,
      apiKey: input.apiKey,
    }))
  }

  if (!input.query) return inputError(`task=${task}에는 query가 필요합니다.`)
  const query = input.query
  const apiKey = input.apiKey

  switch (task) {
    case "law_system": {
      const { value: scenario, note } = pickScenario(chainLawSystemSchema.shape.scenario, input.scenario, task)
      return withNote(note, await chainLawSystem(apiClient, {
        query, articles: input.articles, scenario, apiKey,
      }))
    }
    case "action_basis": {
      const { value: scenario, note } = pickScenario(chainActionBasisSchema.shape.scenario, input.scenario, task)
      return withNote(note, await chainActionBasis(apiClient, { query, scenario, apiKey }))
    }
    case "dispute_prep":
      return withNote(droppedNote(input.scenario, task),
        await chainDisputePrep(apiClient, { query, domain: input.domain, apiKey }))
    case "amendment_track": {
      const { value: scenario, note } = pickScenario(chainAmendmentTrackSchema.shape.scenario, input.scenario, task)
      return withNote(note, await chainAmendmentTrack(apiClient, {
        query, mst: input.mst, lawId: input.lawId, scenario,
        fromDate: input.fromDate, toDate: input.toDate, apiKey,
      }))
    }
    case "ordinance_compare": {
      const { value: scenario, note } = pickScenario(chainOrdinanceCompareSchema.shape.scenario, input.scenario, task)
      return withNote(note, await chainOrdinanceCompare(apiClient, {
        query, parentLaw: input.parentLaw, scenario, apiKey,
      }))
    }
    case "procedure_detail": {
      const { value: scenario, note } = pickScenario(chainProcedureDetailSchema.shape.scenario, input.scenario, task)
      return withNote(note, await chainProcedureDetail(apiClient, { query, scenario, apiKey }))
    }
    case "full_research":
    default: {
      const { value: scenario, note } = pickScenario(chainFullResearchSchema.shape.scenario, input.scenario, task)
      return withNote(note, await chainFullResearch(apiClient, { query, scenario, apiKey }))
    }
  }
}
