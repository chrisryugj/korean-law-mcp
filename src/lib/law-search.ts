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

export interface LawInfo {
  lawName: string
  lawId: string
  mst: string
  lawType: string
}

/** 법령명이 아닌 부가 키워드 제거 (법제처 lawSearch API는 법령명 검색이므로) */
export const NON_LAW_NAME_RE = /\s*(과태료|절차|비용|처벌|기준|허가|신청|부과|근거|위반|방법|요건|조건|처분|수수료|신고|등록|면허|인가|승인|취소|정지|벌칙|벌금|과징금|이행강제금|시정명령|체계|구조|3단|판례|해석|개정|별표|시행령|시행규칙|서식|수입|수출|통관|반환|납부|감면|면제|제한|금지|의무|권리|자격|종류|기간|대상|범위|적용|감경|영향도|영향|분석|위임입법|위임|현황|미이행|미제정|시계열|타임라인|변화|처리|민원|매뉴얼|업무|담당|적합성|상위법|저촉|검증|파급|연쇄|불복|소송|쟁송|FTA|원산지|HS코드|품목분류|관세사)\s*/g

export function stripNonLawKeywords(query: string): string {
  return query.replace(NON_LAW_NAME_RE, " ").trim()
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
 * 법령 검색 + 관련도 정렬 + 캐싱.
 * 1차: 원본 쿼리 → 2차: 부가키워드 제거 → 3차: 법령명 패턴 직접 추출
 * 이후 scoreLawRelevance로 정렬.
 *
 * @param searchDisplay 법제처 API display 파라미터 — 짧은 법령명("상법"은 100개 중 34번째)
 *                      정확 매칭 찾으려면 크게(100+). 기본 20은 체인 도구용.
 */
export async function findLaws(
  apiClient: LawApiClient,
  query: string,
  apiKey?: string,
  max = 3,
  searchDisplay = 20
): Promise<LawInfo[]> {
  const cacheKey = `law-search:${query}:${max}:${searchDisplay}`
  const cached = lawCache.get<LawInfo[]>(cacheKey)
  if (cached) return cached.slice(0, max)

  const effectiveMax = Math.max(max, searchDisplay)  // 정렬 대상 전체 수집

  // 1차: 원본 쿼리
  let results: LawInfo[] = []
  try {
    const xmlText = await apiClient.searchLaw(query, apiKey, searchDisplay)
    results = parseLawXml(xmlText, effectiveMax)
  } catch (e) {
    if (e instanceof Error && /429|401|403|API 키/.test(e.message)) throw e
  }

  // 2차: 부가 키워드 제거
  if (results.length === 0) {
    const stripped = stripNonLawKeywords(query)
    if (stripped && stripped !== query) {
      try {
        const xmlText = await apiClient.searchLaw(stripped, apiKey, searchDisplay)
        results = parseLawXml(xmlText, effectiveMax)
      } catch (e) {
        if (e instanceof Error && /429|401|403|API 키/.test(e.message)) throw e
      }
    }
  }

  // 3차: 법령명 패턴 직접 추출
  if (results.length === 0) {
    const lawNameMatch = query.match(/[가-힣]+(법|시행령|시행규칙|규칙|규정|령)(?:\s|$)/)
    if (lawNameMatch) {
      const extracted = lawNameMatch[0].trim()
      try {
        const xmlText = await apiClient.searchLaw(extracted, apiKey, searchDisplay)
        results = parseLawXml(xmlText, effectiveMax)
      } catch (e) {
        if (e instanceof Error && /429|401|403|API 키/.test(e.message)) throw e
      }
    }
  }

  // 관련도 정렬
  if (results.length > 1) {
    const queryWords = query.replace(NON_LAW_NAME_RE, " ")
      .trim().split(/\s+/).filter(w => w.length > 0)
    results.sort((a, b) => {
      const scoreA = scoreLawRelevance(a.lawName, query, queryWords)
      const scoreB = scoreLawRelevance(b.lawName, query, queryWords)
      return scoreB - scoreA
    })
  }

  // max만큼만 반환
  const final = results.slice(0, max)
  if (final.length > 0) {
    lawCache.set(cacheKey, final, 60 * 60 * 1000)
  }

  return final
}
