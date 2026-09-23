/**
 * 행정규칙 전문 텍스트 → 조문 배열 파서 (#admrul 부분 조회)
 *
 * 법제처 admrul 상세는 법령(target=law)과 달리 JO 파라미터가 없고
 * 전문이 <조문내용> 통짜 텍스트(외국환거래규정 기준 18.8만 자)로만 온다 — 실측 확정.
 * 따라서 조문 단위 조회는 서버가 전문을 파싱해서 제공해야 한다.
 *
 * 조문 번호 체계 2종을 모두 다룬다:
 *  - 하이픈형: 제9-5조, 제2-6조의2  (외국환거래규정 등 — 장 번호가 조 번호 앞자리)
 *  - 일반형:   제10조, 제10조의2
 */

export interface AdminRuleArticle {
  /** 정규화 키: "9-5" | "9-5의2" | "10" | "10의2" */
  key: string
  /** 비교용 튜플 (main, branch, ui) — 단조증가 검사에 사용 */
  ord: [number, number, number]
  /** 헤더 라인 원문 (제목 포함) */
  label: string
  /** 헤더 포함 본문 라인들 */
  lines: string[]
  /** 소속 장 번호 (없으면 0) */
  chapter: number
}

export interface AdminRuleChapter {
  num: number
  /** 장 헤더 라인 원문 */
  title: string
}

export interface ParsedAdminRule {
  articles: AdminRuleArticle[]
  chapters: AdminRuleChapter[]
  /** 첫 조문 이전의 서문 라인들 */
  preamble: string[]
}

/**
 * 조문 헤더 판정 (라인 시작 앵커).
 * 허용 꼬리: "(", "<", 전각 괄호, 라인 끝, 공백, 원문자 항 번호.
 * "…제9-5조제3항의 규정에 의한…" 같은 본문 중간 참조는 ^ 앵커 + 단조증가 검사로 걸러진다.
 */
const HEADER_RE = /^제(\d+)(?:-(\d+))?조(?:의(\d+))?(?=$|[\s(（<①-㊿])/u
const CHAPTER_RE = /^제(\d+)장(?=$|[\s(（])/u

function toKey(main: number, branch: number, ui: number): string {
  return `${main}${branch ? `-${branch}` : ""}${ui ? `의${ui}` : ""}`
}

function ordCompare(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

/**
 * jo 입력 정규화 → 후보 키 목록 (우선순위 순).
 * "제9-5조"·"9-5" → ["9-5", "9의5"] / "제9-5조의2"·"9-5-2" → ["9-5의2"]
 * "제10조"·"10" → ["10"] / "제10조의2"·"10의2"·"10-2" → ["10의2"] 또는 ["10-2","10의2"]
 * 하이픈형인지 일반형인지 입력만으로 확정할 수 없는 경우 두 해석을 모두 후보로 돌려주고,
 * 호출부가 실제 파싱된 조문 키와 대조해 먼저 맞는 것을 쓴다.
 */
export function normalizeAdminJo(input: string): string[] {
  const clean = String(input)
    .replace(/[‐‑‒–—―﹘﹣－]/gu, "-")
    .replace(/\s+/gu, "")
    .replace(/^제/u, "")
    .replace(/제?\d+[항호목].*$/u, "") // "제9-5조제3항" 꼬리 허용
  const m = /^(\d+)(?:-(\d+))?조?(?:의(\d+)|-(\d+))?$/u.exec(clean)
  if (!m) return []
  const main = Number(m[1])
  const branch = m[2] ? Number(m[2]) : 0
  const ui = m[3] ? Number(m[3]) : m[4] ? Number(m[4]) : 0
  if (branch && ui) return [toKey(main, branch, ui)]
  if (branch) {
    // "9-5": 하이픈형 조문이 우선, 없으면 일반형 "9조의5"로 해석
    return [toKey(main, branch, 0), toKey(main, 0, branch)]
  }
  if (ui) return [toKey(main, 0, ui)]
  return [toKey(main, 0, 0)]
}

/** "제9장" | "9장" | "9" → 9 (해석 불가면 0) */
export function normalizeChapter(input: string): number {
  const m = /^제?\s*(\d+)\s*장?$/u.exec(String(input).trim())
  return m ? Number(m[1]) : 0
}

/**
 * 전문 라인 스캔 파서.
 * 새 조문 헤더는 직전 조문보다 번호가 커야 한다(단조증가) — 하이픈형은 장 번호가
 * 조 번호 앞자리에 포함되므로 전체 단조증가가 성립하고, 일반형도 마찬가지다.
 * 위배되는 헤더 모양 라인은 본문(인용문 등)으로 취급한다.
 */
export function parseAdminRuleArticles(body: string): ParsedAdminRule {
  const lines = body.split(/\r?\n/u)
  const articles: AdminRuleArticle[] = []
  const chapters: AdminRuleChapter[] = []
  const preamble: string[] = []
  let cur: AdminRuleArticle | null = null
  let curChapter = 0
  let lastOrd: [number, number, number] | null = null
  // 조문 사이에 끼는 절 헤더 등 — 다음 조문 앞에 붙여 부분 조회에서 유실되지 않게 한다
  let pending: string[] = []

  for (const rawLine of lines) {
    // 2026-09-23 리뷰 C7: `/\s+$/u` 는 라인 안 공백 덩어리에서 제곱이다(10만 자 13초).
    // trimEnd 는 같은 공백 집합을 선형으로 지운다.
    const line = rawLine.trimEnd()
    const trimmed = line.trim()

    // 헤더 판정은 원 라인 기준(^ 앵커) — 들여쓰기된 라인은 본문이다.
    // 실측(외국환거래규정 1,943라인)상 조문·장 헤더는 전부 들여쓰기 0이고,
    // trim 후 판정하면 "  제9-9조 제1항…" 같은 본문 참조가 헤더로 오인될 수 있다.
    const ch = CHAPTER_RE.exec(line)
    if (ch) {
      curChapter = Number(ch[1])
      chapters.push({ num: curChapter, title: trimmed })
      cur = null // 장 헤더는 어느 조문에도 속하지 않는다
      // 장마다 조 번호가 1부터 다시 시작하는 체계(제2장 제1조 등)에서 조문이 통째로
      // 유실되지 않도록 단조증가 기준을 장 단위로 리셋한다
      lastOrd = null
      continue
    }

    const h = HEADER_RE.exec(line)
    if (h) {
      const ord: [number, number, number] = [Number(h[1]), h[2] ? Number(h[2]) : 0, h[3] ? Number(h[3]) : 0]
      if (lastOrd === null || ordCompare(ord, lastOrd) > 0) {
        cur = {
          key: toKey(ord[0], ord[1], ord[2]),
          ord,
          label: trimmed,
          lines: pending.length ? [...pending, line] : [line],
          chapter: curChapter,
        }
        pending = []
        // 하이픈형에서 장 헤더가 생략된 경우 조 번호 앞자리를 장으로 삼는다
        if (!curChapter && ord[1] > 0) cur.chapter = ord[0]
        articles.push(cur)
        lastOrd = ord
        continue
      }
      // 번호가 역행 → 본문 중간 인용으로 간주하고 현재 조문에 붙인다
    }

    if (cur) cur.lines.push(line)
    else if (!trimmed) continue
    else if (articles.length) pending.push(line) // 첫 조문 이후의 떠도는 라인 = 절 헤더 등
    else preamble.push(line)
  }

  if (pending.length && articles.length) articles[articles.length - 1].lines.push(...pending)

  return { articles, chapters, preamble }
}

/** 후보 키 목록에서 실제 존재하는 첫 조문을 찾는다 */
export function findArticle(parsed: ParsedAdminRule, joInput: string): AdminRuleArticle | null {
  const candidates = normalizeAdminJo(joInput)
  for (const key of candidates) {
    const hit = parsed.articles.find((a) => a.key === key)
    if (hit) return hit
  }
  return null
}
