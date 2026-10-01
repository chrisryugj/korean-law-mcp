/**
 * 행정규칙 부분 조회의 keyword 뷰 (조문 단위 · 절 단위) + 절 나누기
 */
import type { ParsedAdminRule } from "./admin-rule-articles.js"

/**
 * 조문(제N조) 체계가 없는 본문의 절 — 화재안전기술기준(NFTC)식 "2.7.3" 번호 줄에서 끊는다.
 * 번호 줄이 하나도 없으면(항목식 훈령) 빈 줄 문단으로 끊는다. 종전엔 이런 본문에 jo·keyword 가
 * "조문 체계가 없습니다 — keyword 를 쓰세요"를 돌려줘 keyword 요청에 keyword 를 쓰라는 막다른 안내가 됐다.
 */
export function splitSections(body: string): Array<{ num?: string, text: string }> {
  const lines = body.split("\n")
  const numbered = lines.some(l => /^\s*\d+\.\d+(?:\.\d+)*\s/.test(l))
  if (!numbered) {
    return body.split(/\n\s*\n/).map(t => ({ text: t.trim() })).filter(p => p.text)
  }
  const out: Array<{ num?: string, lines: string[] }> = []
  for (const line of lines) {
    const m = line.match(/^\s*(\d+(?:\.\d+)*)\.?\s/)
    if (m || out.length === 0) out.push({ num: m?.[1], lines: [line] })
    else out[out.length - 1].lines.push(line)
  }
  return out.map(s => ({ num: s.num, text: s.lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() })).filter(s => s.text)
}

/**
 * 키워드 첫 매칭을 품은 max 자 안팎의 발췌. 앞 max 자만 자르면 긴 조문(외국환거래규정 제1-2조 9,880자)에서
 * 매칭 부분이 빠졌다. 창은 줄 경계에 맞추고, 앞을 건너뛰면 첫 줄(조문 제목)을 남긴다.
 */
function excerptAround(text: string, kw: string, max: number): string {
  if (text.length <= max) return text
  const at = Math.max(0, text.indexOf(kw))
  let start = Math.max(0, Math.min(at - Math.floor(max / 3), text.length - max))
  const lineStart = text.lastIndexOf("\n", start) + 1
  if (at + kw.length <= lineStart + max) start = lineStart // 줄 머리로 당겨도 매칭이 창 안에 있을 때만
  let end = Math.min(text.length, start + max)
  const lineEnd = text.lastIndexOf("\n", end)
  if (end < text.length && lineEnd > at + kw.length) end = lineEnd
  const firstLineEnd = text.indexOf("\n")
  const head = start > 0 && firstLineEnd > 0 ? `${text.slice(0, Math.min(firstLineEnd, 200))}\n   …\n` : ""
  return head + text.slice(start, end)
}

function sectionKeywordView(body: string, kw: string, maxResults: number): string {
  const hits = splitSections(body).filter(s => s.text.includes(kw))
  if (hits.length === 0) return `[NOT_FOUND] 본문에 '${kw}'을(를) 포함한 절이 없습니다.\n⚠️ LLM은 기준 내용을 추측/생성하지 마세요.`
  const cap = Math.max(1, Math.min(maxResults || 10, 30))
  const labels = hits.map(s => s.num).filter(Boolean)
  let text = `'${kw}' 포함 ${hits.length}곳${labels.length ? `: ${labels.join(", ")}` : ""}\n`
  text += hits.length > cap ? `(아래 본문은 상위 ${cap}곳 — 절 번호는 jo:"2.7.3"처럼 조회)\n\n` : "\n"
  return text + hits.slice(0, cap).map(s => s.text.length > 2500 ? `${excerptAround(s.text, kw, 2500)}\n   …` : s.text).join("\n\n---\n\n")
}

export function keywordView(parsed: ParsedAdminRule, keyword: string, maxResults: number, body = ""): string {
  const kw = keyword.trim()
  if (!kw) return "[NOT_FOUND] keyword 가 비어 있습니다 — 검색어를 지정하세요."
  if (parsed.articles.length === 0) return sectionKeywordView(body, kw, maxResults)
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
    if (body.length > PER) body = excerptAround(body, kw, PER) + `\n   … (이 조문 ${body.length.toLocaleString()}자 — jo:"${joLabel}"로 전체 조회)`
    text += `${body}\n\n---\n\n`
  }
  return text.replace(/\n\n---\n\n$/u, "")
}
