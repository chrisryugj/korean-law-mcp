/**
 * Scenario: time_travel — 두 시점 법령 본문 자동 diff (v4.0)
 * 호스트 체인: chain_amendment_track
 *
 * 입력 (extras): fromDate (YYYYMMDD), toDate (YYYYMMDD)
 * 처리:
 *   1. 법령의 연혁(searchHistoricalLaw)에서 두 시점에 해당하는 MST 결정
 *      - "해당 시점에 시행 중이었던 버전" = efYd <= 시점 중 가장 큰 efYd
 *   2. 두 MST의 본문을 raw API로 직접 가져와 조문 단위 비교
 *   3. 추가(+) / 삭제(-) / 변경(△) 조문 분류 출력
 */
import type { ScenarioContext, ScenarioResult, ScenarioSection } from "./types.js"
import type { HistoricalVersion } from "../../lib/historical-utils.js"
import { fetchLawVersions, sameLawName, wholeRevisionLabel, wholeRevisionsBetween } from "../../lib/law-lineage.js"
import { hasLawNode } from "../../lib/api-client.js"
import { dateSchema } from "../../lib/schemas.js"
import {
  changeExcerpt, diffArticles, displayJo, dot, excerptBudget, extractLawSnapshot,
  type ArticleSnapshot, type LawSnapshot,
} from "./time-travel-diff.js"

/** efYd <= targetDate 중 가장 큰 (해당 시점 시행 버전) */
export function pickVersion(versions: HistoricalVersion[], targetDate: string): HistoricalVersion | undefined {
  const target = parseInt(targetDate, 10)
  if (isNaN(target)) return undefined
  const eligible = versions.filter(v => {
    const ef = parseInt(v.efYd || "0", 10)
    return !isNaN(ef) && ef <= target
  })
  if (eligible.length === 0) return undefined
  // 필터는 빈 efYd를 0으로 취급해 통과시키므로 정렬도 같은 폴백을 써야 한다.
  // parseInt("")는 NaN → 비교자가 NaN을 반환하면 정렬 순서가 비결정적이 되어
  // "해당 시점 시행 버전"이 아닌 엉뚱한 버전이 뽑힐 수 있다.
  eligible.sort((a, b) => parseInt(b.efYd || "0", 10) - parseInt(a.efYd || "0", 10))
  return eligible[0]
}

/**
 * 판본 본문 raw 조회 — 시행일(efYd)을 동반한 eflaw 우선.
 * target=law는 MST만 받는데 MST는 "공포본" 단위라, 조항별로 나뉘어 시행되는
 * 공포본이면 시점과 무관하게 마지막 시행 슬라이스를 돌려준다 (실측: 형사소송법
 * MST 281865 → 시행 20271231 본문. 2026.7.1.에 시행 중인 슬라이스가 아니다).
 * 그대로 두면 "시점 A: 2026.7.1. 시행" 머리말에 2027.12.31.판 본문이 붙어
 * diff가 통째로 어긋난다. efYd가 없거나 eflaw가 빈 봉투면 기존 경로로 물러선다.
 */
async function fetchVersionRaw(ctx: ScenarioContext, ver: HistoricalVersion): Promise<string> {
  if (ver.efYd) {
    const raw = await ctx.apiClient.fetchApi({
      endpoint: "lawService.do", target: "eflaw", type: "JSON",
      extraParams: { MST: ver.mst, efYd: ver.efYd }, apiKey: ctx.apiKey,
    })
    if (hasLawNode(raw)) return raw
  }
  return ctx.apiClient.fetchApi({
    endpoint: "lawService.do", target: "law", type: "JSON",
    extraParams: { MST: ver.mst }, apiKey: ctx.apiKey,
  })
}

function summarizeChange(old: ArticleSnapshot, cur: ArticleSnapshot): string {
  const oldLen = old.body.length
  const curLen = cur.body.length
  const delta = curLen - oldLen
  const sign = delta > 0 ? `+${delta}` : `${delta}`
  return `(자수 ${oldLen}→${curLen}, ${sign})`
}

export async function runTimeTravelScenario(ctx: ScenarioContext): Promise<ScenarioResult> {
  const sections: ScenarioSection[] = []
  const suggestedActions: string[] = []

  const fromDate = ctx.extras?.fromDate as string | undefined
  const toDate = ctx.extras?.toDate as string | undefined
  const lawName = ctx.law?.lawName || ctx.query

  if (!fromDate || !toDate) {
    sections.push({
      title: "Time Travel — 시점 비교 (v4.0)",
      content: "⚠️ fromDate(YYYYMMDD)와 toDate(YYYYMMDD)가 모두 필요합니다.\n예: chain_amendment_track query='관세법' scenario='time_travel' fromDate='20240101' toDate='20251101'",
    })
    return { sections, suggestedActions }
  }

  if (!dateSchema.safeParse(fromDate).success || !dateSchema.safeParse(toDate).success) {
    sections.push({
      title: "Time Travel — 시점 비교 (v4.0)",
      content: `⚠️ 날짜 오류: fromDate=${fromDate}, toDate=${toDate} (유효한 YYYYMMDD 날짜 필요)`,
    })
    return { sections, suggestedActions }
  }

  // Step 1: 연혁 목록 → 두 시점 MST 결정 (페이징으로 전체 회수)
  let versions: HistoricalVersion[] = []
  let totalCount = 0
  let fetchedPages = 0
  try {
    // 법령ID 계보 — 두 시점 사이에 제명이 바뀌어도(소방시설법 2022.12.1.) 옛 이름 시절 버전을 잡는다.
    // 이른 시점이 계보 시작 전이면 폐지 후 재제정되기 전의 동명 구법(법령ID가 다르다)까지 받는다
    const r = await fetchLawVersions(ctx.apiClient, lawName, ctx.apiKey, ctx.law?.lawId, fromDate < toDate ? fromDate : toDate)
    versions = r.versions
    totalCount = r.totalCount
    fetchedPages = r.fetchedPages
  } catch (e) {
    sections.push({
      title: "Time Travel — 시점 비교 (v4.0)",
      content: `⚠️ 연혁 조회 실패: ${e instanceof Error ? e.message : String(e)}`,
    })
    return { sections, suggestedActions }
  }

  if (versions.length === 0) {
    sections.push({
      title: "Time Travel — 시점 비교 (v4.0)",
      content: `[NOT_FOUND] '${lawName}' 연혁을 찾을 수 없습니다. 법령명 띄어쓰기/오타를 확인하세요.\n참고: 법제처 응답 총 ${totalCount}건 (정확매칭 0건). 법령ID 계보를 못 잡으면 입력 법령명이 연혁의 법령명과 정확히 일치해야 합니다 (공백 제거 비교).`,
    })
    return { sections, suggestedActions }
  }

  const oldVer = pickVersion(versions, fromDate)
  const newVer = pickVersion(versions, toDate)

  if (!oldVer || !newVer) {
    const earliest = versions[versions.length - 1]
    const latest = versions[0]
    const lines = [
      `[NOT_FOUND] 시점 매칭 실패.`,
      `연혁 범위: ${earliest?.efYd || "?"} ~ ${latest?.efYd || "?"} (정확매칭 ${versions.length}개 / 법제처 총 ${totalCount}건, ${fetchedPages}페이지 수집)`,
      `입력: fromDate=${fromDate}, toDate=${toDate}`,
      !oldVer ? `→ fromDate(${fromDate})가 가장 오래된 연혁(${earliest?.efYd})보다 이전입니다. 그 시점 이후로 조정하세요.` : "",
      !newVer ? `→ toDate(${toDate})가 가장 오래된 연혁(${earliest?.efYd})보다 이전입니다.` : "",
    ].filter(Boolean)
    sections.push({
      title: "Time Travel — 시점 비교 (v4.0)",
      content: lines.join("\n"),
    })
    return { sections, suggestedActions }
  }

  // "변경 없음"은 MST와 시행일이 모두 같을 때만이다. 한 공포본이 조항별로 나뉘어
  // 시행되면(분리시행) MST는 같고 시행일만 다른 두 슬라이스가 뽑히는데, 이때 내용은
  // 실제로 다르다 (실측: 형사소송법 MST 281865 → 20260701판 조문 644개 /
  // 20271231판 653개). MST만 비교하면 이 차이를 "변경 없음"으로 단정한다.
  if (oldVer.mst === newVer.mst && oldVer.efYd === newVer.efYd) {
    sections.push({
      title: "Time Travel — 시점 비교 (v4.0)",
      content: `ℹ️ 두 시점 모두 동일 버전 (시행 ${oldVer.efYd}, MST ${oldVer.mst}) — 변경 없음`,
    })
    return { sections, suggestedActions }
  }

  // Step 2: 두 시점 본문 raw 조회
  let oldSnap: LawSnapshot = { articles: [], ancNo: "", ancYd: "", rrCls: "" }
  let newSnap: LawSnapshot = { articles: [], ancNo: "", ancYd: "", rrCls: "" }
  try {
    const [oldRaw, newRaw] = await Promise.all([
      fetchVersionRaw(ctx, oldVer),
      fetchVersionRaw(ctx, newVer),
    ])
    oldSnap = extractLawSnapshot(JSON.parse(oldRaw))
    newSnap = extractLawSnapshot(JSON.parse(newRaw))
  } catch (e) {
    sections.push({
      title: "Time Travel — 시점 비교 (v4.0)",
      content: `⚠️ 본문 조회 실패 (시점 A MST=${oldVer.mst} ${oldVer.efYd} / 시점 B MST=${newVer.mst} ${newVer.efYd}): ${e instanceof Error ? e.message : String(e)}`,
    })
    return { sections, suggestedActions }
  }

  const oldArticles = oldSnap.articles
  const newArticles = newSnap.articles
  if (oldArticles.length === 0 || newArticles.length === 0) {
    sections.push({
      title: "Time Travel — 시점 비교 (v4.0)",
      content: `[NOT_FOUND] 본문 조문 추출 실패. 시점 A MST=${oldVer.mst}(${oldVer.efYd}) ${oldArticles.length}개 / 시점 B MST=${newVer.mst}(${newVer.efYd}) ${newArticles.length}개.\n→ 해당 MST의 lawService.do 응답에 조문이 없거나 응답 구조가 비표준일 수 있습니다.`,
    })
    return { sections, suggestedActions }
  }

  // Step 3: diff
  const { added, removed, modified } = diffArticles(oldArticles, newArticles)

  // Step 4: 출력
  const versionsInfo = totalCount > versions.length
    ? `연혁 ${versions.length}/${totalCount}개 수집(${fetchedPages}p)`
    : `연혁 ${versions.length}개 수집`

  // 판본 출처(공포번호·공포일자)를 병기한다 (#96).
  // 없으면 소비 LLM이 도구가 준 정답을 자기 사전지식으로 기각한다 — 관세법
  // "기획재정부장관→재정경제부장관"이 정부조직 개편의 정상 반영인데도 "폐지된
  // 부처이므로 도구 오류"라고 사용자에게 안내한 실측 사례가 있다.
  const provenance = (snap: LawSnapshot, ver: HistoricalVersion) => {
    const no = snap.ancNo || ver.ancNo
    const ymd = dot(snap.ancYd || ver.ancYd)
    const cls = snap.rrCls || ver.rrCls
    const parts = [no ? `공포 제${String(parseInt(no, 10) || no)}호` : "", ymd ? `${ymd} 공포` : "", cls]
    return parts.filter(Boolean).join(", ")
  }

  const header =
    `시점 A: ${dot(oldVer.efYd) || oldVer.efYd} 시행 | MST ${oldVer.mst} | ${provenance(oldSnap, oldVer)} | ${oldArticles.length}개 조문\n` +
    `시점 B: ${dot(newVer.efYd) || newVer.efYd} 시행 | MST ${newVer.mst} | ${provenance(newSnap, newVer)} | ${newArticles.length}개 조문\n` +
    `${versionsInfo}\n` +
    `요약: + ${added.length} 신설 | - ${removed.length} 삭제 | △ ${modified.length} 변경`

  let body = header

  // 제명 변경·전부개정을 가로지르면 조번호 대조가 다른 조문끼리의 비교가 된다 — diff 앞에 밝힌다
  if (oldVer.lawNm && newVer.lawNm && !sameLawName(oldVer.lawNm, newVer.lawNm)) {
    body += `\n제명 변경: 「${oldVer.lawNm}」 → 「${newVer.lawNm}」 (같은 법령ID)`
  }
  const [intervalFrom, intervalTo] = [oldVer.efYd, newVer.efYd].sort()
  const whole = wholeRevisionsBetween(versions, intervalFrom, intervalTo)
  if (whole.length > 0) {
    const w = whole[whole.length - 1]
    body += `\n⚠️ 두 시점 사이 ${wholeRevisionLabel(w)}(시행 ${dot(w.efYd) || w.efYd}, 공포 제${w.ancNo}호) — 조문 체계가 바뀌어 아래 조번호 대조는 번호만 같은 다른 조문일 수 있습니다. 조문 제목으로 대응 관계를 확인하세요.`
  }

  // 두 시점 사이에 낀 개정들 — 각 변경의 근거 공포를 특정할 수 있게 한다 (#96)
  const between = versions
    .filter(v => parseInt(v.efYd || "0", 10) > parseInt(intervalFrom || "0", 10)
              && parseInt(v.efYd || "0", 10) <= parseInt(intervalTo || "0", 10))
    .sort((x, y) => parseInt(x.efYd || "0", 10) - parseInt(y.efYd || "0", 10))
  if (between.length > 0) {
    body += `\n\n[구간 개정 연혁] ${between.length}건 — 아래 변경들의 근거`
    for (const v of between.slice(0, 15)) {
      const no = v.ancNo ? `공포 제${v.ancNo}호` : "공포번호 미상"
      body += `\n  · ${dot(v.efYd) || v.efYd} 시행 | ${no}${v.ancYd ? ` (${dot(v.ancYd)} 공포)` : ""}${v.rrCls ? ` | ${v.rrCls}` : ""}`
    }
    if (between.length > 15) body += `\n  ... 외 ${between.length - 15}건`
  }

  const efNote = (a: ArticleSnapshot) => a.efYd ? ` [조문시행 ${dot(a.efYd) || a.efYd}]` : ""

  if (added.length > 0) {
    body += `\n\n[+ 신설 조문]`
    for (const a of added.slice(0, 30)) {
      body += `\n  + ${displayJo(a.joNum, a.joBranch)}${a.title ? ` (${a.title})` : ""}${efNote(a)}`
      if (a.body) body += `\n    ${a.body.slice(0, 200)}${a.body.length > 200 ? "..." : ""}`
    }
    if (added.length > 30) body += `\n  ... 외 ${added.length - 30}개`
  }

  if (removed.length > 0) {
    body += `\n\n[- 삭제 조문]`
    for (const r of removed.slice(0, 30)) {
      body += `\n  - ${displayJo(r.joNum, r.joBranch)}${r.title ? ` (${r.title})` : ""}`
      if (r.body) body += `\n    ${r.body.slice(0, 200)}${r.body.length > 200 ? "..." : ""}`
    }
    if (removed.length > 30) body += `\n  ... 외 ${removed.length - 30}개`
  }

  if (modified.length > 0) {
    // 변경 지점을 중심으로 신구대조를 실어 조문 재조회를 없앤다 (#97).
    // 조문 수에 따라 예산을 나눠 응답이 절단 한도로 밀리지 않게 한다.
    const shown = Math.min(modified.length, 30)
    const perSide = excerptBudget(shown)
    body += `\n\n[△ 변경 조문] (신구대조 발췌 — 변경 지점 중심, 조문당 ${perSide}자)`
    for (const m of modified.slice(0, 30)) {
      const ex = changeExcerpt(m.old.body, m.cur.body, perSide)
      body += `\n  △ ${displayJo(m.cur.joNum, m.cur.joBranch)}${m.cur.title ? ` (${m.cur.title})` : ""} ${summarizeChange(m.old, m.cur)}${efNote(m.cur)}`
      if (ex.bodyUnchanged) {
        body += `\n      (본문 동일 — 조문제목만 변경: "${m.old.title}" → "${m.cur.title}")`
      } else {
        body += `\n      [전] ${ex.before}`
        body += `\n      [후] ${ex.after}`
      }
      if (ex.clipped) body += `\n      ⚠️ 변경 구간이 길어 발췌가 잘렸습니다 — 전문은 get_law_text(mst="${newVer.mst}", jo="${displayJo(m.cur.joNum, m.cur.joBranch)}")`
    }
    if (modified.length > 30) body += `\n  ... 외 ${modified.length - 30}개`
  }

  if (added.length === 0 && removed.length === 0 && modified.length === 0) {
    body += `\n\n✓ 두 시점 본문 동일 — 조문 단위 변경 없음`
  }

  sections.push({
    title: `Time Travel — ${lawName} (${oldVer.efYd} ↔ ${newVer.efYd})`,
    content: body,
  })

  // 후속 액션
  suggestedActions.push(
    `${lawName} 신구대조표`,
    `${lawName} 조문별 개정이력`,
    `${lawName} 시행 ${newVer.efYd} 본문`,
  )

  return { sections, suggestedActions }
}
