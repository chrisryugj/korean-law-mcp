/**
 * 행정규칙 발령 연혁 — 행정규칙ID 로 묶은 버전 목록과 기준일 시행 버전 (v4.15.0)
 *
 * 고시·훈령·예규는 개정마다 행정규칙일련번호가 새로 붙고, 행정규칙ID 가 계보를 잇는다.
 * 실측(2026-09-28): 「스프링클러설비의 화재안전기준(NFSC 103)」 2004년 제정본부터 2022.12.1. 전부개정
 * 「…화재안전성능기준(NFPC 103)」까지 21개 버전이 행정규칙ID 35312 하나다. 그런데 법령의 eflaw LID 와 달리
 * admrul 검색은 ID 필터(LID·ID·admRulId)를 조용히 무시하고 전 목록(약 15만 건)을 준다. 그래서 이름 검색
 * (nw=2 = 연혁+현행)으로 받은 뒤 ID 로 묶는다. 검색은 개명 전 이름까지 함께 맞춰 준다(NFPC 로 찾으면 NFSC 행 포함).
 */
import type { LawApiClient } from "./api-client.js"
import { extractTag } from "./xml-parser.js"
import { INTERPUNCT_CHARS } from "./law-search.js"

export interface AdminRuleVersion {
  /** 행정규칙일련번호 — get_admin_rule 의 id */
  serial: string
  /** 행정규칙ID — 개정·개명을 가로지르는 계보 키 */
  ruleId: string
  name: string
  kind: string
  issuedYd: string
  issuedNo: string
  efYd: string
  rrCls: string
  org: string
  isCurrent: boolean
}

/** 업스트림 display 상한 */
const PAGE_SIZE = 100
/** 연혁 검색 안전 상한 — "화재안전" 처럼 넓은 검색어는 600건에 이른다 */
const MAX_PAGES = 3

export function parseAdminRuleRows(xml: string): AdminRuleVersion[] {
  const out: AdminRuleVersion[] = []
  for (const m of xml.matchAll(/<admrul[^>]*>([\s\S]*?)<\/admrul>/g)) {
    const c = m[1]
    const serial = extractTag(c, "행정규칙일련번호")
    const ruleId = extractTag(c, "행정규칙ID")
    if (!serial || !ruleId) continue
    out.push({
      serial,
      ruleId,
      name: extractTag(c, "행정규칙명"),
      kind: extractTag(c, "행정규칙종류"),
      issuedYd: extractTag(c, "발령일자"),
      issuedNo: extractTag(c, "발령번호"),
      efYd: extractTag(c, "시행일자"),
      rrCls: extractTag(c, "제개정구분명"),
      org: extractTag(c, "소관부처명"),
      isCurrent: extractTag(c, "현행연혁구분") === "현행",
    })
  }
  return out
}

/** 시행일 → 발령일 내림차순 */
const byEffectiveDesc = (a: AdminRuleVersion, b: AdminRuleVersion) =>
  (b.efYd || b.issuedYd).localeCompare(a.efYd || a.issuedYd) || b.issuedYd.localeCompare(a.issuedYd)

/** 이름 검색(nw=2)으로 연혁+현행을 받아 행정규칙ID 별로 묶는다. 각 묶음은 시행일 내림차순 */
export async function fetchAdminRuleHistory(
  apiClient: LawApiClient,
  query: string,
  apiKey?: string,
): Promise<{ groups: Map<string, AdminRuleVersion[]>, totalCount: number, truncated: boolean }> {
  const first = await apiClient.searchAdminRule({ query, nw: "2", display: PAGE_SIZE, apiKey })
  const totalCount = parseInt(extractTag(first, "totalCnt") || "0", 10) || 0
  const pages = Math.min(MAX_PAGES, Math.max(1, Math.ceil(totalCount / PAGE_SIZE)))
  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) => apiClient.searchAdminRule({ query, nw: "2", display: PAGE_SIZE, page: i + 2, apiKey })),
  )
  const groups = new Map<string, AdminRuleVersion[]>()
  const seen = new Set<string>()
  for (const row of [first, ...rest].flatMap(parseAdminRuleRows)) {
    if (seen.has(row.serial)) continue
    seen.add(row.serial)
    const list = groups.get(row.ruleId) ?? []
    list.push(row)
    groups.set(row.ruleId, list)
  }
  for (const list of groups.values()) list.sort(byEffectiveDesc)
  return { groups, totalCount, truncated: pages * PAGE_SIZE < totalCount }
}

const INTERPUNCT_RE = new RegExp(`[${INTERPUNCT_CHARS}]`, "g")
const nameKey = (s: string) => s.replace(/\s+/g, "").replace(INTERPUNCT_RE, "")
/** 이름 끝 괄호 코드("(NFSC 103)")를 뗀 비교 키 */
const baseKey = (s: string) => nameKey(s.replace(/\s*\([^()]*\)\s*$/, ""))
/** 화재안전기준 코드 — NFSC·NFPC 는 같은 계보(성능기준), NFTC 는 2022.12.1. 신설된 별도 계보(기술기준) */
const NF_CODE_RE = /\bNF([SPT])C\s*(\d+[A-Z]?)\b/i

export function nfCode(name: string): { family: "performance" | "technical", code: string } | undefined {
  const m = name.match(NF_CODE_RE)
  if (!m) return undefined
  return { family: m[1].toUpperCase() === "T" ? "technical" : "performance", code: m[2].toUpperCase() }
}

/**
 * 검색어에 해당하는 계보 하나. ① 어느 버전 이름과 완전일치 ② 괄호 코드를 뗀 이름과 일치
 * ③ 화재안전기준 코드(NFSC 103 등) 일치. 여럿이 걸리거나 이름이 안 맞으면 고르지 않는다 — 검색 결과가 한 묶음뿐이어도
 * 이름이 다르면 무관한 규칙일 수 있다(오타 난 법령명에 엉뚱한 고시로 기준일 판단을 내면 안 된다).
 */
export function pickAdminRuleGroup(groups: Map<string, AdminRuleVersion[]>, query: string): AdminRuleVersion[] | undefined {
  const all = [...groups.values()]
  const unique = (hits: AdminRuleVersion[][]) => (hits.length === 1 ? hits[0] : undefined)
  const q = nameKey(query)
  const exact = all.filter(g => g.some(v => nameKey(v.name) === q))
  if (exact.length > 0) return unique(exact)
  const base = all.filter(g => g.some(v => baseKey(v.name) === q))
  if (base.length > 0) return unique(base)
  const wanted = nfCode(query)
  if (wanted) {
    const coded = all.filter(g => g.some(v => {
      const c = nfCode(v.name)
      return c?.code === wanted.code && c.family === wanted.family
    }))
    if (coded.length > 0) return unique(coded)
  }
  return undefined
}

/** 발령번호 비교 — 숫자 마디별로("2013-5" < "2013-21"). 문자열 비교는 "2013-5"를 뒤로 친다 */
function compareIssuedNo(a: string, b: string): number {
  const pa = a.match(/\d+/g) ?? []
  const pb = b.match(/\d+/g) ?? []
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = parseInt(pa[i] ?? "0", 10) - parseInt(pb[i] ?? "0", 10)
    if (d) return d
  }
  return 0
}

/**
 * 기준일에 시행 중이던 버전 = 시행일이 기준일 이하인 버전 중 발령일이 가장 늦은 것(같은 날이면 발령번호가 큰 것).
 * 행정규칙 본문은 발령 시점의 전문이라 뒤 발령본이 앞 개정을 이미 담는다. 시행일 최신으로 고르면 먼저 발령되고 늦게 시행된
 * 개정본이 뒤 발령본을 덮는다: 2013년 NFSC 103 은 2013-18호(발령 6.10.·시행 8.11.) 뒤에 2013-21호(발령 6.11.·시행 7.12.)가
 * 30층 이상 수원 기준 등을 삭제했는데, 2013.8.11.~2015.3.23. 기준일에 삭제 전 18호 본문을 냈다(감사 실측).
 * 반대로 기준일에 뒤 발령본만 시행 중이면 그 본문에 아직 시행 전인 앞 개정이 섞여 있다 — 그 사실을 note 로 알린다.
 */
export function adminVersionAt(
  group: AdminRuleVersion[],
  ymd: string,
): { version?: AdminRuleVersion, note?: string, abolished?: AdminRuleVersion } {
  const version = group
    .filter(v => (v.efYd || v.issuedYd) <= ymd)
    .reduce<AdminRuleVersion | undefined>((best, v) =>
      !best || v.issuedYd > best.issuedYd || (v.issuedYd === best.issuedYd && compareIssuedNo(v.issuedNo, best.issuedNo) > 0) ? v : best,
    undefined)
  if (!version) return {}
  // 폐지 행은 "시행 중 버전"이 아니다 — 그날 이미 폐지된 규칙이다
  if (/폐지$/.test(version.rrCls)) return { abolished: version }
  const pending = group.find(v => v !== version && v.issuedYd <= version.issuedYd && (v.efYd || v.issuedYd) > ymd)
  const note = pending
    ? `기준일에 아직 시행 전이던 제${pending.issuedNo}호(발령 ${pending.issuedYd}, 시행 ${pending.efYd})가 이 버전보다 먼저 발령돼, 이 버전 본문에 그 개정이 섞여 있을 수 있습니다.`
    : undefined
  return { version, note }
}
