/**
 * 행정규칙 부분 조회 입력 정규화 (jo · chapter) + 파싱 결과에서 조문 찾기
 * 키 문법은 파서(admin-rule-articles.ts)와 이 파일이 함께 쓴다.
 */
import type { ParsedAdminRule, AdminRuleArticle } from "./admin-rule-articles.js"

export function toKey(main: number, branch: number, ui: number): string {
  return `${main}${branch ? `-${branch}` : ""}${ui ? `의${ui}` : ""}`
}

/** 편·장 키: ("11", "2") → "11의2" */
export function structKey(num: string, ui?: string): string {
  return `${Number(num)}${ui ? `의${Number(ui)}` : ""}`
}

/** 편·장 키 → 표기: ("11의2", "장") → "제11장의2" */
export function structLabel(key: string, unit: "편" | "장"): string {
  return key.replace(/^(\d+)(의\d+)?$/u, `제$1${unit}$2`)
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

/**
 * "제9장" | "9장" | "9" → { chapter: "9" } / "제4편 제3장" → { part: "4", chapter: "3" } /
 * "제4편의2" → { part: "4의2" } (편 전체). 해석 불가면 null
 */
export function normalizeChapter(input: string): { part?: string, chapter?: string } | null {
  const m = /^(?:제?(\d+)편(?:의(\d+))?)?(?:제?(\d+)장?(?:의(\d+))?)?$/u.exec(String(input).replace(/\s+/gu, ""))
  if (!m || (!m[1] && !m[3])) return null
  return {
    ...(m[1] ? { part: structKey(m[1], m[2]) } : {}),
    ...(m[3] ? { chapter: structKey(m[3], m[4]) } : {}),
  }
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
