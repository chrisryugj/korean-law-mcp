/**
 * 별표/서식 목록 수집 — 응답 봉투 파싱 + 페이지 수집.
 *
 * 업스트림(lawSearch.do + licbyl/ordinbyl/admbyl)은 display 를 100 초과로 올려도
 * numOfRows 를 100 으로 잘라 준다 (2026-08-17 실측: display=300 → returned 100).
 * 전 건을 보려면 page 를 넘겨 이어 받는 수밖에 없다.
 */

import type { LawApiClient } from "../lib/api-client.js"
import type { AnnexItem } from "./annex-select.js"

/** 업스트림이 한 페이지에 주는 최대 건수 (display 를 올려도 이 값에서 잘린다) */
export const ANNEX_PAGE_SIZE = 100

/**
 * 페이지 상한. 요청 단위 업스트림 예산은 기본 48회(MCP_MAX_UPSTREAM_REQUESTS)이고
 * get_annexes 는 목록 사다리(최대 4단계)·현행 본문 병합·별표 파일 다운로드까지 함께 쓴다.
 * 5페이지면 목록에 최대 5회를 써 500건을 담고도 예산의 약 1/10에 머문다.
 * 실측 최대 사례가 도로교통법 시행규칙 264건(3페이지)이라 실질 여유도 충분하다.
 */
export const MAX_ANNEX_PAGES = 5

export interface AnnexEnvelope {
  list: AnnexItem[]
  /** licbyl(법령) / ordinbyl(자치법규) / admrulbyl(행정규칙) 중 어느 봉투였는지 */
  type: string
  /** 업스트림이 밝힌 전체 건수 (없으면 0) */
  totalCnt: number
}

/**
 * 수집이 전 건에 못 미친 이유. 배너가 실제로 일어난 일을 말하게 하려면 필요하다 —
 * 사유를 모르면 "500건까지만 수집했습니다"를 100건에서도 출력해 틀린 원인을 알리고
 * "500건까지는 봤다"는 잘못된 안심을 준다(N3).
 */
export type AnnexTruncationReason =
  /** 페이지 상한(MAX_ANNEX_PAGES)까지 받고도 남았다 */
  | "page-cap"
  /** 새 항목이 안 들어와 중단 — 업스트림이 page를 무시하거나 동명 항목이 겹쳤다 */
  | "no-progress"
  /** 총계를 모르는 채 정확히 한 페이지만 왔다 — 창 경계에 걸렸을 가능성 */
  | "unknown-total"

export interface CollectedAnnexes extends AnnexEnvelope {
  /** 상한에 걸려 전 건을 담지 못했는지 — 침묵하면 부분 목록이 전체로 읽힌다 */
  truncated: boolean
  /** truncated 일 때만 채워진다 */
  reason?: AnnexTruncationReason
}

// 법제처 API는 결과 1건일 때 배열 대신 단일 객체를 반환하므로 정규화
const toArray = (v: unknown): AnnexItem[] =>
  v == null ? [] : Array.isArray(v) ? v : [v]

const count = (v: unknown): number => {
  const n = Number.parseInt(String(v ?? ""), 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function parseAnnexEnvelope(jsonText: string): AnnexEnvelope {
  try {
    const json = JSON.parse(jsonText)
    const adminResult = json?.admRulBylSearch
    const licResult = json?.licBylSearch
    // 법제처 행정규칙 별표 응답의 배열 키는 admrulbyl (admbyl 아님). 구버전 호환 위해 admbyl도 폴백.
    if (adminResult?.admrulbyl ?? adminResult?.admbyl) {
      return {
        list: toArray(adminResult.admrulbyl ?? adminResult.admbyl),
        type: "admin",
        totalCnt: count(adminResult.totalCnt),
      }
    }
    if (licResult?.ordinbyl) {
      return { list: toArray(licResult.ordinbyl), type: "ordinance", totalCnt: count(licResult.totalCnt) }
    }
    if (licResult?.licbyl) {
      return { list: toArray(licResult.licbyl), type: "law", totalCnt: count(licResult.totalCnt) }
    }
    return { list: [], type: "law", totalCnt: 0 }
  } catch {
    // JSON 파싱 실패 (HTML 에러 페이지 등) → 빈 배열 반환하여 fallback 진행
    return { list: [], type: "law", totalCnt: 0 }
  }
}

/**
 * 같은 번호를 별표와 서식이 나눠 쓰므로 번호만으로는 같은 항목인지 알 수 없고,
 * **발행 주체까지 봐야 한다.** 이 목록은 여러 법령·자치법규가 섞인 상태로 온다
 * (그래서 수집 뒤에 `filterByRelatedLawName`이 따로 돈다). 자치법규의
 * `[별표1] 과태료 부과기준`은 지자체마다 있는 흔한 이름이라, 주체를 빼면 서로 다른
 * 지자체의 별표가 서로를 중복으로 지우고 "새 항목 0건" 방어가 정상 수집을 끊는다(N2).
 */
const identity = (a: AnnexItem): string => {
  const issuer = String(
    a.관련법령일련번호 ?? a.관련자치법규명 ?? a.관련법령명 ?? a.관련행정규칙명 ?? ""
  ).replace(/<[^>]+>/g, "")
  return `${a.별표번호 ?? ""}|${a.별표종류 ?? ""}|${a.별표명 ?? ""}|${issuer}`
}

/**
 * 목록을 전 건 수집한다. totalCnt 가 첫 페이지를 넘으면 상한까지 page 를 이어 받는다.
 *
 * 루프는 세 겹으로 막혀 있다 — for 의 페이지 상한, 목표 건수 도달, 그리고
 * "새로 담긴 항목이 0건이면 중단". 마지막 것이 업스트림이 page 를 무시하고
 * 같은 페이지를 계속 돌려주는 경우의 방어선이다.
 */
export async function collectAnnexList(
  apiClient: LawApiClient,
  params: { lawName: string, knd?: "1" | "2" | "3" | "4" | "5", apiKey?: string }
): Promise<CollectedAnnexes> {
  return collectPages(page => apiClient.getAnnexes(page ? { ...params, page } : params))
}

/**
 * 행정규칙 별표(admbyl) 폴백도 같은 수집 정책을 쓴다.
 *
 * 이 경로는 `detectLawType`이 'law'로 분류하는 행정규칙(제목에 고시·훈령 낱말이 없는 것)을
 * 위해 target 을 강제하므로 `getAnnexes`를 탈 수 없다. 그렇다고 페이지 수집을 빼면
 * 사다리의 마지막 칸만 100건 창에 갇힌다 — 상한·중복 방어·사유 표기가 전부 같아야 한다(#149).
 */
export async function collectAdminAnnexList(
  apiClient: LawApiClient,
  params: { lawName: string, apiKey?: string }
): Promise<CollectedAnnexes> {
  return collectPages(page => apiClient.fetchApi({
    endpoint: "lawSearch.do",
    target: "admbyl",
    type: "JSON",
    extraParams: {
      query: params.lawName,
      search: "2",
      display: String(ANNEX_PAGE_SIZE),
      ...(page ? { page: String(page) } : {}),
    },
    apiKey: params.apiKey,
  }))
}

/** 페이지 수집 정책 단일 원본 — 어느 target 이든 상한·중복 방어·사유가 같아야 한다 */
async function collectPages(
  fetchPage: (page?: number) => Promise<string>
): Promise<CollectedAnnexes> {
  const first = parseAnnexEnvelope(await fetchPage())
  const list = [...first.list]
  const wanted = Math.min(first.totalCnt, MAX_ANNEX_PAGES * ANNEX_PAGE_SIZE)
  if (list.length === 0 || list.length >= wanted) {
    // 총계를 모르는데 정확히 창 크기만큼 왔다면 경계에 걸렸다고 봐야 한다. 이 경우에만
    // 침묵하면 커밋이 내건 원칙("부분 목록이 전체로 읽히면 '그 별표는 없다'는 오답")이
    // 여기서만 적용되지 않는다(N4).
    if (first.totalCnt === 0 && list.length === ANNEX_PAGE_SIZE) {
      return { ...first, list, truncated: true, reason: "unknown-total" }
    }
    return first.totalCnt > list.length
      ? { ...first, list, truncated: true, reason: "page-cap" }
      : { ...first, list, truncated: false }
  }

  const seen = new Set(list.map(identity))
  let stalled = false
  // 총계를 알았으니 남은 페이지를 한꺼번에 받는다 (종전 순차: 관세법 2~3쪽이 action_basis 에서 가장 느린 갈래, 2026-09-28 성능 감사).
  // 판정은 종전처럼 페이지 순서대로 한다 — 새 항목이 없는 페이지에서 멈추는 방어선은 그대로다.
  const lastPage = Math.min(MAX_ANNEX_PAGES, Math.ceil(wanted / ANNEX_PAGE_SIZE))
  const pages = await Promise.all(Array.from({ length: Math.max(0, lastPage - 1) }, (_, i) => fetchPage(i + 2)))
  for (const raw of pages) {
    if (list.length >= wanted) break
    const next = parseAnnexEnvelope(raw)
    const fresh = next.list.filter(a => !seen.has(identity(a)))
    if (fresh.length === 0) { stalled = true; break }
    fresh.forEach(a => seen.add(identity(a)))
    list.push(...fresh)
  }

  const truncated = first.totalCnt > list.length
  return {
    list,
    type: first.type,
    totalCnt: first.totalCnt,
    truncated,
    ...(truncated ? { reason: stalled ? "no-progress" as const : "page-cap" as const } : {}),
  }
}
