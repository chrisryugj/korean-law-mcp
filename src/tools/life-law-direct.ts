/**
 * 생활법령 Open API 직접 검색(서비스키가 있을 때): 키워드 통합검색, 지자체 생활조례, 외국어 생활법령 목록.
 */
import { callEasylaw, easylawItems } from "../lib/easylaw-client.js"
import { renderAllKeyword, easyText, bylawIds } from "../lib/easylaw-render.js"

/** 외국어 생활법령 언어 코드(활용가이드 langCd). 한국어 원본은 통합검색으로 본다 */
export const LIFE_LAW_LANGS: Record<string, string> = {
  영어: "700101", 중국어: "700102", 아랍어: "700103", 베트남어: "700104", 인도네시아어: "700105", 태국어: "700106",
  일본어: "700107", 우즈베키스탄어: "700108", 몽골어: "700109", 방글라데시어: "700110", 네팔어: "700111", 캄보디아어: "700112",
}

/** 키워드 통합검색 → 분류별 목록(없으면 undefined) */
export async function directAllKeyword(query: string, maxItems: number): Promise<string | undefined> {
  const { body } = await callEasylaw("lifelawsearch/getSearchAllKeywordList.do", { txtQuery: query, pageNo: 1, numOfRows: maxItems })
  return renderAllKeyword(body, maxItems)
}

/**
 * 생활조례(지자체 조례를 쉬운 말로 풀어 쓴 해설) 검색어 조회 → region 이 지자체 이름(itrfldTtl, 예: "경기도 연천군")에 든 것만.
 * 검색어 조회는 전국 결과라 지자체는 결과에서 거른다(지자체 코드 조회 getGbn=1 은 lclgvCd 를 알아야 한다)
 */
export async function directEasyBylaw(query: string, region: string | undefined, maxItems: number): Promise<{ text?: string; total: number; regions: string[]; used: string }> {
  // 검색어 낱말은 모두 들어간 해설만 찾는다(「출산 지원금」 0건, 「출산」 158건). 0건이면 두 자 넘는 낱말 하나씩 다시 찾는다
  const tries = [query, ...query.split(/\s+/).filter(w => w.length >= 2 && w !== query)].slice(0, 4)
  let used = query, totalCount = 0, items: ReturnType<typeof easylawItems> = []
  for (const q of tries) {
    const r = await callEasylaw("easybylaw/getEasyBylawList.do", { getGbn: 2, txtQuery: q, pageNo: 1, numOfRows: 1000 })
    used = q; totalCount = r.totalCount; items = easylawItems(r.body)
    if (items.length) break
  }
  const r = region?.replace(/\s+/g, " ").trim()
  const hit = r ? items.filter(it => String(it.itrfldTtl ?? "").includes(r)) : items
  const regions = [...new Set(items.map(it => String(it.itrfldTtl ?? "")).filter(Boolean))]
  if (!hit.length) return { total: totalCount, regions, used }
  const lines = [`## 생활조례${r ? `: ${r}` : ""} (${hit.length}건${r ? `, 전국 ${totalCount}건 중` : ""})`]
  hit.slice(0, maxItems).forEach((it, i) => {
    lines.push(`${i + 1}. ${easyText(it.rgnbyCsmodnTtl, 120)} · ${easyText(it.itrrlNm, 120)}`)
    const b = easyText(it.itrrlExpstCn)
    if (b) lines.push(`   발췌: ${b}`)
    lines.push(`   본문 전문: ${bylawIds(it)}`)
  })
  return { text: lines.join("\n"), total: totalCount, regions, used }
}

/** 외국어 생활법령 목록(언어별 수십 건) → 제목에 keyword 가 든 것(없으면 전부) */
export async function directMultiLang(langCd: string, keyword: string | undefined): Promise<string | undefined> {
  const { body } = await callEasylaw("multilanglifelaw/getMultiLangLifelawList.do", { getGbn: 1, langCd, pageNo: 1, numOfRows: 1000 })
  const items = easylawItems(body)
  const k = keyword?.toLowerCase().trim()
  const hit = k ? items.filter(it => [it.itrfldTtl, it.itritmNm, it.itrrlNm].some(v => String(v ?? "").toLowerCase().includes(k))) : items
  if (!hit.length) return undefined
  return hit.map((it, i) => `${i + 1}. ${easyText(it.itrfldTtl, 120)}${it.itrrlNm && it.itrrlNm !== it.itrfldTtl ? ` · ${easyText(it.itrrlNm, 120)}` : ""}\n   본문 전문: kind="foreign", csmfldSeq=${it.csmfldSeq}, itrfldNo=${it.itrfldNo}, itritmNo=${it.itritmNo}, itrrlNo=${it.itrrlNo}`).join("\n")
}
