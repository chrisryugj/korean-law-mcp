/**
 * 체인의 기반 법령 탐색 (#105)
 *
 * 체인은 "기반 법령 → 조문 → 판례" 순으로 쌓아 올라가므로 첫 단계가 비면 전부 중단된다.
 * 그런데 법제처 법령검색은 **법령명 검색**이고 공백은 AND 라, 사용자 원문을 그대로 넣으면
 * "음주운전 과태료 기준 얼마" 같은 구어 질의는 0건이 된다 — 라우팅이 맞아도 실행에서 죽는다.
 *
 * 3단 시도: 추출한 법령명 → 원문(findLaws 자체 폴백 포함) → 의미검색이 지목한 법령명.
 * 의미검색(aiSearch)은 주제어를 조문으로 매핑하므로 "음주운전"에서 도로교통법을 얻는다.
 */
import { findLaws, type LawInfo } from "../lib/law-search.js"
import { lawNameFromQuery } from "../lib/query-extract.js"
import { rethrowIfFatal } from "../lib/fatal-errors.js"
import { searchAiLawStructured, type AiLawArticleSignal } from "./life-law.js"
import type { LawApiClient } from "../lib/api-client.js"

export interface ChainBaseLawResult {
  laws: LawInfo[]
  /** 실제로 결과를 낸 검색어 (없으면 undefined) */
  searchedWith?: string
  /** 시도한 검색어 전부 — 실패 안내에 그대로 싣는다 */
  attempts: string[]
}

export interface ChainBaseLawOptions {
  /**
   * 체인이 이미 띄운 같은 질의의 의미검색 결과 (2026-09-23 리뷰 B#10).
   * 넘기면 3단계에서 의미검색을 다시 치지 않는다: full_research·procedure_detail 이 같은 요청을
   * 한 번 더 보내던 것을 없앤다. 호출부가 거부되지 않는 promise 로 넘긴다(실패는 빈 배열).
   */
  aiSignals?: Promise<AiLawArticleSignal[]>
}

/** 의미검색이 지목한 법령명 (등장 순, 중복 제거) */
async function aiLawNames(
  apiClient: LawApiClient,
  query: string,
  apiKey?: string,
  aiSignals?: Promise<AiLawArticleSignal[]>
): Promise<string[]> {
  try {
    const articleSignals = aiSignals
      ? await aiSignals
      : (await searchAiLawStructured(apiClient, { query, search: "0", display: 5, page: 1, apiKey })).articleSignals
    const names: string[] = []
    for (const s of articleSignals) {
      const n = s.lawName?.trim()
      if (n && !names.includes(n)) names.push(n)
    }
    // 하위법령보다 모법을 앞세운다 — 체인은 3단비교·처분근거를 법률 기준으로 쌓는다.
    // 의미검색은 조문 적합도 순이라 "도로교통법 시행규칙"이 "도로교통법"보다 먼저 오기 쉽다
    const isSubordinate = (n: string) => /시행령|시행규칙|규정|규칙$/.test(n)
    return [...names.filter(n => !isSubordinate(n)), ...names.filter(isSubordinate)]
  } catch (error) {
    // 예산 소진·요청 취소를 여기서 삼키면 체인이 "관련 법령 없음(NOT_FOUND)"으로 끝난다 (B#11)
    rethrowIfFatal(error)
    // 의미검색은 보조 경로다 — 실패해도 체인의 실패 사유를 덮어쓰지 않는다
    return []
  }
}

export async function resolveChainBaseLaw(
  apiClient: LawApiClient,
  query: string,
  apiKey?: string,
  max = 3,
  options: ChainBaseLawOptions = {}
): Promise<ChainBaseLawResult> {
  const attempts: string[] = []
  const tried = new Set<string>()

  const attempt = async (q: string): Promise<LawInfo[]> => {
    const key = q.trim()
    if (!key || tried.has(key)) return []
    tried.add(key)
    attempts.push(key)
    return findLaws(apiClient, key, apiKey, max)
  }

  // 1) 질의에 법령명이 들어 있으면 그것으로. 의문·구어 수식을 걷어낸 형태다
  const lawName = lawNameFromQuery(query)
  if (lawName && lawName !== query.trim()) {
    const byName = await attempt(lawName)
    if (byName.length) return { laws: byName, searchedWith: lawName, attempts }
  }

  // 2) 원문 — findLaws 안에 부가키워드 제거·법령명 패턴 폴백이 이미 있다
  const byQuery = await attempt(query)
  if (byQuery.length) return { laws: byQuery, searchedWith: query.trim(), attempts }

  // 3) 주제어 → 법령: 의미검색이 지목한 법령명으로 재검색
  for (const name of await aiLawNames(apiClient, query, apiKey, options.aiSignals)) {
    const byAi = await attempt(name)
    if (byAi.length) return { laws: byAi, searchedWith: name, attempts }
  }

  return { laws: [], attempts }
}
