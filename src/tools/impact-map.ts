/**
 * impact_map — 조문 한 줄의 파급효과 그래프 (v4.0 killer feature)
 *
 * 입력: lawName + jo (조문번호)
 * 처리:
 *   1. 해당 조문 본문 조회 (참조 추출용)
 *   2. 병렬 역방향 탐색:
 *      - 그 조문을 인용한 판례 (대법원)
 *      - 그 조문을 인용한 해석례 (법령해석)
 *      - 그 조문을 인용한 행정심판례
 *      - 그 법령을 인용한 자치법규 (조례·규칙)
 *      - 그 조문이 인용한 다른 법령 (정방향)
 *   3. 텍스트 트리 + mermaid 그래프 출력
 *
 * 차별점: 다른 모든 chain은 query 기반 단방향. 이 도구는 "특정 조문 → 영향받는 모든 곳" 역방향 그래프.
 */
import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { findLaws, resolvedLawMatches } from "../lib/law-search.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"
import { renderPrecedentSearchResult } from "./precedents.js"
import { searchPrecedentsStructured } from "./precedent-search-core.js"
import { searchInterpretations } from "./interpretations.js"
import { searchAdminAppeals } from "./admin-appeals.js"
import { searchOrdinance } from "./ordinance-search.js"
import { searchConstitutionalDecisions } from "./constitutional-decisions.js"
import { getArticleDetail } from "./article-detail.js"

export const ImpactMapSchema = z.object({
  lawName: z.string().describe("법령명 (예: '민법', '근로기준법')"),
  jo: z.string().describe("조문 번호 (예: '제103조', '제750조', '제10조의2')"),
  includeOrdinances: z.boolean().optional().default(true).describe("자치법규 인용 검색 포함 (기본 true)"),
  includeMermaid: z.boolean().optional().default(true).describe("mermaid 그래프 코드 출력 (기본 true)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
})

export type ImpactMapInput = z.infer<typeof ImpactMapSchema>

interface CallResult {
  text: string
  isError: boolean
}

async function safeCall(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (apiClient: LawApiClient, input: any) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>,
  apiClient: LawApiClient,
  input: Record<string, unknown>
): Promise<CallResult> {
  try {
    const r = await handler(apiClient, input)
    return { text: r.content?.[0]?.text || "", isError: !!r.isError }
  } catch (e) {
    return { text: e instanceof Error ? e.message : String(e), isError: true }
  }
}

async function searchPrecedentsWithoutFallback(
  apiClient: LawApiClient,
  input: { query: string; display?: number; page?: number; apiKey?: string }
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const result = await searchPrecedentsStructured(apiClient, {
    ...input,
    display: input.display ?? 10,
    page: input.page ?? 1,
  }, {
    fallbackPolicy: "none",
  })
  return {
    content: [{ type: "text", text: renderPrecedentSearchResult(result) }],
    isError: result.hits.length === 0 || undefined,
  }
}

interface BucketStat {
  count: number      // "총 N건" 추출
  topItems: string[] // 첫 N개 사건명/제목
}

/** 도구 결과에서 카운트 + 상위 항목 추출. NOT_FOUND나 isError면 0/빈배열 */
function parseBucket(result: CallResult, n: number): BucketStat {
  if (result.isError || !result.text || !result.text.trim()) return { count: 0, topItems: [] }
  if (/\[NOT_FOUND\]/.test(result.text)) return { count: 0, topItems: [] }

  // 카운트: "총 N건" / "(총 N건," / "검색 결과 (총 N건"
  let count = 0
  const cm = result.text.match(/총\s*(\d+)\s*건/)
  if (cm) count = parseInt(cm[1], 10)

  // 상위 항목: "사건번호: ..." / "1. ..." / "- ..." / "[NNNN] ..."
  const lines = result.text.split("\n").map(s => s.trim()).filter(Boolean)
  const items: string[] = []
  for (const line of lines) {
    if (line.length < 5) continue
    if (/^(총|결과|검색|⚠️|💡|━|═|힌트:|재시도|링크:|http|\/DRF)/.test(line)) continue
    if (/^(?:\d+\.\s|-\s|\[\d+\]\s|사건번호:)/.test(line) || /(?:\d{4}[가-힣]+\d+|선고|\d{4}년)/.test(line)) {
      // URL/링크 라인 제외 후 짧게 트림
      const trimmed = line.replace(/\s*\([^)]*OC=[^)]*\)\s*/g, "").slice(0, 100)
      items.push(trimmed)
      if (items.length >= n) break
    }
  }
  // 카운트가 없을 때 항목 수 기반 추정
  if (count === 0 && items.length > 0) count = items.length
  return { count, topItems: items }
}

/** 조문 본문에서 인용된 다른 법령 추출 */
function extractCitedLaws(articleText: string): string[] {
  if (!articleText) return []
  const cited = new Set<string>()
  // "「OO법」", "「OO에 관한 법률」" 패턴
  const bracketRe = /「([^」]{2,40}?(?:법|법률|시행령|시행규칙|규칙|규정))」/g
  let m: RegExpExecArray | null
  while ((m = bracketRe.exec(articleText)) !== null) {
    cited.add(m[1].trim())
  }
  return [...cited].slice(0, 10)
}

function safeMermaidId(s: string): string {
  return s.replace(/[^A-Za-z0-9가-힣]/g, "_").slice(0, 20)
}

function buildMermaid(
  centerLabel: string,
  buckets: { precedents: number; interpretations: number; appeals: number; constitutional: number; ordinances: number; citedLaws: string[] }
): string {
  const center = safeMermaidId(centerLabel) || "CENTER"
  const lines: string[] = ["graph LR"]
  lines.push(`    ${center}["⚖️ ${centerLabel}"]`)
  if (buckets.precedents > 0) lines.push(`    ${center} --> P["📚 대법원 판례 ${buckets.precedents}건"]`)
  if (buckets.constitutional > 0) lines.push(`    ${center} --> C["⚖️ 헌재 결정 ${buckets.constitutional}건"]`)
  if (buckets.interpretations > 0) lines.push(`    ${center} --> I["📑 법령해석 ${buckets.interpretations}건"]`)
  if (buckets.appeals > 0) lines.push(`    ${center} --> A["📋 행정심판 ${buckets.appeals}건"]`)
  if (buckets.ordinances > 0) lines.push(`    ${center} --> O["🏛️ 자치법규 ${buckets.ordinances}건"]`)
  if (buckets.citedLaws.length > 0) {
    buckets.citedLaws.slice(0, 5).forEach((law, i) => {
      const id = `L${i}`
      lines.push(`    ${center} -.인용.-> ${id}["📖 ${law}"]`)
    })
  }
  return lines.join("\n")
}

export async function impactMap(
  apiClient: LawApiClient,
  input: ImpactMapInput
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    // 1. 법령 식별
    const laws = await findLaws(apiClient, input.lawName, input.apiKey, 1)
    if (laws.length === 0) {
      return {
        content: [{
          type: "text",
          text: `[NOT_FOUND] '${input.lawName}' 법령을 찾을 수 없습니다.\n⚠️ LLM은 법령·조문을 추측하지 마세요. 법령명을 확인하거나 search_law로 먼저 검색하세요.`,
        }],
        isError: true,
      }
    }
    const law = laws[0]

    // 가드: LIKE 부분매칭 1위를 맹신하면 무관한 법령의 영향 지도를
    // 헤더·그래프·후속 제안까지 확신형으로 그려버린다. 이름이 맞을 때만 진행.
    if (!resolvedLawMatches(input.lawName, law.lawName)) {
      return {
        content: [{
          type: "text",
          text: `[NOT_FOUND] '${input.lawName}' 법령을 정확히 찾지 못했습니다. 검색 최상위는 '${law.lawName}'이지만 요청한 법령과 다를 수 있습니다.\n⚠️ LLM은 법령·조문을 추측하지 마세요. search_law로 정식 법령명을 확인한 뒤 다시 호출하세요.`,
        }],
        isError: true,
      }
    }

    // 검색 쿼리 — 정확 매칭이 필요하니 법령명 + 조문번호 조합
    const joDisplay = input.jo.startsWith("제") ? input.jo : `제${input.jo}`
    const searchQuery = `${law.lawName} ${joDisplay}`

    // 2. 병렬 탐색
    const [articleR, precR, interpR, appealR, constR, ordinanceR] = await Promise.all([
      safeCall(getArticleDetail, apiClient, { mst: law.mst, jo: joDisplay, apiKey: input.apiKey }),
      safeCall(searchPrecedentsWithoutFallback, apiClient, { query: searchQuery, display: 10, apiKey: input.apiKey }),
      safeCall(searchInterpretations, apiClient, { query: searchQuery, display: 10, apiKey: input.apiKey }),
      safeCall(searchAdminAppeals, apiClient, { query: searchQuery, display: 5, apiKey: input.apiKey }),
      safeCall(searchConstitutionalDecisions, apiClient, { query: searchQuery, display: 5, apiKey: input.apiKey }),
      input.includeOrdinances
        ? safeCall(searchOrdinance, apiClient, { query: `${law.lawName} ${joDisplay}`, display: 10, apiKey: input.apiKey })
        : Promise.resolve({ text: "", isError: true } as CallResult),
    ])

    // 3. 결과 집계 (카운트 + 상위 항목)
    const prec = parseBucket(precR, 5)
    const interp = parseBucket(interpR, 5)
    const appeal = parseBucket(appealR, 3)
    const cons = parseBucket(constR, 3)
    const ordinance = parseBucket(ordinanceR, 5)

    const citedLaws = articleR.isError ? [] : extractCitedLaws(articleR.text)

    // 4. 텍스트 트리 출력
    const parts: string[] = []
    parts.push(`═══ Impact Map: ${law.lawName} ${joDisplay} ═══`)
    parts.push(`법령: ${law.lawName} (MST ${law.mst}, ${law.lawType})\n`)

    if (!articleR.isError && articleR.text.trim()) {
      const snippet = articleR.text.slice(0, 400).replace(/\n+/g, "\n")
      parts.push(`▶ 대상 조문 본문\n${snippet}${articleR.text.length > 400 ? "...\n" : "\n"}`)
    } else {
      parts.push(`▶ 대상 조문 본문 [NOT_FOUND] 조문 조회 실패 — 법령명·조문번호 확인 필요\n`)
    }

    parts.push(`▶ 영향 그래프 (이 조문이 인용된 곳)`)
    parts.push(`├─ 📚 대법원 판례: ${prec.count}건`)
    prec.topItems.forEach(l => parts.push(`│   • ${l}`))
    parts.push(`├─ ⚖️ 헌재 결정례: ${cons.count}건`)
    cons.topItems.forEach(l => parts.push(`│   • ${l}`))
    parts.push(`├─ 📑 법령해석례: ${interp.count}건`)
    interp.topItems.forEach(l => parts.push(`│   • ${l}`))
    parts.push(`├─ 📋 행정심판례: ${appeal.count}건`)
    appeal.topItems.forEach(l => parts.push(`│   • ${l}`))
    if (input.includeOrdinances) {
      parts.push(`└─ 🏛️ 자치법규: ${ordinance.count}건`)
      ordinance.topItems.forEach(l => parts.push(`    • ${l}`))
    }

    if (citedLaws.length > 0) {
      parts.push(`\n▶ 이 조문이 인용한 다른 법령 (정방향)`)
      citedLaws.forEach(law => parts.push(`  → ${law}`))
    }

    // 5. 합산 통계
    const total = prec.count + interp.count + appeal.count + cons.count + ordinance.count
    parts.push(`\n▶ 총 영향 건수: ${total}건 (판례 ${prec.count} / 헌재 ${cons.count} / 해석 ${interp.count} / 행심 ${appeal.count} / 조례 ${ordinance.count})`)
    parts.push(`인용 법령: ${citedLaws.length}개\n`)

    // 6. mermaid 그래프
    if (input.includeMermaid) {
      const mermaid = buildMermaid(`${law.lawName} ${joDisplay}`, {
        precedents: prec.count,
        interpretations: interp.count,
        appeals: appeal.count,
        constitutional: cons.count,
        ordinances: ordinance.count,
        citedLaws,
      })
      parts.push(`▶ Mermaid 그래프 (시각화)\n\`\`\`mermaid\n${mermaid}\n\`\`\`\n`)
    }

    // 7. 후속 액션
    parts.push(`━━━ 이어서 할 수 있는 조회 ━━━`)
    parts.push(`1. "${law.lawName} ${joDisplay} 판례" — 판례 상세`)
    parts.push(`2. "${law.lawName} ${joDisplay} 해석례" — 해석례 상세`)
    parts.push(`3. "${law.lawName} 신구대조표" — 개정 이력`)

    return {
      content: [{ type: "text", text: truncateResponse(parts.join("\n")) }],
    }
  } catch (error) {
    return formatToolError(error, "impact_map")
  }
}
