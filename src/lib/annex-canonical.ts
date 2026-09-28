/**
 * 별표 정본 링크 해석 (#77)
 *
 * 법제처 licbyl 검색 인덱스(lawSearch target=licbyl)의 별표 파일링크는 별표 파일
 * 재업로드를 늦게 반영해 구본(결함본)을 가리킬 수 있다. 실증: 「각급 법원의 설치와
 * 관할구역에 관한 법률」 별표3 — licbyl 링크는 2026-03-17 개정(인천고등법원 신설
 * 재편)에서 서울고법 블록의 인천 삭제만 반영되고 인천고법 블록 추가가 누락된
 * 결함 파일을 가리켰고, 현행 본문(lawService target=law)의 별표단위 링크가 정본.
 * 개정으로 신설된 별표(별표11 해사국제상사법원)는 licbyl 목록에 아예 없었다.
 *
 * 따라서 법령(law) 타입 별표 추출 시 현행 본문의 별표단위 링크를 우선 사용하고,
 * 조회 실패 시 licbyl 링크로 폴백한다.
 */

import type { LawApiClient } from "./api-client.js"
import { lawCache } from "./cache.js"

export interface LawAnnexUnit {
  /** 별표번호(4) + 가지번호(2) — licbyl 별표번호와 같은 6자리 코드 */
  code6: string
  /** 별표구분: "별표" | "서식" 등 */
  kind: string
  title: string
  hwpLink?: string
  pdfLink?: string
}

/** 링크 필드가 배열(이미지 다페이지 등)로 올 수 있어 첫 값만 취한다 */
const firstLink = (v: unknown): string | undefined => {
  const raw = Array.isArray(v) ? v[0] : v
  const s = raw == null ? "" : String(raw).trim()
  return s ? s : undefined
}

/** lawService(target=law) JSON 응답에서 별표단위 목록 추출 (순수 함수) */
export function parseLawAnnexUnits(jsonText: string): LawAnnexUnit[] {
  let json: unknown
  try {
    json = JSON.parse(jsonText)
  } catch {
    return []
  }
  const raw = (json as Record<string, any>)?.법령?.별표?.별표단위
  const units = raw == null ? [] : Array.isArray(raw) ? raw : [raw]
  return units
    .map((u: Record<string, unknown>): LawAnnexUnit => ({
      code6:
        String(u.별표번호 ?? "").trim().padStart(4, "0") +
        String(u.별표가지번호 ?? "0").trim().padStart(2, "0"),
      kind: String(u.별표구분 ?? ""),
      title: String(u.별표제목 ?? ""),
      hwpLink: firstLink(u.별표서식파일링크),
      pdfLink: firstLink(u.별표서식PDF파일링크),
    }))
    .filter((u) => (u.hwpLink || u.pdfLink) && u.code6 !== "000000")
}

/**
 * 별표단위 후보 선택.
 * code6(licbyl 매칭 항목의 별표번호)이 있으면 그것으로, 없으면 selector 후보 집합으로
 * 매칭한다. 같은 번호에 별표/서식이 공존하면 kind(licbyl 별표종류) → knd 의도 →
 * 별표 우선 순으로 고른다.
 */
export function pickAnnexUnit(
  units: LawAnnexUnit[],
  opts: { code6?: string; kind?: string; selectorCandidates?: Set<string>; knd?: string }
): LawAnnexUnit | undefined {
  const code6 = (opts.code6 || "").trim()
  const candidates = code6
    ? units.filter((u) => u.code6 === code6)
    : opts.selectorCandidates
      ? units.filter((u) => opts.selectorCandidates!.has(u.code6))
      : []

  if (candidates.length === 0) return undefined
  if (candidates.length === 1) return candidates[0]

  if (opts.kind) {
    const same = candidates.find((u) => u.kind === opts.kind)
    if (same) return same
  }
  const wantForm = opts.knd === "2" || opts.knd === "4"
  return (
    candidates.find((u) => (wantForm ? /서식/.test(u.kind) : /별표/.test(u.kind))) ||
    candidates[0]
  )
}

/**
 * 목록 표시용 병합: licbyl 목록에 없는 별표단위(개정 신설 별표 등)를 골라 반환.
 * code6+구분이 모두 일치하는 항목은 이미 목록에 있는 것으로 본다.
 */
export function findMissingUnits(
  list: ReadonlyArray<{ 별표번호?: string; 별표종류?: string }>,
  units: LawAnnexUnit[]
): LawAnnexUnit[] {
  const known = new Set(
    list.map((a) => `${String(a.별표번호 || "").trim()}|${String(a.별표종류 || "").trim()}`)
  )
  return units.filter((u) => !known.has(`${u.code6}|${u.kind}`))
}

/**
 * 별표단위 목록 캐시 — 별표 목록 하나 보려고 법령 전문 JSON(도로교통법 시행규칙 3.7 MB)을 호출마다 받았다
 * (2026-09-28 성능 감사: 같은 법령 두 번째 호출도 5회·4.1 MB). 별표 블록만 따로 주는 API 는 없다(JO 지정 응답엔 별표가 없다).
 * 키의 MST·시행일은 버전을 못박는다. 다만 법제처가 같은 버전의 별표 파일을 재업로드해 링크를 고치는 일이 있어(#77) 6시간만 둔다.
 */
const ANNEX_UNITS_TTL_MS = 6 * 60 * 60 * 1000

/** 법령 본문에서 별표단위 목록 조회. efYd 를 주면 그 시행 슬라이스(eflaw)의 별표 — 분리시행이면 같은 MST 라도 별표가 다르다 */
export async function fetchLawAnnexUnits(
  apiClient: LawApiClient,
  mst: string,
  apiKey?: string,
  efYd?: string,
): Promise<LawAnnexUnit[]> {
  const cacheKey = `annexunits:${mst}:${efYd || "law"}`
  const cached = lawCache.get<LawAnnexUnit[]>(cacheKey)
  if (cached) return cached
  const text = await apiClient.fetchApi({
    endpoint: "lawService.do",
    target: efYd ? "eflaw" : "law",
    type: "JSON",
    extraParams: efYd ? { MST: mst, efYd } : { MST: mst },
    apiKey,
  })
  const units = parseLawAnnexUnits(text)
  if (units.length > 0) lawCache.set(cacheKey, units, ANNEX_UNITS_TTL_MS)
  return units
}
