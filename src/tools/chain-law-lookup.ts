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
  /** 쟁점을 법률용어로 바꾼 말(호출 LLM 이 준다). 질문 원문의 의미검색보다 앞 순위로 센다 */
  terms?: string[]
}

/**
 * 의미검색에 넣을 질의: 구어 꼬리("얼마야"·"어떻게 되나요"·"있나요")와 낱말 뒤 목적격 조사를 뗀다.
 * 의미검색이 이것에 흔들려 엉뚱한 법령을 1위로 냈다(「임금명세서를 안 주면 과태료 얼마」 → 아동ㆍ청소년의 성보호에 관한 법률,
 * 떼면 근로기준법). 다 떼서 비면 원문을 쓴다
 */
export function aiSearchQuery(query: string): string {
  const q = query.replace(/\s+/g, " ").trim()
  const cut = q
    .replace(/\s*(얼마(인가요|예요|야|나)?|어떻게\s*(되나요|하나요|해야\s*하나요|돼)?|뭐야|무엇인가요|있나요|수\s*있나요|받을\s*수\s*있나요)\s*[?？]?$/u, "")
    .replace(/([가-힣]{2,})(을|를)(?= )/gu, "$1")
    .trim()
  return cut || q
}

/** 체인 기반 법령용 의미검색: 정리한 질의로 10건을 받아 법령별로 모은다(rankAiLawNames) */
export function baseLawAiSignals(apiClient: LawApiClient, query: string, apiKey?: string): Promise<AiLawArticleSignal[]> {
  return searchAiLawStructured(apiClient, { query: aiSearchQuery(query), search: "0", display: 10, page: 1, apiKey }).then(r => r.articleSignals)
}

const isSubordinateName = (n: string) => /시행령|시행규칙|규정|규칙$/.test(n)

/**
 * 의미검색 조문들을 법령별 점수로 모아 순서를 정한다. 시행령·시행규칙은 모법 이름으로 묶고, 순위 k 의 조문은 1/k 점이다.
 * 이름이 규정·규칙으로 끝나는 별도 하위법령은 반 점이다. 체인은 3단비교·처분근거를 법률 기준으로 쌓는다.
 * 1위 조문의 법령을 그대로 쓰면 단어만 겹친 조문 하나에 끌려갔다(「음식점 영업정지 근거」 → 건강기능식품에 관한 법률,
 * 10건 중 식품위생법 조문이 더 많고 1위도 식품위생법 시행령)
 */
export function rankAiLawNames(signals: AiLawArticleSignal[]): string[] {
  const score = new Map<string, number>()
  signals.forEach((s, i) => {
    const n = s.lawName?.trim().replace(/\s*(시행령|시행규칙)$/, "")
    if (!n) return
    score.set(n, (score.get(n) ?? 0) + (isSubordinateName(n) ? 0.5 : 1) / (i + 1))
  })
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n)
}

/**
 * 의미검색이 지목한 법령명 (법령별 점수 순, rankAiLawNames). terms 가 있으면 그 의미검색 조문을 질문 원문 조문보다 앞 순위에 둔다.
 * 「회사가 갑자기 그만두래요」는 원문 의미검색이 고용보험법을 냈고, 쟁점 「부당해고」로는 근로기준법이 나온다
 */
async function aiLawNames(
  apiClient: LawApiClient,
  query: string,
  apiKey?: string,
  aiSignals?: Promise<AiLawArticleSignal[]>,
  terms?: string[]
): Promise<string[]> {
  try {
    const t = (terms ?? []).map(x => x.trim()).filter(Boolean)
    const [byTerms, byQuery] = await Promise.all([
      t.length ? baseLawAiSignals(apiClient, t.join(" "), apiKey) : Promise.resolve([]),
      aiSignals ?? baseLawAiSignals(apiClient, query, apiKey),
    ])
    return rankAiLawNames([...byTerms, ...byQuery])
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
  for (const name of await aiLawNames(apiClient, query, apiKey, options.aiSignals, options.terms)) {
    const byAi = await attempt(name)
    if (byAi.length) return { laws: byAi, searchedWith: name, attempts }
  }

  return { laws: [], attempts }
}
