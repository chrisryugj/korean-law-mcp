/**
 * search_law 검색 결과 항목 — 법제처 XML → 표시 문자열 어댑터
 */

import { DOMParser } from "@xmldom/xmldom"
import { normalizeAliasKey, resolveLawAlias } from "../lib/search-normalizer.js"

export interface LawHit {
  name: string
  abbr: string
  lawId: string
  mst: string
  promDate: string
  effDate: string
  statusCode: string // 현행연혁코드: "현행" | "연혁" | "" (API 미제공)
  lawType: string
}

export function parseLawsXml(xmlText: string): LawHit[] {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml")
  const out: LawHit[] = []
  const nodes = doc.getElementsByTagName("law")
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    out.push({
      name: n.getElementsByTagName("법령명한글")[0]?.textContent || "알 수 없음",
      abbr: n.getElementsByTagName("법령약칭명")[0]?.textContent || "",
      lawId: n.getElementsByTagName("법령ID")[0]?.textContent || "",
      mst: n.getElementsByTagName("법령일련번호")[0]?.textContent || "",
      promDate: n.getElementsByTagName("공포일자")[0]?.textContent || "",
      effDate: n.getElementsByTagName("시행일자")[0]?.textContent || "",
      statusCode: n.getElementsByTagName("현행연혁코드")[0]?.textContent || "",
      lawType: n.getElementsByTagName("법령구분명")[0]?.textContent || "",
    })
  }
  return out
}

// 법제처 API는 특정 쿼리("AI법" 등)에서 검색어를 무시하고 무관한 법령 목록을 반환할 때가 있음.
// 결과 중 최소 1건은 법령명/약칭이 쿼리와 포함 관계여야 유효한 검색 결과로 인정.
export function hasRelatedHit(laws: LawHit[], query: string): boolean {
  const qKey = normalizeAliasKey(query)
  if (!qKey) return false
  return laws.some((h) => {
    const nameKey = normalizeAliasKey(h.name)
    if (nameKey.includes(qKey) || qKey.includes(nameKey)) return true
    if (!h.abbr) return false
    const abbrKey = normalizeAliasKey(h.abbr)
    return abbrKey.includes(qKey) || qKey.includes(abbrKey)
  })
}

/**
 * 현행 우선 정렬 (원본 불변).
 *
 * 연혁(과거버전)이 첫 항목으로 오면 LLM 이 옛 조문을 현행으로 오인한다
 * (소방시설법 분법 사례). search_law 와 search_law_bulk 가 같은 법령을 골라야
 * 하므로 판정은 여기 한 곳에 둔다.
 */
export function sortCurrentFirst(laws: LawHit[]): LawHit[] {
  const rank = (h: LawHit) => (h.statusCode === "연혁" ? 1 : 0)
  return [...laws].sort((a, b) => rank(a) - rank(b))
}

/**
 * 정확매칭 분리.
 *
 * 법제처 API 는 LIKE 검색 + 가나다순이라 "상법" 같이 짧은 법령명이
 * "보상법/배상법/기상법" 사이에 묻힌다. 법령명·약칭이 입력(또는 canonical alias)과
 * 같으면 앞세운다.
 */
export function splitExactPartial(laws: LawHit[], query: string): { exact: LawHit[]; partial: LawHit[] } {
  const queryKey = normalizeAliasKey(query)
  const canonicalKey = normalizeAliasKey(resolveLawAlias(query).canonical)
  const exact: LawHit[] = []
  const partial: LawHit[] = []
  for (const h of laws) {
    const nameKey = normalizeAliasKey(h.name)
    const abbrKey = h.abbr ? normalizeAliasKey(h.abbr) : ""
    const isExact = nameKey === queryKey
      || nameKey === canonicalKey
      || (abbrKey !== "" && (abbrKey === queryKey || abbrKey === canonicalKey))
    if (isExact) exact.push(h)
    else partial.push(h)
  }
  return { exact, partial }
}

export function formatHit(idx: number, h: LawHit): string {
  const status = h.statusCode === "연혁" ? " ⚠️[연혁-과거버전]" : h.statusCode === "현행" ? " [현행]" : ""
  let line = `${idx}. ${h.name}${status}\n   - 법령ID: ${h.lawId}\n   - MST: ${h.mst}\n   - 공포일: ${h.promDate}`
  if (h.effDate) line += ` / 시행일: ${h.effDate}`
  line += `\n   - 구분: ${h.lawType}\n\n`
  return line
}
