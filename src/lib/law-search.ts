/**
 * 공용 법령 검색 유틸 — chains / verify_citations 등에서 공유.
 *
 * 핵심: 법제처 lawSearch API는 부분 문자열 매칭 특성이 있어 "민법" → "난민법"
 * 같은 엉뚱한 매칭이 발생한다. scoreLawRelevance로 정확 매칭 우선 정렬하여
 * 첫 결과 신뢰 가능하게 만든다.
 */

import type { LawApiClient } from "./api-client.js"
import { lawCache } from "./cache.js"
import { extractTag } from "./xml-parser.js"
import { normalizeLawSearchText, resolveLawAlias } from "./search-normalizer.js"
import { requestContext } from "./session-state.js"
import { rethrowIfFatal } from "./fatal-errors.js"

export interface LawInfo {
  lawName: string
  lawId: string
  mst: string
  lawType: string
  status?: string        // 현행연혁코드: "현행" | "연혁"(폐지·과거본). eflaw 검색 시에만 채워짐
  effectiveDate?: string // 시행일자 (YYYYMMDD)
}

// 법령명 구분점(가운뎃점) 표기 흔들림. 법제처 공식 법령명은 **한글 가운뎃점 'ㆍ'(U+318D)**
// 를 쓰지만("식품 등의 표시ㆍ광고에 관한 법률"), 실무 문서·판결문·LLM 출력은 라틴 중점
// '·'(U+00B7)를 쓰는 것이 보통이고 '‧'(U+2027)·'•'(U+2022)·'・'(U+30FB)도 섞인다.
// 표기만 다른 같은 법을 불일치로 판정하면 verify_citations는 조문 검증에 진입조차 못 하고
// (⚠ 부분매칭), applicable_law·impact_map은 resolvedLawMatches 가드에서 NOT_FOUND가 된다.
/** 법령명에 쓰이는 가운뎃점 변형 전체. 법령명 추출 정규식(verify-citations)과
 *  정규화(아래 INTERPUNCT_RE)가 같은 집합을 봐야 한다 — 어긋나면 추출 단계에서
 *  법령명이 절단돼 정규화가 손쓸 기회조차 없어진다. */
export const INTERPUNCT_CHARS = "·ㆍ‧•・"
const INTERPUNCT_RE = new RegExp(`[${INTERPUNCT_CHARS}]`, "g")

// 후보 법령명과 법제처 공식 법령명의 느슨한 일치 — 공백·가운뎃점 무시 + 접두/약칭 허용.
// findLaws가 관련도 정렬은 해도 매칭이 전혀 다른 법령일 수 있어 최종 방어선으로 사용.
// (verify-citations에서 쓰던 것을 lib로 승격 — applicable_law/impact_map 가드 공용)
export function looseMatchLawName(target: string, official: string): boolean {
  const normalize = (s: string) => s.replace(/\s+/g, "").replace(INTERPUNCT_RE, "")
  const targetNorm = normalize(target)
  const officialNorm = normalize(official)
  return officialNorm === targetNorm
    || officialNorm.startsWith(targetNorm)
    || targetNorm.startsWith(officialNorm.replace(/(법률|법)$/, "법"))
}

/**
 * findLaws 결과 1위가 요청한 법령명과 실제로 관련 있는지 최종 확인.
 * 법제처 LIKE 검색은 관련 법령이 하나도 없어도 부분매칭 목록을 돌려주므로,
 * laws[0]을 맹신하면 「상법」 요청에 무관한 법의 분석을 확신형으로 내보내게 된다.
 * 별칭 입력("화관법"→화학물질관리법)은 canonical 해소 후에도 대조한다.
 */
export function resolvedLawMatches(requested: string, officialName: string): boolean {
  if (looseMatchLawName(requested, officialName)) return true
  const canonical = resolveLawAlias(normalizeLawSearchText(requested)).canonical
  return canonical !== requested && looseMatchLawName(canonical, officialName)
}

/** 법령명이 아닌 부가 키워드 제거 (법제처 lawSearch API는 법령명 검색이므로) */
export const NON_LAW_NAME_RE = /\s*(과태료|절차|비용|처벌|기준|허가|신청|부과|근거|위반|방법|요건|조건|처분|수수료|신고|등록|면허|인가|승인|취소|정지|벌칙|벌금|과징금|이행강제금|시정명령|체계|구조|3단|판례|해석|개정|별표|시행령|시행규칙|서식|수입|수출|통관|반환|납부|감면|면제|제한|금지|의무|권리|자격|종류|기간|대상|범위|적용|감경|영향도|영향|분석|위임입법|위임|현황|미이행|미제정|시계열|타임라인|변화|처리|민원|매뉴얼|업무|담당|적합성|상위법|저촉|검증|파급|연쇄|불복|소송|쟁송|FTA|원산지|HS코드|품목분류|관세사)\s*/g

export function stripNonLawKeywords(query: string): string {
  // 공백 연속을 먼저 하나로 뭉친다. NON_LAW_NAME_RE 양끝의 \s* 가 공백 연속에서 O(k²) 로
  // 백트래킹해 2만 자 공백이면 impact_map·applicable_law 가 1.9초 멈췄다(2026-09-23 리뷰 C).
  // 결과는 검색어로 쓰이고 공백 단위로 쪼개지므로 공백 개수 차이는 의미가 없다.
  return query.replace(/\s+/g, " ").replace(NON_LAW_NAME_RE, " ").trim()
}

/** XML에서 법령 정보 파싱 */
export function parseLawXml(xmlText: string, max: number): LawInfo[] {
  const lawRegex = /<law[^>]*>([\s\S]*?)<\/law>/g
  const results: LawInfo[] = []
  let match
  while ((match = lawRegex.exec(xmlText)) !== null && results.length < max) {
    const content = match[1]
    const lawName = extractTag(content, "법령명한글")
    if (!lawName) continue
    results.push({
      lawName,
      lawId: extractTag(content, "법령ID"),
      mst: extractTag(content, "법령일련번호"),
      lawType: extractTag(content, "법령구분명"),
      status: extractTag(content, "현행연혁코드") || undefined,
      effectiveDate: extractTag(content, "시행일자") || undefined,
    })
  }
  return results
}

/** 쿼리 대비 법령명 관련도 점수 (높을수록 관련) */
export function scoreLawRelevance(lawName: string, query: string, queryWords: string[]): number {
  let score = 0
  // 정확 매칭: 쿼리가 법령명을 포함
  if (query.includes(lawName)) score += 100
  // 법령명이 쿼리를 포함
  if (lawName.includes(query.replace(/\s+/g, ""))) score += 80
  // 단어 매칭
  for (const w of queryWords) {
    if (lawName.includes(w)) score += 10
  }
  // 법률 > 시행령 > 시행규칙 우선순위
  if (!/시행령|시행규칙/.test(lawName)) score += 5
  return score
}

/**
 * 요청 단위 진행 중 검색 공유 (2026-09-23 리뷰 B#3·A10).
 *
 * lawCache 는 검색이 끝난 뒤에야 채워지고 0건은 담지 않는다. 그래서 한 요청 안에서 동시에 도는
 * 같은 검색(verify_citations 의 "민법 제750조, 민법 제751조 …")이 전부 캐시를 놓쳐 각자
 * 업스트림을 쳤다: 같은 법령 인용 15건이면 동일 검색 15회로 요청 예산(48회)을 먼저 태웠다.
 * 전역 in-flight 맵이 아니라 요청 컨텍스트(ALS 저장소)에 묶는다. 한 요청의 취소·예산 소진이
 * 다른 요청(배치의 형제 항목 포함)의 대기를 깨뜨리면 안 되기 때문이다. 컨텍스트 밖(단독 호출)은 공유하지 않는다.
 */
const inflightByRequest = new WeakMap<object, Map<string, Promise<LawInfo[]>>>()

function requestSearchMemo(): Map<string, Promise<LawInfo[]>> | undefined {
  const store = requestContext.getStore()
  if (!store) return undefined
  let memo = inflightByRequest.get(store)
  if (!memo) {
    memo = new Map()
    inflightByRequest.set(store, memo)
  }
  return memo
}

/**
 * 법령 검색 + 관련도 정렬 + 캐싱.
 * 1차: 원본 쿼리 → 2차: 부가키워드 제거 → 3차: 법령명 패턴 직접 추출
 * 이후 scoreLawRelevance로 정렬.
 *
 * @param searchDisplay 법제처 API display 파라미터. 기본 100(API 상한) —
 *                      법제처는 LIKE 부분검색+가나다순이라 짧은 법령명("상법"은 100개 중 34번째)은
 *                      조회량이 작으면 아예 도착하지 못해 관련도 정렬이 입력 자체를 받지 못한다.
 *                      (종전 기본 20은 applicable_law가 「상법」 대신 무관한 법을 잡는 원인이었음.
 *                      요청 비용은 20이든 100이든 동일 1회.)
 */
export async function findLaws(
  apiClient: LawApiClient,
  query: string,
  apiKey?: string,
  max = 3,
  searchDisplay = 100
): Promise<LawInfo[]> {
  const cacheKey = `law-search:${query}:${max}:${searchDisplay}`
  const cached = lawCache.get<LawInfo[]>(cacheKey)
  if (cached) return cached.slice(0, max)

  // 업스트림 요청은 (query, display) 로 정해지고 max 는 정렬 뒤 자르기일 뿐이다. 그래서 공유 키에서
  // max 를 뺀다: 같은 검색을 max 만 달리 부르는 호출(체인 기반 탐색 3 · 인용 검증 5)도 한 번으로 묶인다.
  const memo = requestSearchMemo()
  const memoKey = `${query}\u0000${searchDisplay}`
  let pending = memo?.get(memoKey)
  if (!pending) {
    pending = searchAndRankLaws(apiClient, query, apiKey, searchDisplay)
    memo?.set(memoKey, pending)
  }
  const final = (await pending).slice(0, max)
  if (final.length > 0) {
    lawCache.set(cacheKey, final, 60 * 60 * 1000)
  }
  return final
}

/** findLaws 의 업스트림 단계: 3단 검색 + 관련도 정렬. 자르기(max)와 캐시 쓰기는 호출부 몫이다. */
async function searchAndRankLaws(
  apiClient: LawApiClient,
  query: string,
  apiKey: string | undefined,
  searchDisplay: number
): Promise<LawInfo[]> {
  // 정렬 대상 전체 수집. 업스트림은 display 행까지만 주므로 이 상한은 사실상 "응답 전부"다
  // (종전 Math.max(max, searchDisplay) 와 같은 결과를 max 없이 낸다).
  const effectiveMax = Math.max(searchDisplay, 100)

  // 인프라 에러(타임아웃·5xx·파싱 실패)는 "법령 없음"과 구분해야 한다.
  // 삼키면 법제처 장애 중 verify_citations가 실존 조문을 NOT_FOUND로 오판한다.
  let lastInfraError: unknown
  const trySearch = async (q: string): Promise<LawInfo[]> => {
    try {
      const xmlText = await apiClient.searchLaw(q, apiKey, searchDisplay)
      return parseLawXml(xmlText, effectiveMax)
    } catch (e) {
      // 예산 소진·요청 취소는 다음 검색어 변형으로 넘어가 봐야 같은 결과다. 곧바로 올린다 (B#11)
      rethrowIfFatal(e)
      if (e instanceof Error && /429|401|403|API 키/.test(e.message)) throw e
      lastInfraError = e
      return []
    }
  }

  // 1차: 원본 쿼리
  let results: LawInfo[] = await trySearch(query)

  // 2차: 부가 키워드 제거
  if (results.length === 0) {
    const stripped = stripNonLawKeywords(query)
    // stripNonLawKeywords 가 공백을 뭉치므로 원문 그대로와 비교하면 공백만 다른 같은 검색을 한 번 더 친다
    if (stripped && stripped !== query.replace(/\s+/g, " ").trim()) {
      results = await trySearch(stripped)
    }
  }

  // 3차: 법령명 패턴 직접 추출
  if (results.length === 0) {
    const lawNameMatch = query.match(/[가-힣]+(법|시행령|시행규칙|규칙|규정|령)(?:\s|$)/)
    if (lawNameMatch) {
      results = await trySearch(lawNameMatch[0].trim())
    }
  }

  // 전 단계가 인프라 에러로만 끝났으면 "없음"이 아니라 "실패"로 전파
  if (results.length === 0 && lastInfraError !== undefined) {
    throw lastInfraError instanceof Error
      ? new Error(`법령 검색 실패 (법제처 API 오류 — 법령이 없다는 뜻이 아님): ${lastInfraError.message}`)
      : lastInfraError
  }

  // 관련도 정렬
  if (results.length > 1) {
    const queryWords = stripNonLawKeywords(query).split(/\s+/).filter(w => w.length > 0)
    results.sort((a, b) => {
      const scoreA = scoreLawRelevance(a.lawName, query, queryWords)
      const scoreB = scoreLawRelevance(b.lawName, query, queryWords)
      return scoreB - scoreA
    })
  }

  return results
}

/**
 * eflaw 검색 결과(연혁 포함)에서 질의명과 일치하는 '폐지(연혁)' 법령의 최신본을 고른다.
 *
 * 순수 함수(테스트 용이) — findRepealedLaw가 네트워크 후 이 로직으로 판정.
 * 현행(target=law)에서 못 찾은 인용이 '지어낸 법령'인지 '폐지된 법령'인지 가른다.
 * 매칭은 공백무시 완전일치 또는 접두(약칭)만 허용해 엉뚱한 법령 흡수를 막는다.
 */
export function pickRepealed(rows: LawInfo[], query: string): LawInfo | undefined {
  const norm = (s: string) => s.replace(/\s+/g, "")
  const q = norm(query)
  return rows
    .filter((r) => r.status === "연혁"
      && (norm(r.lawName) === q || norm(r.lawName).startsWith(q)))
    .sort((a, b) => (b.effectiveDate || "").localeCompare(a.effectiveDate || ""))[0]
}

/**
 * 폐지(연혁) 법령 조회 — target=eflaw로 과거·폐지본을 검색해 최신 연혁본을 반환.
 * 현행 검색이 0건일 때만 보조로 호출(환각 vs 폐지 구분용). 실패 시 undefined.
 */
export async function findRepealedLaw(
  apiClient: LawApiClient,
  query: string,
  apiKey?: string
): Promise<LawInfo | undefined> {
  let xmlText: string
  try {
    xmlText = await apiClient.searchLaw(query, apiKey, 30, "eflaw")
  } catch {
    return undefined  // eflaw 조회 실패는 조용히 폴백(기존 NOT_FOUND 경로 유지)
  }
  return pickRepealed(parseLawXml(xmlText, 100), query)
}
