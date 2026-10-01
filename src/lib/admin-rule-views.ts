/**
 * 행정규칙 부분 조회 뷰 (jo · chapter · keyword · page)
 *
 * 우선순위: jo > chapter > keyword > page. 복수 지정 시 상위 하나만 적용하고 응답에 명시.
 * 같은 규칙을 jo → keyword → page 순으로 연속 조회하는 패턴이 일반적이므로
 * 전문 API 응답을 파싱한 문서(admin-rule-doc.ts)를 id 기준 캐시(TTL 6h, LRU 20건)에 보관해 재호출·재파싱을 막는다.
 */

import { SimpleCache } from "./cache.js"
import { MAX_RESPONSE_SIZE } from "./schemas.js"
import { requestContext } from "./session-state.js"
import { parseAdminRuleArticles, type ParsedAdminRule, type AdminRuleArticle } from "./admin-rule-articles.js"
import { findArticle, normalizeChapter, structLabel } from "./admin-rule-jo.js"
import { keywordView, splitSections, type ExtraBlock } from "./admin-rule-keyword.js"

/**
 * 행정규칙 문서 캐시 (값: AdminRuleDoc — admin-rule-doc.ts). 큰 규칙은 한 건이 본문 수백만 자라 상한을 작게 잡는다.
 * applicable_law 행정규칙 갈래만 XML 문자열을 먼저 넣고, get_admin_rule 이 첫 조회 때 문서로 바꿔 넣는다.
 * (이름의 xml 은 그 선적재 경로와 키 접두어 때문에 남겼다)
 */
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

/** 절 번호 조회 — 그 절과 하위 절(2.7 → 2.7.1, 2.7.1.1 …)을 함께 */
function sectionJoView(body: string, jo: string): string | undefined {
  const want = jo.replace(/^제\s*/, "").replace(/\s*(조|절)$/, "").trim()
  if (!/^\d+(?:\.\d+)+$/.test(want)) return undefined
  const sections = splitSections(body).filter(s => s.num === want || s.num?.startsWith(`${want}.`))
  if (sections.length === 0) return `[NOT_FOUND] '${want}' 절을 찾지 못했습니다. keyword 파라미터로 본문을 검색해 보세요.\n⚠️ LLM은 기준 내용을 추측/생성하지 마세요.`
  return sections.map(s => s.text).join("\n\n")
}

function joView(parsed: ParsedAdminRule, jo: string, context: number, body = ""): string {
  const hit = findArticle(parsed, jo)
  if (!hit) {
    if (parsed.articles.length === 0) return sectionJoView(body, jo) ?? NO_ARTICLE_MSG
    const range = `${parsed.articles[0].label.split(/[\s(（]/u)[0]} ~ ${parsed.articles[parsed.articles.length - 1].label.split(/[\s(（]/u)[0]}`
    return `[NOT_FOUND] '${jo}'에 해당하는 조문을 찾지 못했습니다. (수록 범위: ${range}, 총 ${parsed.articles.length}개조)\n` +
      "keyword 파라미터로 본문을 검색해 보세요.\n⚠️ LLM은 조문 내용을 추측/생성하지 마세요."
  }
  const idx = parsed.articles.indexOf(hit)
  const n = Math.max(0, Math.min(context || 0, 10))
  const slice = parsed.articles.slice(Math.max(0, idx - n), idx + n + 1)
  // 장 제목은 (편, 장)으로 찾는다 — 장 번호만으로 찾으면 다른 편의 같은 번호 장 제목이 붙었다
  const head = headings(parsed, hit.part, hit.chapter).join("\n")
  return (head ? `${head}\n\n` : "") + renderArticles(slice)
}

/** (편, 장) 헤더 원문 — 본문에 헤더가 없는 쪽은 빠진다 */
function headings(parsed: ParsedAdminRule, part: string, chapter?: string): string[] {
  const p = part ? parsed.parts.find((x) => x.key === part)?.title : ""
  const c = chapter ? parsed.chapters.find((x) => x.part === part && x.key === chapter)?.title : ""
  return [p, c].filter((s): s is string => Boolean(s))
}

const firstToken = (a: AdminRuleArticle) => a.label.split(/[\s(（<]/u)[0]

function chapterView(parsed: ParsedAdminRule, chapter: string): string {
  if (parsed.articles.length === 0) return NO_ARTICLE_MSG
  const want = normalizeChapter(chapter)
  if (!want) return `[NOT_FOUND] chapter 값 '${chapter}'을(를) 해석하지 못했습니다. "제9장" 형식(편이 있는 규칙은 "제4편 제3장")으로 지정하세요.`
  const items = parsed.articles.filter((a) =>
    (want.part === undefined || a.part === want.part) && (want.chapter === undefined || a.chapter === want.chapter))
  const label = (part: string, ch?: string) => [part && structLabel(part, "편"), ch && structLabel(ch, "장")].filter(Boolean).join(" ")
  if (items.length === 0) {
    const avail = [...new Set(parsed.articles.map((a) => label(a.part, a.chapter)))].filter(Boolean).join(", ")
    return `[NOT_FOUND] ${label(want.part ?? "", want.chapter)}에 속한 조문이 없습니다. (수록 장: ${avail || "구분 없음"})`
  }
  // 편마다 장 번호가 1부터 다시 시작한다 — 편 없이 장만 주었는데 여러 편에 있으면 섞지 말고 고르게 한다
  const partsHit = [...new Set(items.map((a) => a.part))]
  if (want.part === undefined && partsHit.length > 1) {
    const rows = partsHit.map((p) => {
      const group = items.filter((a) => a.part === p)
      const range = `${firstToken(group[0])}${group.length > 1 ? `~${firstToken(group[group.length - 1])}` : ""}`
      return `  - chapter:"${label(p, want.chapter)}" — ${headings(parsed, p, want.chapter).join(" > ") || label(p, want.chapter)} (조문 ${group.length}개, ${range})`
    })
    return `${structLabel(want.chapter!, "장")}이(가) ${partsHit.length}개 편에 있습니다 (편마다 장 번호가 다시 시작) — 편을 함께 지정하세요:\n${rows.join("\n")}`
  }
  const part = want.part ?? items[0].part
  const title = headings(parsed, part, want.chapter).join(" > ") || label(want.part ?? "", want.chapter)
  let text = `${title}  (조문 ${items.length}개)\n\n` + renderArticles(items)
  if (text.length > MAX_RESPONSE_SIZE) {
    text = `⚠️ 이 장은 ${text.length.toLocaleString()}자로 응답 한도를 넘습니다 — jo 파라미터로 조문 단위로 좁히세요.\n\n` + text
  }
  return text
}

/**
 * 이 요청의 응답 문자 한도: tool-registry 최종 게이트가 자르는 값(MCP_MAX_TOOL_RESPONSE_CHARS — 요청 예산에 같은
 * 값이 실린다)과 도구 안 절단 상한(MAX_RESPONSE_SIZE) 중 작은 쪽
 */
function responseCharLimit(): number {
  return Math.min(MAX_RESPONSE_SIZE, requestContext.getStore()?.budget?.limits.maxToolResponseChars ?? MAX_RESPONSE_SIZE)
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
  const totalPages = Math.max(1, boundaries.length - 1)
  const p = Math.max(1, Math.min(Math.trunc(page) || 1, totalPages))
  const text = fullText.slice(boundaries[p - 1] ?? 0, boundaries[p] ?? fullText.length)
  return { text, page: p, totalPages }
}

/**
 * 부분 조회 본문 생성 — 호출부는 규칙명·공포일 헤더를 앞에 붙인다.
 * extras: 부칙·별표 블록 (keyword 가 조문에서 못 찾으면 이어 찾는다) / headerChars: 호출부 머리말 길이 (page 크기 산정) /
 * parsed: 캐시해 둔 body 파싱 결과 (없으면 여기서 파싱)
 */
export function buildPartialBody(
  body: string, fullText: string, params: PartialParams,
  opts: { extras?: ExtraBlock[], headerChars?: number, parsed?: ParsedAdminRule } = {},
): { label: string, text: string, note?: string } {
  const { mode, ignored } = pickPartialMode(params)
  const note = ignored.length ? `※ 복수 파라미터 중 우선순위에 따라 '${mode}'만 적용했습니다 (무시: ${ignored.join(", ")}).` : undefined
  const parsed = opts.parsed ?? parseAdminRuleArticles(body)
  switch (mode) {
    case "jo":
      return { label: `조문 조회: ${params.jo}`, text: joView(parsed, params.jo!, params.context || 0, body), note }
    case "chapter":
      return { label: `장 조회: ${params.chapter}`, text: chapterView(parsed, params.chapter!), note }
    case "keyword":
      return { label: `본문 검색: ${params.keyword}`, text: keywordView(parsed, params.keyword!, params.max_results || 10, body, opts.extras), note }
    case "page": {
      // 페이지 크기 = 실제 응답 한도 − 머리말 − 라벨·다음 안내 몫(200). 4.5만 고정이면 한도를 3만으로 낮춘 배포에서
      // page 1 이 잘리고 page 2 는 4.5만 자부터라 그 사이를 읽을 길이 없었다. page 는 최하위 우선순위라 무시 안내가 붙지 않는다
      const size = Math.max(500, responseCharLimit() - (opts.headerChars ?? 0) - 200)
      const r = paginateFullText(fullText, params.page || 1, size)
      const tail = r.page < r.totalPages ? `\n\n▶ 다음: page:${r.page + 1}` : ""
      return { label: `페이지 ${r.page}/${r.totalPages}`, text: r.text + tail, note }
    }
    default:
      return { label: "", text: fullText, note }
  }
}
