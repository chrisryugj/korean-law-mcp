/**
 * search_law 0건 폴백 사다리
 *
 * 국가법령(target=law) 검색이 0건이어도 "그런 규범이 없다"는 뜻이 아니다.
 * 미시행(공포만 됨)·폐지·행정규칙·자치법규는 각각 다른 색인에 있어서 현행 법령
 * 검색에 잡히지 않는다. 사다리를 순서대로 타 내려가며 "어느 색인에 있는지"를
 * 알려주는 것이 0건 응답보다 언제나 낫다.
 */

import type { LawApiClient } from "../lib/api-client.js"
import { truncateResponse } from "../lib/schemas.js"
import { noResultHint } from "../lib/errors.js"
import { isRegionToken } from "../lib/query-extract.js"
import { buildUpcomingNotes, fetchUpcomingLaws, UPCOMING_CHECK_FAILED_NOTE, type UpcomingLaw } from "../lib/upcoming-laws.js"
import { buildAbolishedLawNotes, findAbolishedLaws } from "../lib/abolished-laws.js"
import { searchAdminRule } from "./admin-rule.js"
import { searchOrdinance } from "./ordinance-search.js"

type ToolResult = { content: Array<{ type: string, text: string }>, isError?: boolean }

const asText = (text: string): ToolResult => ({
  content: [{ type: "text", text: truncateResponse(text) }],
})

// '광진구 복무 조례'처럼 조례 키워드나 지역명 토큰(○○시/군/구)이 있으면 자치법규 쿼리로 판단.
// '도'는 도로법·양도세 등 오탐이 많아 제외. 토큰 3자 미만('구', '시')도 제외.
// 접미사만 보면 '재청구'·'선거구'도 지역이 된다 — 그 판정은 isRegionToken 단일 원본(#104)이
// 한다. 여기에 블랙리스트를 베껴 두면 어휘가 늘 때 한쪽만 알게 된다.
/** 테스트 도달용 공개 — 프로덕션 소비자는 이 파일 안뿐이다 (#143) */
export function looksLikeOrdinanceQuery(query: string): boolean {
  if (query.includes("조례")) return true
  return query.split(/\s+/).some((t) => t.length >= 3 && /[시군구]$/.test(t) && isRegionToken(t))
}

export async function searchLawFallbacks(
  apiClient: LawApiClient,
  input: { query: string, display: number, apiKey?: string },
  upcomingPromise: Promise<UpcomingLaw[] | null> = fetchUpcomingLaws(apiClient, input.query, input.apiKey),
): Promise<ToolResult> {
  // 공포됐지만 미시행인 신규 법령은 현행(target=law) 검색에 안 잡힘 → 시행예정 보조검색.
  // 폐지 이력(eflaw 연혁) 확인과 서로 독립이라 같이 기다린다(종전 순차 2왕복, 리뷰 A3).
  const [upcomingOnly, abolishedR] = await Promise.all([
    upcomingPromise,
    // 폐지 조회가 예산 소진으로 던져도 시행예정 결과가 있으면 그걸 먼저 돌려준다(아래에서 재전파)
    findAbolishedLaws(apiClient, input.query, input.apiKey).then(
      laws => ({ laws, error: undefined }),
      (error: unknown) => ({ laws: [], error }),
    ),
  ])
  if (upcomingOnly && upcomingOnly.length > 0) {
    return asText(
      `현행 법령 0건 — 단, 공포 후 시행 대기 중인 법령이 있습니다:\n\n` +
      buildUpcomingNotes([], upcomingOnly) +
      `⚠️ 현재 시점에는 아직 효력이 없는 법령입니다. 현행 기준 답변에 인용하지 마세요.\n`
    )
  }

  // 폐지된 법령은 현행 검색에 안 잡힘 → eflaw 연혁에서 폐지 이력 확인 (사법시험법 등)
  if (abolishedR.error) throw abolishedR.error
  const abolishedLaws = abolishedR.laws
  if (abolishedLaws.length > 0) {
    return asText(buildAbolishedLawNotes(input.query, abolishedLaws))
  }

  // 외국환거래규정·은행업감독규정 등 "규정/고시"는 행정규칙(고시)임.
  const adminFallback = await searchAdminRule(apiClient, {
    query: input.query,
    display: input.display,
    apiKey: input.apiKey,
  }).catch(() => null)

  if (adminFallback && !adminFallback.isError) {
    return asText(
      `[FALLBACK] 법령 '${input.query}' 0건 → 행정규칙으로 자동 폴백.\n` +
      `💡 '규정/고시/훈령/예규/지침'은 행정규칙이며 search_admin_rule이 본 도구입니다.\n\n` +
      (adminFallback.content[0]?.text || "")
    )
  }

  // 조례·규칙(지자체)은 자치법규라 국가법령 검색에 안 잡힘.
  if (looksLikeOrdinanceQuery(input.query)) {
    const ordinFallback = await searchOrdinance(apiClient, {
      query: input.query,
      display: Math.min(input.display, 100),
      apiKey: input.apiKey,
    }).catch(() => null)

    if (ordinFallback && !ordinFallback.isError) {
      return asText(
        `[FALLBACK] 법령 '${input.query}' 0건 → 자치법규로 자동 폴백.\n` +
        `💡 조례·규칙(지자체)은 자치법규이며 search_ordinance(execute_tool 경유)가 본 도구입니다.\n\n` +
        (ordinFallback.content[0]?.text || "")
      )
    }
  }

  const none = noResultHint(input.query, "법령")
  // 시행예정 확인이 실패한 채 "없음"만 말하면 공포 후 미시행 법령을 부존재로 단정하게 된다
  if (upcomingOnly === null) none.content[0].text += `\n${UPCOMING_CHECK_FAILED_NOTE}`
  return none
}
