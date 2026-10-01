/**
 * 법령 계보 — 법령ID 하나로 제명변경·전부개정을 가로지르는 전 시행 버전 (v4.15.0)
 *
 * lsHistory 연혁은 법령명 LIKE 검색 뒤 이름 완전일치로 거른다. 그래서 이름이 바뀐 법령은 바뀌기 전
 * 연혁이 통째로 빠졌다. 실측(2026-09-28): 「소방시설 설치 및 관리에 관한 법률 시행령」 lsHistory 9건,
 * 2022.12.1. 전부개정 전 이름 5종(「화재예방, 소방시설 설치ㆍ유지 및 안전관리에 관한 법률 시행령」 등)
 * 70건 누락 → applicable_law 가 2015년 기준일을 "시행 전"으로 답했다.
 *
 * eflaw 검색은 LID(법령ID) 필터를 받아 이름과 무관하게 그 법령ID의 모든 버전을 시행 슬라이스 단위로 준다.
 * 8개 법령 대조(민법·형사소송법·소득세법 시행령·건축법·관세법 등)에서 lsHistory 행을 전부 포함했고
 * (형사소송법에 섞인 1948년 동명 타법 1행만 제외), 분리시행 슬라이스를 더 담았다(소득세법 시행령 +78).
 */
import type { LawApiClient } from "./api-client.js"
import { extractTag } from "./xml-parser.js"
import { findLaws, parseLawXml, INTERPUNCT_CHARS, type LawInfo } from "./law-search.js"
import { normalizeLawSearchText, resolveLawAlias } from "./search-normalizer.js"
import { rethrowIfFatal } from "./fatal-errors.js"
import {
  compareVersionsDesc, fetchHistoricalVersionsFull, parseEffectiveRows,
  type HistoricalFetchResult, type HistoricalVersion,
} from "./historical-utils.js"

/** eflaw 검색 display 상한 */
const LINEAGE_PAGE_SIZE = 100
/** 안전 상한 1,000 슬라이스 (실측 최대: 소득세법 시행령 367) */
const LINEAGE_MAX_PAGES = 10

const INTERPUNCT_RE = new RegExp(`[${INTERPUNCT_CHARS}]`, "g")
/** 공백·가운뎃점 무시 비교 키 */
const nameKey = (s: string) => s.replace(/\s+/g, "").replace(INTERPUNCT_RE, "")

/** 약칭 해소. 표는 통째 이름만 알아서 "소방시설법 시행령"처럼 하위법령 접미가 붙으면 앞부분만 풀고 다시 붙인다 */
function canonicalLawName(lawName: string): string {
  const trimmed = lawName.replace(/\s+/g, " ").trim()
  const m = trimmed.match(/^(.+?)\s*(시행령|시행규칙)$/)
  const base = m ? m[1] : trimmed
  const canonical = resolveLawAlias(normalizeLawSearchText(base)).canonical
  return m ? `${canonical} ${m[2]}` : canonical
}

export interface ResolvedLaw {
  lawId: string
  /** 현행 법령명 — 현행 검색에서 잡혔을 때만 */
  currentName?: string
  /** 입력과 맞은 이름 (옛 이름으로 잡혔으면 옛 이름) */
  matchedName: string
}

/**
 * 법령명(현행명·약칭·옛 이름) → 법령ID.
 * ① 현행 검색에서 이름 완전일치 ② 연혁(eflaw) 검색에서 옛 이름 완전일치 ③ 입력이 현행 1위 이름의 앞부분일 때(하위법령 꼬리 제외).
 * 완전일치를 느슨한 일치보다 먼저 본다: 「…에 관한 법률」은 「…에 관한 법률 시행령」의 접두라 느슨한 비교가 하위법령을 집는다.
 * 반대 방향(입력이 법령명보다 긴 경우)은 받지 않는다 — 「개인정보 보호법 위반에 대한 과징금 부과기준」(고시)이 개인정보 보호법으로,
 * 오타 「건축법 시행렁」이 건축법으로 풀려 행정규칙 갈래에 닿지 못하거나 엉뚱한 법령의 연혁을 냈다(2026-09-28 리뷰).
 */
export async function resolveLawId(apiClient: LawApiClient, lawName: string, apiKey?: string): Promise<ResolvedLaw | undefined> {
  const canonical = canonicalLawName(lawName)
  const keys = new Set([nameKey(lawName), nameKey(canonical)])
  const laws = await findLaws(apiClient, canonical, apiKey, 100)
  const exact = laws.find(l => l.lawId && keys.has(nameKey(l.lawName)))
  if (exact) return { lawId: exact.lawId, currentName: exact.lawName, matchedName: exact.lawName }

  const old = await findFormerName(apiClient, canonical, apiKey, keys)
  if (old) return old

  const top = laws[0]
  const want = nameKey(canonical)
  const official = top ? nameKey(top.lawName) : ""
  if (top?.lawId && want.length >= 2 && official.startsWith(want) && !/^(시행령|시행규칙)/.test(official.slice(want.length))) {
    return { lawId: top.lawId, currentName: top.lawName, matchedName: top.lawName }
  }
  return undefined
}

/**
 * 옛 법령명 → 법령ID. 연혁을 포함하는 eflaw 검색에서 이름이 완전히 같은 행을 찾는다(공백·가운뎃점 무시).
 * 현행 검색은 옛 이름을 모른다 — 「화재예방, 소방시설 설치ㆍ유지 및 안전관리에 관한 법률」은 현행 검색에서 부분매칭만 나온다.
 */
export async function findFormerName(
  apiClient: LawApiClient,
  name: string,
  apiKey?: string,
  keys: Set<string> = new Set([nameKey(name)]),
): Promise<ResolvedLaw | undefined> {
  let rows: LawInfo[] = []
  try {
    rows = parseLawXml(await apiClient.searchLaw(name, apiKey, 100, "eflaw"), 100)
  } catch (error) {
    rethrowIfFatal(error)
  }
  const old = rows
    .filter(r => r.lawId && keys.has(nameKey(r.lawName)))
    .sort((a, b) => (b.effectiveDate || "").localeCompare(a.effectiveDate || ""))[0]
  return old ? { lawId: old.lawId, matchedName: old.lawName } : undefined
}

function fetchLineagePage(apiClient: LawApiClient, lawId: string, page: number, apiKey?: string): Promise<string> {
  return apiClient.fetchApi({
    endpoint: "lawSearch.do",
    target: "eflaw",
    type: "XML",
    extraParams: { LID: lawId, nw: "1,2,3", display: String(LINEAGE_PAGE_SIZE), page: String(page) },
    apiKey,
  })
}

/** 법령ID의 전 시행 슬라이스 (연혁·현행·시행예정, 시행일 내림차순). 첫 페이지로 총계를 안 뒤 나머지는 병렬 */
export async function fetchLineageVersions(apiClient: LawApiClient, lawId: string, apiKey?: string): Promise<HistoricalFetchResult> {
  const first = await fetchLineagePage(apiClient, lawId, 1, apiKey)
  const firstRows = parseEffectiveRows(first)
  // 법령ID 는 0 채움 6자리로 오지만 호출부는 "1638"처럼 줄 수 있다 — 업스트림은 LID=1638 에도 001638 행을 준다(감사 실측).
  // 문자열 그대로 비교하면 행을 전부 버려 계보가 비었다. 앞의 0을 떼고 비교한다
  const wanted = lawId.replace(/^0+/, "")
  const sameId = (id: string) => id.replace(/^0+/, "") === wanted
  // LID 가 무시되면 전 법령 목록(실측 ID= 는 무시돼 16만 행)이 온다. 첫 페이지에 그 법령ID가 없거나 총계가 상한을 넘으면
  // (실측 최대 367행) 필터가 안 걸린 것으로 보고 더 받지 않는다 — 조용히 1,000행에서 자른 목록을 계보로 쓰지 않는다.
  const totalCount = parseInt(extractTag(first, "totalCnt") || "0", 10) || 0
  if (!firstRows.some(r => sameId(r.lawId)) || totalCount > LINEAGE_MAX_PAGES * LINEAGE_PAGE_SIZE) {
    return { versions: [], totalCount: 0, fetchedPages: 1 }
  }

  const pages = Math.min(LINEAGE_MAX_PAGES, Math.max(1, Math.ceil(totalCount / LINEAGE_PAGE_SIZE)))
  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) => fetchLineagePage(apiClient, lawId, i + 2, apiKey)),
  )
  const seen = new Set<string>()
  const versions: HistoricalVersion[] = []
  for (const r of [firstRows, ...rest.map(parseEffectiveRows)].flat()) {
    const key = `${r.mst}:${r.efYd}`
    if (!sameId(r.lawId) || seen.has(key)) continue
    seen.add(key)
    versions.push({ mst: r.mst, efYd: r.efYd, ancNo: r.ancNo, ancYd: r.ancYd, lawNm: r.lawNm, rrCls: r.rrCls })
  }
  versions.sort(compareVersionsDesc)
  return { versions, totalCount, fetchedPages: pages }
}

export interface LawVersionsResult extends HistoricalFetchResult {
  /** lineage: 법령ID 계보(제명변경 포함, 시행 슬라이스 단위) · name: lsHistory 이름 일치(계보 실패 시 폴백) */
  source: "lineage" | "name"
  lawId?: string
}

/**
 * 폐지 후 같은 이름으로 재제정돼 법령ID가 바뀐 법령의 구법 행을 계보 뒤에 붙인다. 계보(LID)는 신법만 준다: 근로기준법은
 * 1997.3.13. 구법 폐지와 같은 날 신법(법령ID 001872)이 제정돼, 1995년 기준일을 "시행 전"으로 답했다(감사 실측 —
 * 이름 일치 lsHistory 를 쓰던 v4.14.2 는 1953년 제정본부터 줬다). 기준일이 계보 시작(제정 행)보다 앞일 때만 lsHistory 를
 * 한 번 더 받는다 — 계보 안의 기준일은 호출 수가 그대로다. 계보 시작일 이하이면서 계보에 없는 MST 를 구법으로 본다.
 * 같은 날의 구법 폐지 행은 신법 제정 행 뒤에 놓여, 재제정일 당일이 "폐지"로 읽히지 않는다.
 */
async function withPriorSameNameLaw(
  apiClient: LawApiClient,
  versions: HistoricalVersion[],
  asOf: string,
  apiKey?: string,
): Promise<HistoricalVersion[]> {
  const first = versions[versions.length - 1]
  if (!first || !/제정$/.test(first.rrCls) || asOf >= first.efYd) return versions
  try {
    const { versions: named } = await fetchHistoricalVersionsFull(apiClient, first.lawNm, apiKey)
    const known = new Set(versions.map(v => v.mst))
    const prior = named
      .filter(v => v.efYd && v.efYd <= first.efYd && !known.has(v.mst))
      .map(v => ({ ...v, priorLaw: true }))
    return prior.length > 0 ? [...versions, ...prior] : versions
  } catch (error) {
    rethrowIfFatal(error)
    return versions
  }
}

/**
 * 법령 전 버전. 법령ID 계보를 먼저 쓰고, 법령ID를 못 찾거나 계보가 비면 종전 lsHistory 이름 일치로 물러선다.
 * lawId 를 이미 아는 호출부(applicable_law·체인)는 넘겨서 검색 왕복을 아낀다.
 * asOf(YYYYMMDD 기준일)를 주면 그날이 계보 시작 전일 때 동명 구법 행까지 싣는다(withPriorSameNameLaw).
 */
export async function fetchLawVersions(
  apiClient: LawApiClient,
  lawName: string,
  apiKey?: string,
  lawId?: string,
  asOf?: string,
): Promise<LawVersionsResult> {
  let id = lawId
  if (!id) {
    try {
      id = (await resolveLawId(apiClient, lawName, apiKey))?.lawId
    } catch (error) {
      rethrowIfFatal(error)
    }
  }
  if (id) {
    try {
      const r = await fetchLineageVersions(apiClient, id, apiKey)
      if (r.versions.length > 0) {
        const versions = asOf ? await withPriorSameNameLaw(apiClient, r.versions, asOf, apiKey) : r.versions
        return { ...r, versions, source: "lineage", lawId: id }
      }
    } catch (error) {
      // 예산 소진·취소는 올리고, 그 밖의 계보 조회 장애는 이름 기반 연혁으로 물러선다
      rethrowIfFatal(error)
    }
  }
  const r = await fetchHistoricalVersionsFull(apiClient, lawName, apiKey)
  return { ...r, source: "name", lawId: id }
}

/** 한국 시각 기준 오늘(YYYYMMDD). 서버는 UTC 라 toISOString 만 쓰면 오전 9시 전엔 시행일 당일 새 버전이 "시행예정"으로 보인다 */
export function todayKst(now = Date.now()): string {
  return new Date(now + 9 * 3_600_000).toISOString().slice(0, 10).replace(/-/g, "")
}

/** 폐지 행(폐지·타법폐지·일괄폐지). 「폐지제정」은 구법 폐지와 동시에 같은 이름으로 새로 제정한 것이라 여기 들지 않는다 */
export function isRepealRow(v: HistoricalVersion): boolean {
  return /폐지$/.test(v.rrCls)
}

/**
 * 기준일의 상태. 계보에는 폐지 행 자체가 들어 있다(소방법 LID 001630: 마지막 행 2004.5.30. 타법폐지) — 그 행을 "시행 중 버전"으로
 * 집으면 폐지된 법령을 현행이라 답한다. 기준일 이하 최신 행이 폐지 행이면 version 없이 repeal 만 준다.
 */
export function lawStateAt(versions: HistoricalVersion[], ymd: string): { version?: HistoricalVersion, repeal?: HistoricalVersion } {
  const row = versions.find(v => v.efYd && v.efYd <= ymd)
  return row && isRepealRow(row) ? { repeal: row } : { version: row }
}

/** 기준일(YYYYMMDD)에 시행 중이던 버전 — versions 는 시행일 내림차순. 이미 폐지됐으면 undefined */
export function versionInForce(versions: HistoricalVersion[], ymd: string): HistoricalVersion | undefined {
  return lawStateAt(versions, ymd).version
}

/**
 * 법령명이 바뀐 지점 (시행일 오름차순). 이름이 하나뿐이면 길이 1.
 * 공백·가운뎃점만 다른 표기(「설치·유지」·「설치ㆍ유지」·「설치유지」)는 같은 이름으로 본다 — 같은 시행일의 여러 공포본이
 * 표기만 달리 오면서 A→B→A 로 번갈아 찍혔다(소방시설법 시행령 2012.2.5.).
 */
export function nameTimeline(versions: HistoricalVersion[]): Array<{ name: string, from: string }> {
  const asc = versions.filter(v => v.efYd && v.lawNm).sort((a, b) => a.efYd.localeCompare(b.efYd))
  // 같은 이름 묶음은 처음 시행일에 두고, 표기는 가장 나중 것(띄어쓰기가 정리된 표기)을 보인다
  const byKey = new Map<string, { name: string, from: string }>()
  for (const v of asc) {
    const key = nameKey(v.lawNm)
    const hit = byKey.get(key)
    if (hit) hit.name = v.lawNm
    else byKey.set(key, { name: v.lawNm, from: v.efYd })
  }
  return [...byKey.values()]
}

/** 공백·가운뎃점만 다른 법령명인가 */
export function sameLawName(a: string, b: string): boolean {
  return nameKey(a) === nameKey(b)
}

/**
 * (fromYmd, toYmd] 구간의 전부개정 — 조문 번호 체계가 바뀌어 같은 조번호가 다른 조문일 수 있다.
 * 제정 행은 그보다 앞에 다른 MST 행(동명 구법, withPriorSameNameLaw)이 있을 때만 재제정으로 넣는다 — 분리시행된 제정
 * 공포본의 뒤 시행분(개인정보 보호법 MST 111327: 2011.9.30.·2012.3.30.)은 같은 법령의 단계 시행일 뿐이다(검증 실측).
 */
export function wholeRevisionsBetween(versions: HistoricalVersion[], fromYmd: string, toYmd: string): HistoricalVersion[] {
  const reEnacted = (v: HistoricalVersion) => v.rrCls === "제정" && versions.some(o => o.mst !== v.mst && o.efYd < v.efYd)
  return versions.filter(v => (/전부개정|폐지제정/.test(v.rrCls) || reEnacted(v)) && v.efYd > fromYmd && v.efYd <= toYmd)
}

/** wholeRevisionsBetween 행을 부르는 말 — 제정 행은 폐지 후 재제정이다 */
export function wholeRevisionLabel(v: HistoricalVersion): string {
  return v.rrCls === "제정" ? "폐지 후 재제정" : "전부개정"
}
