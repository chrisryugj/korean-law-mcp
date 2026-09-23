/**
 * Scenario: penalty — 처분·벌칙 기준 종합 조회기
 * 호스트 체인: chain_action_basis
 *
 * 추가 조회: 별표(처분기준표) + 감경/취소 행심 + 벌칙 조항(법령 본문의 벌칙 장)
 */
import type { ScenarioContext, ScenarioResult, ScenarioSection, ScenarioResource } from "./types.js"
import { callTool, pushResultSection } from "./types.js"

/** 이 시나리오가 응답에 싣는 자원 — 별표(행정처분/과태료 기준표)를 ctx.law 기준으로 싣는다 */
export const PROVIDES: ScenarioResource[] = ["annex"]
import { getAnnexes } from "../annex.js"
import { searchAdminAppeals } from "../admin-appeals.js"
import { toArray } from "../../lib/xml-parser.js"
import { cleanHtml, flattenContent, formatArticleUnit } from "../../lib/article-parser.js"

/** 벌칙 조항 발췌 상한(자). 벌칙 장은 수십 조라 통째로 실으면 체인의 다른 섹션 몫까지 먹는다 */
const PENALTY_EXCERPT_MAX = 12_000

/** 장 머리(조문여부=전문) 중 "제N장" 급. 절·관 머리는 장 구분을 바꾸지 않는다 */
const CHAPTER_HEAD_RE = /제\s*\d+\s*장/
const PENALTY_CHAPTER_RE = /벌\s*칙|과\s*태\s*료/
/** 장 구조가 없는 법령의 대체 선별: 조문 제목 */
const PENALTY_TITLE_RE = /벌칙|과태료|양벌/

/**
 * 법령 JSON 에서 벌칙·과태료 조문만 골라 싣는다 (2026-09-23 리뷰 B#9).
 * 벌칙 장(章) 머리 뒤 다음 장 머리 전까지가 1순위다. 양벌규정·몰수처럼 제목에 "벌칙"이 없는 조문도
 * 장 단위로 함께 잡힌다. 장 구조가 없는 법령은 조문 제목으로 고른다.
 */
export function extractPenaltyArticles(lawJson: unknown): { text: string; labels: string[] } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const units = toArray<any>((lawJson as any)?.법령?.조문?.조문단위)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let picked: any[] = []
  let inPenaltyChapter = false
  for (const u of units) {
    if (u?.조문여부 === "전문") {
      const head = cleanHtml(flattenContent(u.조문내용))
      if (CHAPTER_HEAD_RE.test(head)) inPenaltyChapter = PENALTY_CHAPTER_RE.test(head)
      continue
    }
    if (inPenaltyChapter && u?.조문여부 === "조문") picked.push(u)
  }
  if (picked.length === 0) {
    picked = units.filter(u => u?.조문여부 === "조문" && PENALTY_TITLE_RE.test(String(u.조문제목 || "")))
  }

  const labels: string[] = []
  const blocks: string[] = []
  let used = 0
  let omitted = 0
  for (const unit of picked) {
    const formatted = formatArticleUnit(unit)
    if (!formatted) continue
    labels.push(formatted.header.split(" ")[0])
    const block = [formatted.header, formatted.body].filter(Boolean).join("\n")
    if (blocks.length > 0 && used + block.length > PENALTY_EXCERPT_MAX) {
      omitted++
      continue
    }
    blocks.push(block)
    used += block.length
  }
  let text = blocks.join("\n\n")
  if (omitted > 0) text += `\n\n… 외 ${omitted}개 조문 생략 (get_law_text 의 jo 로 개별 조회)`
  return { text, labels }
}

async function fetchLawJson(ctx: ScenarioContext, mst: string): Promise<{ json: unknown } | { error: string }> {
  try {
    return { json: JSON.parse(await ctx.apiClient.getLawText({ mst, apiKey: ctx.apiKey })) }
  } catch (e) {
    return { error: `오류: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export async function runPenaltyScenario(ctx: ScenarioContext): Promise<ScenarioResult> {
  const sections: ScenarioSection[] = []
  const suggestedActions: string[] = []

  if (!ctx.law) {
    return { sections, suggestedActions }
  }

  const { lawName, lawId, mst } = ctx.law

  // 병렬 실행: 별표(처분기준표) + 감경 행심 + 벌칙 조문. 이 시나리오가 action_basis 체인의
  // 최장 구간이라 한 왕복이 그대로 체감 지연이다(#131).
  // 벌칙 조문은 법령 JSON 을 한 번 받아 벌칙 장을 골라낸다 (2026-09-23 리뷰 B#9). 종전엔 get_law_text 에
  // 없는 인자 search:"벌칙" 을 넘겼는데, 시나리오 callTool 은 Zod 를 거치지 않아 인자가 조용히 버려졌고
  // 법령 전체 목차가 "벌칙·과태료 조항"이라는 제목으로 나갔다.
  const [annexR, appealR, lawJsonR] = await Promise.all([
    callTool(getAnnexes, ctx.apiClient, { lawName, apiKey: ctx.apiKey }),
    callTool(searchAdminAppeals, ctx.apiClient, {
      query: `${lawName} 감경`,
      display: 5,
      apiKey: ctx.apiKey,
    }),
    fetchLawJson(ctx, mst),
  ])

  pushResultSection(sections, "별표 (행정처분/과태료 기준표)", annexR)

  let penaltyLabels: string[] = []
  if ("error" in lawJsonR) {
    sections.push({ title: "벌칙·과태료 조항", content: lawJsonR.error, isError: true })
  } else if (!(lawJsonR.json as { 법령?: { 조문?: unknown } })?.법령?.조문) {
    // 빈 봉투를 "이 본문에서 벌칙 조문을 찾지 못했다"로 쓰면 본문을 확인한 것처럼 읽힌다
    sections.push({ title: "벌칙·과태료 조항", content: `법령 본문을 받지 못했습니다(빈 응답). get_law_text(mst="${mst}")로 재조회하세요.`, isError: true })
  } else {
    const { text, labels } = extractPenaltyArticles(lawJsonR.json)
    penaltyLabels = labels
    sections.push({
      title: "벌칙·과태료 조항",
      content: text || `[NOT_FOUND] 이 법령 본문에서 벌칙 장이나 벌칙·과태료 조문을 찾지 못했습니다. get_law_text(mst="${mst}")로 목차를 확인하세요.`,
    })
  }

  pushResultSection(sections, "감경·취소 행정심판례", appealR)

  // 개정이력: get_article_history(lawId) 는 벌칙 조항이 아니라 법령 전체 조문의 1948년 이후 전건이다.
  // amendment_track 이 #158 에서 opt-in 으로 돌린 바로 그 섹션이라, 여기서는 받지 않고 조회 경로만 남긴다 (B#9)
  if (lawId) {
    const listed = penaltyLabels.slice(0, 8).join("·")
    const more = penaltyLabels.length > 8 ? ` 외 ${penaltyLabels.length - 8}개` : ""
    sections.push({
      title: "벌칙 조항 개정이력",
      content: `[생략] 법령 전체 조문의 제정 이후 이력이라 응답 상한을 소진합니다. 조문별로 조회하세요: ` +
        `get_article_history(lawId="${lawId}", jo="${penaltyLabels[0] || "제N조"}")` +
        (listed ? `\n대상 조문: ${listed}${more}` : ""),
    })
  }

  // 후속 액션 제안
  suggestedActions.push(
    `${lawName} 과태료 불복 방법`,
    `${lawName} 감경 판례`,
    `${lawName} 시행령 처분기준 별표`,
  )

  return { sections, suggestedActions }
}
