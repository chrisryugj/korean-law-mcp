/**
 * 생활법령 Open API 키워드 통합검색(getSearchAllKeywordList) 응답 → 분류별 목록.
 * 통합검색 한 번에 생활분야·관심규정해설·백문백답·판례·헌재·행정심판·해석례·생활조례 목록이 섹션별로 온다.
 * 항목마다 get_life_law 로 본문 전문을 받을 식별값(kind·ids)을 함께 싣는다.
 */
import { cleanHtml } from "./article-parser.js"
import { easylawItems, type EasylawItem } from "./easylaw-client.js"

const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "")
export const easyText = (v: unknown, max = 500): string => {
  const t = cleanHtml(str(v).replace(/<\/p>|<br\s*\/?>/gi, " ")).replace(/\s+/g, " ").trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

interface SectionSpec {
  key: string
  label: string
  title: string[]
  question?: string[]
  body: string[]
  path?: string
  link: string[]
  /** get_life_law 로 본문을 받을 식별값 */
  ids?: (it: EasylawItem) => string
}

const guideIds = (it: EasylawItem) => `kind="guide", csmSeq=${str(it.csmSeq)}, ccfNo=${str(it.ccfNo)}, cciNo=${str(it.cciNo)}, cnpClsNo=${str(it.cnpClsNo)}`
export const bylawIds = (it: EasylawItem) => `kind="bylaw", rgnbyCsmodnSeq=${str(it.rgnbyCsmodnSeq)}, itrfldNo=${str(it.itrfldNo)}, itritmNo=${str(it.itritmNo)}, itrrlNo=${str(it.itrrlNo)}`
const qaIds = (it: EasylawItem) => `kind="qa", onhunqnaAstSeq=${str(it.onhunqnaAstSeq)}, onhunqueSeq=${str(it.onhunqueSeq)}`

export const SECTIONS: SectionSpec[] = [
  { key: "SearchLifeArea", label: "생활분야", title: ["csmTtl"], body: [], path: "tree", link: ["titleLink"] },
  { key: "SearchInterrestRule", label: "관심규정해설", title: ["title"], body: ["ov"], path: "tree", link: ["cnpClsNmLink"], ids: guideIds },
  { key: "MaskMAnswerSearchContent", label: "백문백답", title: ["onhunqueSubjNm"], question: ["onhunqueCts"], body: ["onhunansCts"], link: ["webTitleLink"], ids: qaIds },
  { key: "MaskMAnswerLawName", label: "백문백답(관련 법령)", title: ["onhunqnaAstNm"], question: ["onhunqueCts"], body: ["onhunqueConLsiNm"], link: ["webTitleLink"], ids: qaIds },
  { key: "SearchEasyBylaw", label: "생활조례", title: ["rgnbyCsmodnTtl", "itrrlNm"], body: ["itrrlExpstCn"], path: "itrfldTtl", link: [], ids: bylawIds },
  { key: "SearchGroupArea", label: "분류", title: ["title"], body: [], path: "allTree", link: ["titleLink"], ids: guideIds },
  { key: "SearchSuperMePrecedent", label: "대법원판례", title: ["cnpClsNm"], question: ["judItm"], body: ["precGst"], link: ["cnpClsNmLink"] },
  { key: "SearchConstCourtPrecedent", label: "헌법재판소결정례", title: ["cnpClsNm"], question: ["dtmItm"], body: ["detcGst"], link: ["cnpClsNmLink"] },
  { key: "SearchAadminReferee", label: "행정심판재결례", title: ["cnpClsNm"], body: ["evl"], link: ["cnpClsNmLink"] },
  { key: "SearchLawInter", label: "법령해석례", title: ["cnpClsNm"], question: ["inq"], body: ["rpl"], path: "csmTree", link: ["cnpClsNmLink"] },
]

const first = (it: EasylawItem, keys: string[]) => keys.map(k => str(it[k])).find(Boolean) ?? ""

/** 통합검색 body.items.item[0] 의 섹션별 목록 → 마크다운. 비면 undefined */
export function renderAllKeyword(body: unknown, maxItems: number): string | undefined {
  const root = easylawItems(body)[0]
  if (!root) return undefined
  const out: string[] = []
  for (const s of SECTIONS) {
    const holder = root[`${s.key}ListItems`] as Record<string, unknown> | undefined
    const raw = holder && typeof holder === "object" ? holder[`${s.key}ListItem`] : undefined
    const items = (Array.isArray(raw) ? raw : raw ? [raw] : []) as EasylawItem[]
    if (!items.length) continue
    const total = Number(str(root[`${s.key}ListCount`])) || items.length
    out.push("", `## ${s.label} (${total}건 중 ${Math.min(items.length, maxItems)}건)`)
    items.slice(0, maxItems).forEach((it, i) => {
      const path = s.path ? str(it[s.path]).split(">").map(p => p.trim()).filter(Boolean).join(" > ") : ""
      out.push(`${i + 1}. ${easyText(first(it, s.title), 120) || "(제목 없음)"}${path ? ` [${path}]` : ""}`)
      const q = s.question ? easyText(first(it, s.question), 300) : ""
      if (q) out.push(`   질문·쟁점: ${q}`)
      const b = easyText(first(it, s.body))
      if (b) out.push(`   ${s.key === "MaskMAnswerLawName" ? "관련 법령" : "발췌"}: ${b}`)
      const link = first(it, s.link)
      if (link) out.push(`   원문: ${link}`)
      if (s.ids) out.push(`   본문 전문: ${s.ids(it)}`)
    })
  }
  return out.length ? out.join("\n") : undefined
}
