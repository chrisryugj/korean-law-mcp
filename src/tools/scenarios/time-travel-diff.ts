/**
 * time_travel 조문 diff — 스냅샷 추출 · 비교 · 신구대조 발췌
 *
 * 두 시점의 본문을 조문 단위로 맞대보고, "무엇이 어떻게 바뀌었는지"를
 * 재조회 없이 읽을 수 있는 형태로 만든다.
 */

import { toArray } from "../../lib/xml-parser.js"
import { CIRCLED_DIGITS, cleanHtml } from "../../lib/article-parser.js"
import { formatDateDot } from "../../lib/schemas.js"

export interface ArticleSnapshot {
  joNum: string
  joBranch: string
  title: string
  body: string
  /** 조문시행일자 — 그 조문이 언제부터 효력을 갖는지 (법제처 조문단위 필드) */
  efYd: string
  key: string  // joNum + joBranch (식별자)
}

/** 한 시점의 본문 + 그 판본의 출처 메타 */
export interface LawSnapshot {
  articles: ArticleSnapshot[]
  ancNo: string   // 공포번호
  ancYd: string   // 공포일자
  rrCls: string   // 제개정구분
}

/**
 * diff 비교용 본문 정규화. 엔티티 디코딩은 cleanHtml 단일 원본(Critical Rule 7) —
 * 손으로 짜면 `&amp;` 선처리가 되살아나 `&amp;lt;` 가 `<` 까지 두 번 풀린다.
 * 태그만 여기서 **공백**으로 지운다: cleanHtml 은 `''` 로 지워
 * `제1조<br/>목적` 을 붙여버리고, 그러면 없던 변경이 diff 에 잡힌다.
 */
/** 테스트 도달용 공개 — 프로덕션 소비자는 이 파일 안뿐이다 (#143) */
export function normalizeText(s: string): string {
  return cleanHtml((s || "").replace(/<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
}

export function extractLawSnapshot(lawJson: any): LawSnapshot {
  const info = lawJson?.법령?.기본정보 ?? {}
  const units: any[] = toArray(lawJson?.법령?.조문?.조문단위)
  const articles: ArticleSnapshot[] = []
  for (const u of units) {
    if (u?.조문여부 !== "조문") continue
    const joNum = String(u.조문번호 || "")
    const joBranch = String(u.조문가지번호 || "0")
    let body = normalizeText(String(u.조문내용 || ""))
    // 항/호/목 본문 합산 (정규화). 순회 대상은 article-parser extractHangContent와 같다 —
    // 목은 호 자식으로도, 항 레벨 형제 배열로도 오고, 호는 항 없이 조문 직속으로도 온다.
    // 어느 하나라도 빼먹으면 그 단위만 개정된 조문이 "본문 동일"로 무음 누락된다 (#150).
    // 표시용 순서 복원(groupMokByReset)은 diff에 불필요 — 텍스트 존재만 반영한다.
    const appendHo = (ho: any) => {
      body += " " + normalizeText(String(ho.호내용 || ""))
      for (const mok of toArray<any>(ho.목)) body += " " + normalizeText(String(mok.목내용 || ""))
    }
    for (const h of toArray<any>(u.항)) {
      body += " " + normalizeText(String(h.항내용 || ""))
      for (const ho of toArray<any>(h.호)) appendHo(ho)
      for (const mok of toArray<any>(h.목)) body += " " + normalizeText(String(mok.목내용 || ""))
    }
    for (const ho of toArray<any>(u.호)) appendHo(ho)
    articles.push({
      joNum,
      joBranch,
      title: String(u.조문제목 || ""),
      body: body.trim(),
      efYd: String(u.조문시행일자 || ""),
      key: `${joNum}-${joBranch}`,
    })
  }
  return {
    articles,
    ancNo: String(info.공포번호 || ""),
    ancYd: String(info.공포일자 || ""),
    rrCls: String(info.제개정구분 || ""),
  }
}

export function displayJo(joNum: string, joBranch: string): string {
  const branch = parseInt(joBranch, 10)
  return branch > 0 ? `제${joNum}조의${branch}` : `제${joNum}조`
}

/**
 * YYYYMMDD → YYYY.MM.DD. 서식 자체는 formatDateDot 한 벌만 쓴다(#144).
 * 빈 입력 계약만 다르다 — 여기 호출자는 `dot(x) || x` 로 원문을 폴백에 쓰므로
 * 형식이 아니면 **빈 문자열**이어야 한다. formatDateDot 의 "N/A" 는 그 폴백을 죽인다.
 */
export function dot(ymd: string): string {
  return /^\d{8}$/.test(ymd) ? formatDateDot(ymd) : ""
}

export interface ArticleDiff {
  added: ArticleSnapshot[]
  removed: ArticleSnapshot[]
  modified: Array<{ old: ArticleSnapshot; cur: ArticleSnapshot }>
}

export function diffArticles(oldList: ArticleSnapshot[], newList: ArticleSnapshot[]): ArticleDiff {
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

// ─── 신구대조 발췌 (#97) ──────────────────────────────

/**
 * 변경 지점을 중심으로 신·구 본문을 발췌한다.
 *
 * 앞에서부터 N자를 그냥 자르면, 개정이 조문 중·후반에 있을 때 [전]과 [후]가 똑같은
 * 앞머리만 보여준다 — 소비 LLM이 "무엇이 바뀌었는지 알 수 없다"고 판단해 조문을
 * 다시 조회하게 만드는 바로 그 형태다(#97의 재조회 6회).
 *
 * 그래서 공통 앞머리·공통 꼬리를 걷어내고 실제로 달라진 구간을 잡아, 그 구간을
 * 문맥과 함께 보여준다. 잘리는 것은 언제나 "바뀌지 않은 주변"이고, 변경 구간 자체는
 * 예산 안에서 통째로 싣는다 — 단서 조항이 중간에서 잘려 다른 규범으로 읽히는 일을
 * 막기 위해서다. 예산을 넘어 변경 구간까지 줄여야 하면 그 사실을 표기한다.
 */
/**
 * 항(①②③)·호(1. 2.)·목(가. 나.) 시작 지점 — 조문 본문의 자연스러운 단위 경계.
 * 원숫자는 article-parser 의 CIRCLED_DIGITS(㊿까지) 단일 원본 — `[①-⑮]` 식
 * 코드포인트 범위는 ㉑·㊱ 가 다른 블록이라 성립하지 않고, 끊긴 지점 이상의 항에서
 * 경계를 못 찾아 발췌 머리 당김이 조용히 실패한다.
 */
const CLAUSE_START = new RegExp(`[${CIRCLED_DIGITS}]|(?:^|\\s)\\d{1,2}\\.\\s|(?:^|\\s)[가-하]\\.\\s`, "g")

/**
 * 발췌 시작점을 가까운 항·호·목 머리로 당긴다.
 * 문장 한가운데서 시작하는 발췌는 단서와 본문의 구분이 흐려져 다른 규범으로
 * 읽힐 수 있다. 앞으로 당기기만 하므로(내용이 늘기만 한다) 손실은 생기지 않고,
 * 탐색 폭도 제한해 발췌가 통째로 커지지 않게 한다.
 */
const CLAUSE_SNAP_WINDOW = 60

/** 테스트 도달용 공개 — 프로덕션 소비자는 이 파일 안뿐이다 (#143) */
export function snapToClauseStart(body: string, start: number): number {
  if (start <= 0) return 0
  const from = Math.max(0, start - CLAUSE_SNAP_WINDOW)
  const window = body.slice(from, start)
  let best = -1
  let m: RegExpExecArray | null
  CLAUSE_START.lastIndex = 0
  while ((m = CLAUSE_START.exec(window)) !== null) {
    // 선행 공백은 경계에 포함하지 않는다
    best = from + m.index + (/^\s/.test(m[0]) ? 1 : 0)
  }
  return best >= 0 ? best : start
}

export function changeExcerpt(
  oldBody: string,
  curBody: string,
  perSide: number
): { before: string; after: string; clipped: boolean; bodyUnchanged?: boolean } {
  // 조문제목만 바뀐 경우도 modified에 들어온다. 이때 본문 발췌를 보여주면
  // 바뀌지 않은 꼬리가 "변경 내용"인 양 읽히므로 본문이 같다는 사실만 알린다.
  if (oldBody === curBody) {
    return { before: "", after: "", clipped: false, bodyUnchanged: true }
  }

  const max = Math.min(oldBody.length, curBody.length)
  let prefix = 0
  while (prefix < max && oldBody[prefix] === curBody[prefix]) prefix++
  let suffix = 0
  while (
    suffix < max - prefix &&
    oldBody[oldBody.length - 1 - suffix] === curBody[curBody.length - 1 - suffix]
  ) suffix++

  const oldChange = oldBody.slice(prefix, oldBody.length - suffix)
  const curChange = curBody.slice(prefix, curBody.length - suffix)
  const longestChange = Math.max(oldChange.length, curChange.length)
  const clipped = longestChange > perSide

  // 변경 구간이 예산 안에 들어가면 남는 만큼 앞뒤 문맥을 붙인다
  const context = clipped ? 0 : Math.floor((perSide - longestChange) / 2)

  const cut = (body: string, changeLen: number) => {
    const start = snapToClauseStart(body, Math.max(0, prefix - context))
    const end = Math.min(body.length, prefix + Math.min(changeLen, perSide) + context)
    const head = start > 0 ? "…" : ""
    const tail = end < body.length ? "…" : ""
    return head + body.slice(start, end) + tail
  }

  return {
    before: cut(oldBody, oldChange.length),
    after: cut(curBody, curChange.length),
    clipped,
  }
}

/** 변경 조문 수에 따라 조문당 발췌 예산을 배분 (응답이 한도로 밀리지 않게) */
export function excerptBudget(shownCount: number, total = 12000, min = 120, max = 260): number {
  if (shownCount <= 0) return max
  return Math.max(min, Math.min(max, Math.floor(total / (2 * shownCount))))
}
