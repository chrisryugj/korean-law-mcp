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
 * jo·chapter 입력 정규화와 조문 찾기는 admin-rule-jo.ts.
 */
import { toKey, structKey } from "./admin-rule-jo.js"
// 공개 경로(./lib/admin-rule-articles) 하위호환 — 입력 정규화·조문 찾기가 admin-rule-jo.ts 로 옮겨 갔다
export { normalizeAdminJo, normalizeChapter, findArticle } from "./admin-rule-jo.js"

export interface AdminRuleArticle {
  /** 정규화 키: "9-5" | "9-5의2" | "10" | "10의2" */
  key: string
  /** 비교용 튜플 (main, branch, ui) — 단조증가 검사에 사용 */
  ord: [number, number, number]
  /** 헤더 라인 원문 (제목 포함) */
  label: string
  /** 헤더 포함 본문 라인들 */
  lines: string[]
  /** 소속 장 키: "9" | "11의2" (장 헤더가 없으면 "") */
  chapter: string
  /** 소속 편 키: "4" | "4의2" (편 헤더가 없으면 "") — 편마다 장 번호가 1부터 다시 시작하므로 장은 (편, 장)으로 가린다 */
  part: string
}

export interface AdminRuleChapter {
  /** 이 장이 속한 편 키 (편 없으면 "") */
  part: string
  key: string
  /** 장 헤더 라인 원문 */
  title: string
}

export interface ParsedAdminRule {
  articles: AdminRuleArticle[]
  chapters: AdminRuleChapter[]
  /** 편 헤더 (편 체계가 없으면 빈 배열) */
  parts: Array<{ key: string, title: string }>
  /** 첫 조문 이전의 서문 라인들 */
  preamble: string[]
}

/**
 * 조문 헤더 판정 (라인 시작 앵커).
 * 허용 꼬리: "(", "<", 전각 괄호, 라인 끝, 공백, 원문자 항 번호.
 * "…제9-5조제3항의 규정에 의한…" 같은 본문 중간 참조는 ^ 앵커 + 단조증가 검사로 걸러진다.
 */
const HEADER_RE = /^제(\d+)(?:-(\d+))?조(?:의(\d+))?(?=$|[\s(（<①-㊿])/u
// "제11장의2"·"제4편의2" 처럼 가지 번호가 붙은 헤더도 있다(금융투자업규정 실측)
const CHAPTER_RE = /^제(\d+)장(?:의(\d+))?(?=$|[\s(（])/u
const PART_RE = /^제(\d+)편(?:의(\d+))?(?=$|[\s(（])/u
const SECTION_RE = /^제\d+(?:절|관)(?:의\d+)?(?=$|[\s(（])/u

function ordCompare(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
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
  const parts: ParsedAdminRule["parts"] = []
  const preamble: string[] = []
  let cur: AdminRuleArticle | null = null
  let curChapter = ""
  let curPart = ""
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
    // 편 헤더: 새 편의 조문은 앞 편의 마지막 장을 물려받지 않는다(제4편의2 처럼 장 없는 편이 있다)
    const pt = PART_RE.exec(line)
    if (pt) {
      curPart = structKey(pt[1], pt[2])
      curChapter = ""
      parts.push({ key: curPart, title: trimmed })
      cur = null
      lastOrd = null
      continue
    }

    const ch = CHAPTER_RE.exec(line)
    if (ch) {
      curChapter = structKey(ch[1], ch[2])
      chapters.push({ part: curPart, key: curChapter, title: trimmed })
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
          part: curPart,
        }
        pending = []
        // 하이픈형에서 장 헤더가 생략된 경우 조 번호 앞자리를 장으로 삼는다
        // (편이 있는 규칙은 앞자리가 편 번호다 — 금융투자업규정 제4-50조는 제4편)
        if (!curChapter && !curPart && ord[1] > 0) cur.chapter = String(ord[0])
        articles.push(cur)
        lastOrd = ord
        continue
      }
      // 번호가 역행 → 본문 중간 인용으로 간주하고 현재 조문에 붙인다
    }

    // 절·관 헤더는 다음 조문 앞에 붙인다. 현재 조문에 두면 그 조문이 다음 절 제목으로 끝났고
    // (외국환거래규정 40개조), 첫 조문 앞이면 서문으로 빠졌다
    if (SECTION_RE.test(line)) {
      pending.push(line)
      cur = null
      continue
    }

    if (cur) cur.lines.push(line)
    else if (!trimmed) continue
    else if (articles.length || pending.length) pending.push(line) // 떠도는 라인 = 절 헤더 뒤 등
    else preamble.push(line)
  }

  if (pending.length) {
    if (articles.length) articles[articles.length - 1].lines.push(...pending)
    else preamble.push(...pending) // 조문이 하나도 없으면 서문으로 (유실 금지)
  }

  return { articles, chapters, parts, preamble }
}
