/**
 * 행정규칙 부분 조회 뷰 (jo · chapter · keyword · page)
 *
 * 우선순위: jo > chapter > keyword > page. 복수 지정 시 상위 하나만 적용하고 응답에 명시.
 * 같은 규칙을 jo → keyword → page 순으로 연속 조회하는 패턴이 일반적이므로
 * 전문 API 응답(XML)을 id 기준 캐시(TTL 6h, LRU 20건)에 보관해 재호출을 막는다.
 */

import { SimpleCache } from "./cache.js"
import { MAX_RESPONSE_SIZE } from "./schemas.js"
import {
  parseAdminRuleArticles, findArticle, normalizeChapter,
  type ParsedAdminRule, type AdminRuleArticle,
} from "./admin-rule-articles.js"

/** 전문 XML 캐시 — 외국환거래규정 기준 응답 ~750KB이므로 상한을 작게 잡는다 */
export const adminRuleXmlCache = new SimpleCache(20)
export const ADMIN_RULE_CACHE_TTL_MS = 6 * 60 * 60 * 1000

export function adminRuleCacheKey(id: string): string {
  return `admrulxml:${id}` // 캐시 키 네임스페이스 분리 (CLAUDE.md Critical Rule 10)
}

export interface PartialParams {
  jo?: string
  context?: number
  chapter?: string
  keyword?: string
  max_results?: number
  page?: number
}

export const PARTIAL_HINT =
  "jo(조문)·chapter(장)·keyword(본문 검색)·page(페이징) 파라미터로 부분 조회할 수 있습니다. 예: jo:\"제9-5조\""

const NO_ARTICLE_MSG =
  "이 행정규칙은 조문 체계가 없습니다(항목식 훈령·지침 등) — keyword 또는 page를 사용하세요."

/** 복수 지정 시 상위 하나만 적용 (jo > chapter > keyword > page) */
export function pickPartialMode(p: PartialParams): { mode: "jo" | "chapter" | "keyword" | "page" | null, ignored: string[] } {
  const given: Array<"jo" | "chapter" | "keyword" | "page"> = []
  if (p.jo) given.push("jo")
  if (p.chapter) given.push("chapter")
  if (p.keyword) given.push("keyword")
  if (p.page !== undefined) given.push("page")
  if (given.length === 0) return { mode: null, ignored: [] }
  return { mode: given[0], ignored: given.slice(1) }
}

function renderArticles(items: AdminRuleArticle[]): string {
  return items.map((a) => a.lines.join("\n")).join("\n\n")
}

function joView(parsed: ParsedAdminRule, jo: string, context: number): string {
  const hit = findArticle(parsed, jo)
  if (!hit) {
    if (parsed.articles.length === 0) return NO_ARTICLE_MSG
    const range = `${parsed.articles[0].label.split(/[\s(（]/u)[0]} ~ ${parsed.articles[parsed.articles.length - 1].label.split(/[\s(（]/u)[0]}`
    return `[NOT_FOUND] '${jo}'에 해당하는 조문을 찾지 못했습니다. (수록 범위: ${range}, 총 ${parsed.articles.length}개조)\n` +
      "keyword 파라미터로 본문을 검색해 보세요.\n⚠️ LLM은 조문 내용을 추측/생성하지 마세요."
  }
  const idx = parsed.articles.indexOf(hit)
  const n = Math.max(0, Math.min(context || 0, 10))
  const slice = parsed.articles.slice(Math.max(0, idx - n), idx + n + 1)
  const chapterTitle = parsed.chapters.find((c) => c.num === hit.chapter)?.title
  const head = chapterTitle ? `${chapterTitle}\n\n` : ""
  return head + renderArticles(slice)
}

function chapterView(parsed: ParsedAdminRule, chapter: string): string {
  if (parsed.articles.length === 0) return NO_ARTICLE_MSG
  const num = normalizeChapter(chapter)
  if (!num) return `[NOT_FOUND] chapter 값 '${chapter}'을(를) 해석하지 못했습니다. "제9장" 형식으로 지정하세요.`
  const items = parsed.articles.filter((a) => a.chapter === num)
  if (items.length === 0) {
    const avail = [...new Set(parsed.articles.map((a) => a.chapter))].filter(Boolean).join(", ")
    return `[NOT_FOUND] 제${num}장에 속한 조문이 없습니다. (수록 장: ${avail || "구분 없음"})`
  }
  const title = parsed.chapters.find((c) => c.num === num)?.title || `제${num}장`
  let text = `${title}  (조문 ${items.length}개)\n\n` + renderArticles(items)
  if (text.length > MAX_RESPONSE_SIZE) {
    text = `⚠️ 이 장은 ${text.length.toLocaleString()}자로 응답 한도를 넘습니다 — jo 파라미터로 조문 단위로 좁히세요.\n\n` + text
  }
  return text
}

function keywordView(parsed: ParsedAdminRule, keyword: string, maxResults: number): string {
  if (parsed.articles.length === 0) return NO_ARTICLE_MSG
  const kw = keyword.trim()
  const hits = parsed.articles.filter((a) => a.lines.some((l) => l.includes(kw)))
  if (hits.length === 0) {
    return `[NOT_FOUND] 본문에 '${kw}'을(를) 포함한 조문이 없습니다. (총 ${parsed.articles.length}개조 검색)\n⚠️ LLM은 조문 내용을 추측/생성하지 마세요.`
  }
  const cap = Math.max(1, Math.min(maxResults || 10, 30))
  const shown = hits.slice(0, cap)
  const PER = 2500
  // 본문은 상위 cap개만 싣더라도, 매칭 조문 "목록"은 전부 보여준다 —
  // 뒤쪽 장의 조문이 목록에서도 사라지면 jo로 이어 갈 단서가 없다.
  const allLabels = hits.map((a) => a.label.split(/[\s(（<]/u)[0]).join(", ")
  let text = `'${kw}' 포함 조문 ${hits.length}개: ${allLabels}\n`
  text += hits.length > cap ? `(아래 본문은 상위 ${cap}개 — 나머지는 jo 파라미터로 조회, max_results로 조정 가능)\n\n` : "\n"
  for (const a of shown) {
    const joLabel = a.key.includes("의") ? `제${a.key.replace("의", "조의")}` : `제${a.key}조`
    let body = a.lines.join("\n")
    if (body.length > PER) body = body.slice(0, PER) + `\n   … (이 조문 ${body.length.toLocaleString()}자 — jo:"${joLabel}"로 전체 조회)`
    text += `${body}\n\n---\n\n`
  }
  return text.replace(/\n\n---\n\n$/u, "")
}

export interface PageResult { text: string, page: number, totalPages: number }

/** 전문을 라인 경계에서 자른 비중첩 청크로 페이징 */
export function paginateFullText(fullText: string, page: number, chunkSize = 45000): PageResult {
  const boundaries: number[] = [0]
  let pos = 0
  while (pos < fullText.length) {
    let end = Math.min(pos + chunkSize, fullText.length)
    if (end < fullText.length) {
      const nl = fullText.lastIndexOf("\n", end)
      if (nl > pos) end = nl + 1
    }
    boundaries.push(end)
    pos = end
  }
  const totalPages = boundaries.length - 1
  const p = Math.max(1, Math.min(Math.trunc(page) || 1, totalPages))
  const text = fullText.slice(boundaries[p - 1], boundaries[p])
  return { text, page: p, totalPages }
}

/** 부분 조회 본문 생성 — 호출부는 규칙명·공포일 헤더를 앞에 붙인다 */
export function buildPartialBody(body: string, fullText: string, params: PartialParams): { label: string, text: string, note?: string } {
  const { mode, ignored } = pickPartialMode(params)
  const note = ignored.length ? `※ 복수 파라미터 중 우선순위에 따라 '${mode}'만 적용했습니다 (무시: ${ignored.join(", ")}).` : undefined
  const parsed = parseAdminRuleArticles(body)
  switch (mode) {
    case "jo":
      return { label: `조문 조회: ${params.jo}`, text: joView(parsed, params.jo!, params.context || 0), note }
    case "chapter":
      return { label: `장 조회: ${params.chapter}`, text: chapterView(parsed, params.chapter!), note }
    case "keyword":
      return { label: `본문 검색: ${params.keyword}`, text: keywordView(parsed, params.keyword!, params.max_results || 10), note }
    case "page": {
      const r = paginateFullText(fullText, params.page || 1)
      const tail = r.page < r.totalPages ? `\n\n▶ 다음: page:${r.page + 1}` : ""
      return { label: `페이지 ${r.page}/${r.totalPages}`, text: r.text + tail, note }
    }
    default:
      return { label: "", text: fullText, note }
  }
}
