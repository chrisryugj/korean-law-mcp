/**
 * Scenario: action_plan — 시민 친화 step-by-step 가이드 (v4.0)
 * 호스트 체인: chain_full_research
 *
 * 처리: 시민이 처한 상황(전세금/해고/음주 등) → 5단계 실행 가이드 자동 생성
 *   STEP 1. 상황 진단 (적용 법령/조문)
 *   STEP 2. 권리 / 구제 수단
 *   STEP 3. 신청 기관 / 기한
 *   STEP 4. 필요 서류 / 양식
 *   STEP 5. 함정 / 주의 (패소·각하 사유)
 */
import type { ScenarioContext, ScenarioResult, ScenarioSection } from "./types.js"
import { callTool } from "./types.js"
import { getAnnexes } from "../annex.js"
import { searchAdminRule } from "../admin-rule.js"
import { searchPrecedents } from "../precedents.js"
import { searchInterpretations } from "../interpretations.js"
import { findLaws } from "../../lib/law-search.js"

/** 시민 시나리오 → 핵심 명사구 추출 + 도메인 매핑 */
function extractActionKeyword(query: string): { keyword: string; domain?: string } {
  let q = query
    // 어미·어말 통째 제거 (단어 경계 무시)
    .replace(/받았어요?|걸렸어요?|당했어요?|돼요?\??|되나요?\??/g, " ")
    .replace(/어떻게|얼마|언제|어디서|왜|뭐|뭘|뭐\s*해야/g, " ")
    .replace(/못\s*받|안\s*돼|안\s*해|안\s*나/g, " ")
    .replace(/거부|취소|위반|당하|받|걸리|되니/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  // 시민 키워드 → 법률 도메인 매핑 (검색 정확도 향상)
  const domainMap: Array<[RegExp, string]> = [
    [/전세금|전세\s*보증금|보증금\s*반환/, "주택임대차보호법 보증금"],
    [/해고|부당\s*해고|징계\s*해고/, "근로기준법 부당해고"],
    [/음주\s*운전|음주\s*단속|면허\s*취소/, "도로교통법 음주운전"],
    [/체불|임금\s*체불|월급/, "근로기준법 임금"],
    [/산업\s*재해|산재/, "산업재해보상보험법"],
    [/이혼|위자료|양육비/, "민법 이혼"],
    [/사기|기망|편취/, "형법 사기"],
    [/폭행|상해/, "형법 폭행"],
    [/성희롱|직장\s*내\s*괴롭힘/, "남녀고용평등법"],
    [/하자|하자보수|하자담보/, "민법 하자담보"],
  ]
  for (const [re, mapped] of domainMap) {
    if (re.test(query)) return { keyword: mapped, domain: mapped.split(" ")[0] }
  }

  return { keyword: q || query }
}

export async function runActionPlanScenario(ctx: ScenarioContext): Promise<ScenarioResult> {
  const sections: ScenarioSection[] = []
  const suggestedActions: string[] = []

  const { keyword, domain } = extractActionKeyword(ctx.query)
  const searchKeyword = domain || keyword

  // 법령이 chain에서 안 잡혔으면 도메인 매핑으로 재시도
  let lawName = ctx.law?.lawName
  if (!lawName && domain) {
    try {
      const found = await findLaws(ctx.apiClient, domain, ctx.apiKey, 1)
      if (found.length > 0) lawName = found[0].lawName
    } catch { /* ignore */ }
  }

  // 병렬: 절차 행정규칙 + 별표/서식 + 판례 + 해석례
  const [adminR, annexR, precR, interpR] = await Promise.all([
    callTool(searchAdminRule, ctx.apiClient, {
      query: searchKeyword,
      display: 5,
      apiKey: ctx.apiKey,
    }),
    lawName
      ? callTool(getAnnexes, ctx.apiClient, { lawName, apiKey: ctx.apiKey })
      : Promise.resolve({ text: "", isError: true }),
    callTool(searchPrecedents, ctx.apiClient, {
      query: searchKeyword,
      display: 5,
      apiKey: ctx.apiKey,
    }),
    callTool(searchInterpretations, ctx.apiClient, {
      query: searchKeyword,
      display: 3,
      apiKey: ctx.apiKey,
    }),
  ])

  // STEP 1: 상황 진단
  const step1 = lawName
    ? `🔍 적용 법령: ${lawName}\n   (이 사안은 ${lawName}의 적용을 받습니다. 상세 조문은 위 '${lawName} 본문' 섹션 참조)`
    : `⚠️ 적용 법령을 자동 식별하지 못했습니다. 키워드를 더 구체적으로 입력하세요. (예: '전세금 못 받았어' → '주택 임대차 보증금 반환')`
  sections.push({ title: "STEP 1 ─ 상황 진단", content: step1 })

  // STEP 2: 권리 / 구제 수단 (핵심 판례에서 추출)
  if (!precR.isError && precR.text.trim()) {
    const lines = precR.text.split("\n").filter(l => l.trim()).slice(0, 6)
    sections.push({
      title: "STEP 2 ─ 권리·구제 수단 (실제 판례 시그널)",
      content: lines.join("\n") + "\n\n💡 위 판례들의 '패소 사유'를 역으로 보면 '승소 조건'이 됩니다.",
    })
  } else {
    sections.push({
      title: "STEP 2 ─ 권리·구제 수단",
      content: "관련 판례 자동 추출 실패. 위 '관련 판례' 섹션을 참조하세요.",
    })
  }

  // STEP 3: 신청 기관 / 기한
  const interpText = !interpR.isError && interpR.text.trim()
    ? interpR.text.split("\n").slice(0, 8).join("\n")
    : "기한 관련 해석례 없음 — 일반 시효(민법상 채권 10년, 손해배상 3년) 확인 필요"
  const adminText = !adminR.isError && adminR.text.trim()
    ? adminR.text.split("\n").slice(0, 5).join("\n")
    : "관할 행정규칙 자동 추출 실패"
  sections.push({
    title: "STEP 3 ─ 신청 기관 / 기한",
    content: `[행정규칙 — 처리 기관 단서]\n${adminText}\n\n[법령해석 — 기한 단서]\n${interpText}`,
  })

  // STEP 4: 필요 서류 / 양식
  if (!annexR.isError && annexR.text.trim()) {
    const lines = annexR.text.split("\n").filter(l => l.trim()).slice(0, 15)
    sections.push({
      title: "STEP 4 ─ 필요 서류 / 양식",
      content: lines.join("\n"),
    })
  } else {
    sections.push({
      title: "STEP 4 ─ 필요 서류 / 양식",
      content: "별표/서식 자동 조회 실패. 법령명을 명시한 후 get_annexes를 직접 호출하세요.",
    })
  }

  // STEP 5: 함정 / 주의
  let cautions: string[] = []
  if (lawName) cautions.push(`• 법령은 자주 개정됩니다. ${lawName} 최신 시행일 확인 필수.`)
  cautions.push(`• 시효(권리 행사 기간)를 놓치면 권리 자체가 소멸합니다. STEP 3 기한 반드시 확인.`)
  cautions.push(`• 위 판례·해석례는 사실관계 차이로 본인 사안과 결론이 달라질 수 있습니다.`)
  cautions.push(`• 금전 청구·소송은 변호사 상담을 권장합니다 (법률구조공단 ☎132).`)
  sections.push({
    title: "STEP 5 ─ 함정 / 주의",
    content: cautions.join("\n"),
  })

  // 후속 액션
  if (lawName) {
    suggestedActions.push(
      `${lawName} 처리 절차 수수료`,
      `${lawName} 별표 양식`,
      `${searchKeyword} 행정심판 사례`,
    )
  } else {
    suggestedActions.push(
      `${searchKeyword} 적용 법령`,
      `${searchKeyword} 신청 절차`,
      `${searchKeyword} 행정심판 사례`,
    )
  }

  return { sections, suggestedActions }
}
