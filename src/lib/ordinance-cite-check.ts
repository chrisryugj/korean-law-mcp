/**
 * 조례 조별 근거법 대조 (ordinance_radar 의 조별 대조).
 *
 * 조례 조문이 인용한 상위법 조("「주차장법」 제12조제6항", "법 제19조", "영 제6조", "같은 법 시행령 제8조")를 뽑고,
 * 그 조례 조의 마지막 개정일(<개정 2019. 3. 7.>, 없으면 조례 시행일)에 시행 중이던 상위법 판과 오늘 판에서 그 조를 맞댄다.
 * 일부개정 때 손대지 않은 조례 조가 상위법 조의 개정·삭제를 따라가지 못한 것을 찾는다.
 * 업스트림 예산 때문에 상위법 판마다 전문을 한 번만 받고(조마다 받지 않는다), 법령당 옛 판은 넷, 전체 전문은 열넷까지만 받는다(요청당 업스트림 48회·본문 24MB 안).
 */
import type { LawApiClient } from "./api-client.js"
import { toArray } from "./xml-parser.js"
import { cleanHtml } from "./article-parser.js"
import { fetchLineageVersions, versionInForce } from "./law-lineage.js"
import { rethrowIfFatal } from "./fatal-errors.js"

export interface OrdinanceCite {
  /** 조례 쪽 자리 ("제15조") */
  ordArticle: string
  /** 상위법 이름 */
  lawName: string
  jo: number
  branch: number
  hang?: number
  /** 그 조례 조의 기준일 YYYYMMDD */
  refDate: string
}

const CITE_RE = /(「([^「」]{2,60})」\s*|같은\s*법\s*(시행령|시행규칙)?\s*|(?<![가-힣])(법|영|시행령|시행규칙)\s*)제\s*(\d+)\s*조(?:\s*의\s*(\d+))?(?:\s*제\s*(\d+)\s*항)?/g
const AMEND_DATE_RE = /<(?:개정|신설|전문개정)\s*([^>]{4,200})>/g

/** "<개정 2019. 3. 7., 2021. 4. 16.>" 의 가장 늦은 날짜 */
function lastAmendDate(text: string): string | undefined {
  let best: string | undefined
  for (const m of text.matchAll(AMEND_DATE_RE)) {
    for (const d of m[1].matchAll(/(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})/g)) {
      const ymd = `${d[1]}${d[2].padStart(2, "0")}${d[3].padStart(2, "0")}`
      if (!best || ymd > best) best = ymd
    }
  }
  return best
}

/** 조례 조문에서 상위법 조 인용. baseLaw·baseDecree = 제1조 근거법(법·영 줄임말이 가리키는 것) */
export function extractOrdinanceCites(
  articles: Array<Record<string, unknown>>, baseLaw: string | undefined, ordEff: string,
): OrdinanceCite[] {
  const out: OrdinanceCite[] = []
  const seen = new Set<string>()
  for (const a of articles) {
    const text = cleanHtml(String(a.조내용 ?? ""))
    const label = text.match(/^\s*제\s*\d+\s*조(?:\s*의\s*\d+)?/)?.[0]?.replace(/\s+/g, "") ?? ""
    if (!label) continue
    const articleDate = lastAmendDate(text) ?? ordEff
    // 항마다 개정 표시가 있으면 그 항의 날짜(③ <신설 2014. 5. 14.> 는 다른 항이 2023 에 고쳐져도 2014 기준)
    const hangStarts = [...text.matchAll(/[①-⑳]/g)].map(x => x.index!)
    const refDateAt = (pos: number): string => {
      const start = [...hangStarts].reverse().find(i => i <= pos)
      if (start === undefined) return articleDate
      const end = hangStarts.find(i => i > start) ?? text.length
      return lastAmendDate(text.slice(start, end)) ?? articleDate
    }
    let lastLaw = baseLaw
    for (const m of text.matchAll(CITE_RE)) {
      const refDate = refDateAt(m.index!)
      let law: string | undefined
      if (m[2]) {
        if (!/(법|법률|시행령|시행규칙)$/.test(m[2].trim())) continue
        law = m[2].trim()
        lastLaw = law.replace(/\s*(시행령|시행규칙)$/, "")
      } else if (/^같은/.test(m[1])) {
        law = m[3] ? `${lastLaw} ${m[3]}` : lastLaw
      } else if (m[4] === "법") law = baseLaw
      else if (m[4] === "영" || m[4] === "시행령") law = baseLaw ? `${baseLaw} 시행령` : undefined
      // 조례 본문의 맨 "시행규칙" 은 근거법 시행규칙이다(조례 자신의 규칙은 「…조례 시행규칙」 으로 적는다)
      else if (m[4] === "시행규칙") law = baseLaw ? `${baseLaw} 시행규칙` : undefined
      if (!law) continue
      const c: OrdinanceCite = { ordArticle: label, lawName: law, jo: Number(m[5]), branch: m[6] ? Number(m[6]) : 0, hang: m[7] ? Number(m[7]) : undefined, refDate }
      const key = `${c.ordArticle}|${c.lawName}|${c.jo}|${c.branch}|${c.hang ?? ""}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(c)
    }
  }
  return out
}

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"

/** 상위법 전문 JSON 의 한 조(또는 한 항) 글. 개정 표시·공백을 걷는다. 없으면 undefined */
function articleText(lawJson: any, jo: number, branch: number, hang?: number): string | undefined {
  const unit = toArray<any>(lawJson?.법령?.조문?.조문단위).find(u => u?.조문여부 === "조문" && Number(u.조문번호) === jo && (Number(u.조문가지번호 || 0) || 0) === branch)
  if (!unit) return undefined
  const strip = (t: unknown) => cleanHtml(String(t ?? "")).replace(/<[^>]*(?:개정|신설|삭제|타법)[^>]*>/g, "").replace(/\s+/g, "")
  if (hang) {
    const h = toArray<any>(unit.항).find(x => String(x?.항번호 ?? "").trim().startsWith(CIRCLED[hang - 1]) || Number(String(x?.항번호 ?? "").replace(/\D/g, "")) === hang)
    if (h) {
      const parts = [h.항내용, ...toArray<any>(h.호).map(ho => ho?.호내용)]
      return strip(parts.join(""))
    }
  }
  const parts = [unit.조문내용, ...toArray<any>(unit.항).flatMap(h => [h?.항내용, ...toArray<any>(h?.호).map(ho => ho?.호내용)])]
  return strip(parts.join(""))
}
const isDeleted = (t: string | undefined) => t !== undefined && /^(?:제\d+조(?:의\d+)?)?(?:\([^)]*\))?(?:[①-⑳])?삭제/.test(t)

export interface CiteFinding { cite: OrdinanceCite; kind: "deleted" | "changed" | "missing"; refEfYd: string }

/**
 * 인용마다 기준일 판과 오늘 판을 맞댄다. laws = 상위법 이름 → { lawId, 현행 mst }
 * 반환: 바뀐 인용, 같은 인용 수, 못 본 인용 수
 */
export async function compareOrdinanceCites(
  apiClient: LawApiClient, cites: OrdinanceCite[], laws: Map<string, { lawId: string; mst: string }>, apiKey?: string,
): Promise<{ findings: CiteFinding[]; same: number; unchecked: number }> {
  const findings: CiteFinding[] = []
  let same = 0, unchecked = 0
  let fullTexts = 0
  const MAX_FULL_TEXTS = 14
  const byLaw = new Map<string, OrdinanceCite[]>()
  for (const c of cites) byLaw.set(c.lawName, [...(byLaw.get(c.lawName) ?? []), c])
  for (const [name, list] of byLaw) {
    const law = laws.get(name)
    if (!law?.lawId || fullTexts + 1 >= MAX_FULL_TEXTS) { unchecked += list.length; continue }
    try {
      const { versions } = await fetchLineageVersions(apiClient, law.lawId, apiKey)
      const current = JSON.parse(await apiClient.getLawText({ lawId: law.lawId, apiKey }))
      fullTexts++
      // 기준일마다 그날 시행 판. 법령당 옛 판 셋까지(많이 쓰인 판부터)
      const olds = new Map<string, { mst: string; efYd: string }>()
      for (const c of list) {
        const v = versionInForce(versions, c.refDate)
        if (v) olds.set(c.refDate, { mst: v.mst, efYd: v.efYd })
      }
      const counts = new Map<string, number>()
      for (const v of olds.values()) counts.set(`${v.mst}:${v.efYd}`, (counts.get(`${v.mst}:${v.efYd}`) ?? 0) + 1)
      const keep = new Set([...counts].sort((a, b) => b[1] - a[1]).slice(0, Math.min(4, MAX_FULL_TEXTS - fullTexts)).map(x => x[0]))
      const texts = new Map<string, any>()
      for (const key of keep) {
        const [mst, efYd] = key.split(":")
        texts.set(key, JSON.parse(await apiClient.getLawText({ mst, efYd, apiKey })))
        fullTexts++
      }
      for (const c of list) {
        const v = olds.get(c.refDate)
        const key = v ? `${v.mst}:${v.efYd}` : ""
        const old = texts.get(key)
        if (!v || !old) { unchecked++; continue }
        const was = articleText(old, c.jo, c.branch, c.hang), now = articleText(current, c.jo, c.branch, c.hang)
        if (was === undefined) { unchecked++; continue } // 그때도 없던 조(인용 오기·장 구조 차이)는 판정하지 않는다
        if (now === undefined) findings.push({ cite: c, kind: "missing", refEfYd: v.efYd })
        else if (isDeleted(now) && !isDeleted(was)) findings.push({ cite: c, kind: "deleted", refEfYd: v.efYd })
        else if (now !== was) findings.push({ cite: c, kind: "changed", refEfYd: v.efYd })
        else same++
      }
    } catch (error) {
      rethrowIfFatal(error)
      unchecked += list.length
    }
  }
  return { findings, same, unchecked }
}
