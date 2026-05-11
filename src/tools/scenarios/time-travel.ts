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
import { fetchHistoricalVersionsFull, type HistoricalVersion } from "../../lib/historical-utils.js"

interface ArticleSnapshot {
  joNum: string
  joBranch: string
  title: string
  body: string
  key: string  // joNum + joBranch (식별자)
}

function normalizeText(s: string): string {
  return (s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
}

function extractArticleSnapshots(lawJson: any): ArticleSnapshot[] {
  const raw = lawJson?.법령?.조문?.조문단위
  const units: any[] = Array.isArray(raw) ? raw : raw ? [raw] : []
  const snapshots: ArticleSnapshot[] = []
  for (const u of units) {
    if (u?.조문여부 !== "조문") continue
    const joNum = String(u.조문번호 || "")
    const joBranch = String(u.조문가지번호 || "0")
    const title = String(u.조문제목 || "")
    let body = normalizeText(String(u.조문내용 || ""))
    // 항/호/목 본문 합산 (정규화)
    const hangs = Array.isArray(u.항) ? u.항 : u.항 ? [u.항] : []
    for (const h of hangs) {
      body += " " + normalizeText(String(h.항내용 || ""))
      const hos = Array.isArray(h.호) ? h.호 : h.호 ? [h.호] : []
      for (const ho of hos) {
        body += " " + normalizeText(String(ho.호내용 || ""))
      }
    }
    body = body.trim()
    snapshots.push({
      joNum,
      joBranch,
      title,
      body,
      key: `${joNum}-${joBranch}`,
    })
  }
  return snapshots
}

function displayJo(joNum: string, joBranch: string): string {
  const branch = parseInt(joBranch, 10)
  return branch > 0 ? `제${joNum}조의${branch}` : `제${joNum}조`
}

function diffArticles(
  oldList: ArticleSnapshot[],
  newList: ArticleSnapshot[]
): { added: ArticleSnapshot[]; removed: ArticleSnapshot[]; modified: Array<{ old: ArticleSnapshot; cur: ArticleSnapshot }> } {
  const oldMap = new Map(oldList.map(a => [a.key, a]))
  const newMap = new Map(newList.map(a => [a.key, a]))

  const added: ArticleSnapshot[] = []
  const removed: ArticleSnapshot[] = []
  const modified: Array<{ old: ArticleSnapshot; cur: ArticleSnapshot }> = []

  for (const [key, cur] of newMap) {
    const old = oldMap.get(key)
    if (!old) added.push(cur)
    else if (old.body !== cur.body || old.title !== cur.title) modified.push({ old, cur })
  }
  for (const [key, old] of oldMap) {
    if (!newMap.has(key)) removed.push(old)
  }

  // 정렬 (조문번호 순)
  const sortFn = (a: ArticleSnapshot, b: ArticleSnapshot) => {
    const an = parseInt(a.joNum, 10) - parseInt(b.joNum, 10)
    if (an !== 0) return an
    return parseInt(a.joBranch, 10) - parseInt(b.joBranch, 10)
  }
  added.sort(sortFn)
  removed.sort(sortFn)
  modified.sort((a, b) => sortFn(a.cur, b.cur))

  return { added, removed, modified }
}

/** efYd <= targetDate 중 가장 큰 (해당 시점 시행 버전) */
function pickVersion(versions: HistoricalVersion[], targetDate: string): HistoricalVersion | undefined {
  const target = parseInt(targetDate, 10)
  if (isNaN(target)) return undefined
  const eligible = versions.filter(v => {
    const ef = parseInt(v.efYd || "0", 10)
    return !isNaN(ef) && ef <= target
  })
  if (eligible.length === 0) return undefined
  eligible.sort((a, b) => parseInt(b.efYd, 10) - parseInt(a.efYd, 10))
  return eligible[0]
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

  if (!/^\d{8}$/.test(fromDate) || !/^\d{8}$/.test(toDate)) {
    sections.push({
      title: "Time Travel — 시점 비교 (v4.0)",
      content: `⚠️ 날짜 형식 오류: fromDate=${fromDate}, toDate=${toDate} (YYYYMMDD 8자리 필요)`,
    })
    return { sections, suggestedActions }
  }

  // Step 1: 연혁 목록 → 두 시점 MST 결정 (페이징으로 전체 회수)
  let versions: HistoricalVersion[] = []
  let totalCount = 0
  let fetchedPages = 0
  try {
    const r = await fetchHistoricalVersionsFull(ctx.apiClient, lawName, ctx.apiKey)
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
      content: `[NOT_FOUND] '${lawName}' 연혁을 찾을 수 없습니다. 법령명 띄어쓰기/오타를 확인하세요.\n참고: 법제처 응답 총 ${totalCount}건 (정확매칭 0건). 입력 법령명이 lsHistory의 '법령명한글'과 정확히 일치해야 합니다 (공백 제거 비교).`,
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

  if (oldVer.mst === newVer.mst) {
    sections.push({
      title: "Time Travel — 시점 비교 (v4.0)",
      content: `ℹ️ 두 시점 모두 동일 버전 (시행 ${oldVer.efYd}, MST ${oldVer.mst}) — 변경 없음`,
    })
    return { sections, suggestedActions }
  }

  // Step 2: 두 시점 본문 raw 조회
  let oldArticles: ArticleSnapshot[] = []
  let newArticles: ArticleSnapshot[] = []
  try {
    const [oldRaw, newRaw] = await Promise.all([
      ctx.apiClient.fetchApi({
        endpoint: "lawService.do", target: "law", type: "JSON",
        extraParams: { MST: oldVer.mst }, apiKey: ctx.apiKey,
      }),
      ctx.apiClient.fetchApi({
        endpoint: "lawService.do", target: "law", type: "JSON",
        extraParams: { MST: newVer.mst }, apiKey: ctx.apiKey,
      }),
    ])
    oldArticles = extractArticleSnapshots(JSON.parse(oldRaw))
    newArticles = extractArticleSnapshots(JSON.parse(newRaw))
  } catch (e) {
    sections.push({
      title: "Time Travel — 시점 비교 (v4.0)",
      content: `⚠️ 본문 조회 실패 (시점 A MST=${oldVer.mst} ${oldVer.efYd} / 시점 B MST=${newVer.mst} ${newVer.efYd}): ${e instanceof Error ? e.message : String(e)}`,
    })
    return { sections, suggestedActions }
  }

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
  const header =
    `시점 A: ${oldVer.efYd} 시행 (MST ${oldVer.mst}, ${oldArticles.length}개 조문)\n` +
    `시점 B: ${newVer.efYd} 시행 (MST ${newVer.mst}, ${newArticles.length}개 조문)\n` +
    `${versionsInfo}\n` +
    `요약: + ${added.length} 신설 | - ${removed.length} 삭제 | △ ${modified.length} 변경`

  let body = header

  if (added.length > 0) {
    body += `\n\n[+ 신설 조문]`
    for (const a of added.slice(0, 30)) {
      body += `\n  + ${displayJo(a.joNum, a.joBranch)}${a.title ? ` (${a.title})` : ""}`
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
    body += `\n\n[△ 변경 조문]`
    for (const m of modified.slice(0, 30)) {
      body += `\n  △ ${displayJo(m.cur.joNum, m.cur.joBranch)}${m.cur.title ? ` (${m.cur.title})` : ""} ${summarizeChange(m.old, m.cur)}`
      // 변경 전후 짧게 보여주기
      body += `\n      [전] ${m.old.body.slice(0, 120)}${m.old.body.length > 120 ? "..." : ""}`
      body += `\n      [후] ${m.cur.body.slice(0, 120)}${m.cur.body.length > 120 ? "..." : ""}`
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
