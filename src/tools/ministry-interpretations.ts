/**
 * 중앙부처 1차 해석 — search_decisions/get_decision_text 의 domain="ministry" (#182)
 *
 * options.ministry(부처 코드·부처명·옛 이름)로 39개 부처의 `<코드>CgmExpc` 를 고른다.
 * 목록·본문 구조는 관세청·고용노동부와 같아 customs-interpretations 의 target 분기 핸들러를 그대로 쓴다.
 * 국세청·재정경제부는 법제처 본문이 없고 상세링크가 taxlaw 라, 본문은 ntstDcmId 로 국세청 경로를 탄다.
 */
import type { LawApiClient } from "../lib/api-client.js"
import type { LooseToolResponse } from "../lib/types.js"
import { resolveMinistry, ministryLabel, ministryListText } from "../lib/cgm-expc-ministries.js"
import {
  searchCgmExpcByTarget, getCgmExpcTextByTarget, getNtsInterpretationText, extractNtstDcmId,
  type SearchCustomsInterpretationsInput, type GetCustomsInterpretationTextInput,
} from "./customs-interpretations.js"

/** 본문이 taxlaw 에만 있는 부처 */
const TAXLAW_BODY = new Set(["nts", "moef"])

function unknownMinistry(value: unknown): LooseToolResponse {
  const given = typeof value === "string" && value.trim() ? `'${value}'은(는) 알 수 없는 부처입니다.` : "options.ministry 가 필요합니다."
  return {
    content: [{ type: "text", text: `[INVALID_ARGUMENT] ${given}\n부처 코드 또는 부처명을 options.ministry 로 넘기세요: ${ministryListText()}` }],
    isError: true,
  }
}

export async function searchMinistryInterpretations(
  apiClient: LawApiClient,
  args: SearchCustomsInterpretationsInput & { ministry?: unknown }
): Promise<LooseToolResponse> {
  const code = resolveMinistry(args.ministry)
  if (!code) return unknownMinistry(args.ministry)
  return searchCgmExpcByTarget(apiClient, args, `${code}CgmExpc`)
}

export async function getMinistryInterpretationText(
  apiClient: LawApiClient,
  args: GetCustomsInterpretationTextInput & { ministry?: unknown }
): Promise<LooseToolResponse> {
  if (extractNtstDcmId(args.id)) return getNtsInterpretationText(apiClient, args)
  const code = resolveMinistry(args.ministry)
  if (!code) return unknownMinistry(args.ministry)
  if (TAXLAW_BODY.has(code)) {
    return {
      content: [{
        type: "text",
        text: `[NOT_SUPPORTED] ${ministryLabel(code)} 법령해석은 법제처 OPEN API에서 본문 조회를 제공하지 않습니다.\n\n` +
          `입력 ID: ${args.id}\n` +
          `검색 결과의 '본문조회ID(ntstDcmId)'(18자리) 또는 '링크'(taxlaw.nts.go.kr) 주소를 id로 넘기세요.\n\n` +
          `⚠️ LLM은 본문을 추측/생성하지 말고, 검색 결과에 포함된 링크를 그대로 사용자에게 안내하세요.`,
      }],
      isError: true,
    }
  }
  return getCgmExpcTextByTarget(apiClient, args, `${code}CgmExpc`)
}
