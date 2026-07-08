/**
 * ordinance_radar — 조례 정비 레이더 (v4.7.0 killer feature)
 *
 * 조례 본문이 「」로 인용한 근거 상위법령을 추출하고, 각 상위법의 현행 시행일과
 * 조례 시행일을 대조해 "상위법이 조례 시행 이후 개정됨 → 정비 검토 대상"을 자동 플래그.
 * 조례 담당 공무원의 최대 반복업무(상위법 개정 추적 → 조례 정비)를 한 번에 답한다.
 *
 * 데이터: 조례 본문(getOrdinance) + 법령 검색(searchLaw)만 사용.
 * lnkOrd(자치법규→상위법령 연계) API는 커버리지가 낮아 미사용 — 조례 본문의 「」
 * 인용이 한국 법령 표준 표기라 훨씬 안정적.
 */

import { z } from "zod"
import { DOMParser } from "@xmldom/xmldom"
import type { LawApiClient } from "../lib/api-client.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"
import { toArray, parseSearchXML, extractTag } from "../lib/xml-parser.js"
import { normalizeAliasKey, resolveLawAlias } from "../lib/search-normalizer.js"

export const OrdinanceRadarSchema = z.object({
  ordinSeq: z.string().optional().describe("자치법규 일련번호 (search_ordinance 결과의 [번호])"),
  id: z.string().optional().describe("ordinSeq 별칭 — 힌트가 id=로 안내하는 경우 대응"),
  ordinanceName: z.string().optional().describe("자치법규명 — 지정 시 검색 후 첫 결과 사용 (예: '서울특별시 광진구 주차장 설치 및 관리 조례')"),
  query: z.string().optional().describe("ordinanceName 별칭 — 자연어 조례명으로 검색 (search_law 등 다른 도구와 규약 통일)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
}).refine(d => d.ordinSeq || d.id || d.ordinanceName || d.query, {
  message: "ordinSeq(또는 별칭 id)·ordinanceName·query 중 하나는 필수입니다",
})

export type OrdinanceRadarInput = z.infer<typeof OrdinanceRadarSchema>

interface ParentLaw {
  name: string
  effDate: string
  promDate: string
  mst: string
  lawId: string
}

// 조례의 근거 상위법령은 제1조(목적)에 명시된다
// ("이 조례는 「주차장법」, 같은 법 시행령 및 시행규칙에서 위임한 사항과…").
// 본문 전체를 스캔하면 별표의 감면대상 정의 등에서 인용된 무관한 법률(공직선거법 등)이
// 대량 섞여 과잉경보가 나므로, 목적 조문의 인용만 근거법으로 취급한다.
function findPurposeArticle(articles: Array<Record<string, unknown>>): string {
  const byTitle = articles.find(a => /목적/.test(String(a.조제목 || "")))
  const target = byTitle || articles[0]
  return String(target?.조내용 || "")
}

// 목적 조문에서 근거 상위법령 추출.
// - 「」로 명시 인용된 법령(법/법률/시행령/시행규칙)
// - "같은 법 시행령/시행규칙" 축약 표현은 직전 base 법률에서 파생
function extractBasisLaws(purposeText: string, selfName: string): string[] {
  const selfKey = normalizeAliasKey(selfName)
  const result: string[] = []
  const seen = new Set<string>()
  const push = (name: string) => {
    const key = normalizeAliasKey(name)
    if (key === selfKey || seen.has(key)) return
    seen.add(key)
    result.push(name)
  }

  let baseLaw = ""
  const re = /「([^」]+)」/g
  let m: RegExpExecArray | null
  while ((m = re.exec(purposeText)) !== null) {
    const name = m[1].trim()
    if (!/(법|법률|시행령|시행규칙|규정)$/.test(name)) continue
    if (normalizeAliasKey(name) === selfKey) continue
    if (/(법|법률)$/.test(name) && !baseLaw) baseLaw = name // 첫 법률을 "같은 법"의 지시대상으로
    push(name)
  }

  // 「」 밖의 "같은 법 시행령/시행규칙" 파생 (base 법률이 있을 때만)
  if (baseLaw) {
    if (/시행령/.test(purposeText)) push(`${baseLaw} 시행령`)
    if (/시행규칙/.test(purposeText)) push(`${baseLaw} 시행규칙`)
  }
  return result
}

// YYYYMMDD 두 값의 개월 차 (일 무시, 근사). from → to가 미래면 양수.
function monthsBetween(fromYmd: string, toYmd: string): number {
  if (!/^\d{8}$/.test(fromYmd) || !/^\d{8}$/.test(toYmd)) return NaN
  const fromM = parseInt(fromYmd.slice(0, 4), 10) * 12 + parseInt(fromYmd.slice(4, 6), 10)
  const toM = parseInt(toYmd.slice(0, 4), 10) * 12 + parseInt(toYmd.slice(4, 6), 10)
  return toM - fromM
}

// 법령명 → 현행 시행일/공포일/식별자. 정확매칭 우선(가나다순 오매칭 방지).
async function fetchLawStatus(apiClient: LawApiClient, lawName: string, apiKey?: string): Promise<ParentLaw | null> {
  const xml = await apiClient.searchLaw(lawName, apiKey, 50)
  const nodes = new DOMParser().parseFromString(xml, "text/xml").getElementsByTagName("law")
  const queryKey = normalizeAliasKey(lawName)
  const canonicalKey = normalizeAliasKey(resolveLawAlias(lawName).canonical)
  let first: ParentLaw | null = null
  let exact: ParentLaw | null = null
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    const info: ParentLaw = {
      name: n.getElementsByTagName("법령명한글")[0]?.textContent || lawName,
      effDate: n.getElementsByTagName("시행일자")[0]?.textContent || "",
      promDate: n.getElementsByTagName("공포일자")[0]?.textContent || "",
      mst: n.getElementsByTagName("법령일련번호")[0]?.textContent || "",
      lawId: n.getElementsByTagName("법령ID")[0]?.textContent || "",
    }
    if (!first) first = info
    const nameKey = normalizeAliasKey(info.name)
    const abbrKey = normalizeAliasKey(n.getElementsByTagName("법령약칭명")[0]?.textContent || "")
    if (nameKey === queryKey || nameKey === canonicalKey || (abbrKey && (abbrKey === queryKey || abbrKey === canonicalKey))) {
      exact = info
      break
    }
  }
  return exact || first
}

function notFound(text: string): { content: Array<{ type: string, text: string }>, isError?: boolean } {
  return { content: [{ type: "text", text }], isError: true }
}

export async function ordinanceRadar(
  apiClient: LawApiClient,
  input: OrdinanceRadarInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    // 1. ordinSeq 확보 (직접 지정 우선, 없으면 조례명 검색 첫 결과)
    let ordinSeq = input.ordinSeq || input.id
    const searchName = input.ordinanceName || input.query
    if (!ordinSeq && searchName) {
      const sx = await apiClient.searchOrdinance({ query: searchName, display: 5, apiKey: input.apiKey })
      const parsed = parseSearchXML(sx, "OrdinSearch", "law", (c) => ({
        자치법규일련번호: extractTag(c, "자치법규일련번호"),
      }))
      ordinSeq = parsed.items[0]?.자치법규일련번호 || undefined
      if (!ordinSeq) {
        return notFound(`[NOT_FOUND] 자치법규 '${searchName}'을(를) 찾을 수 없습니다.\n⚠️ search_ordinance로 유효한 조례명·ordinSeq를 먼저 확인하세요.`)
      }
    }
    if (!ordinSeq) return notFound("[NOT_FOUND] ordinSeq 또는 ordinanceName이 필요합니다.")

    // 2. 조례 전문 조회 (jo 없이 → 전체 조문)
    const json = JSON.parse(await apiClient.getOrdinance(ordinSeq, undefined, input.apiKey))
    const svc = json?.LawService
    if (!svc) {
      return notFound("[NOT_FOUND] 자치법규 데이터를 찾을 수 없습니다.\n⚠️ search_ordinance로 유효한 ordinSeq를 먼저 확인하세요.")
    }
    const base = svc.자치법규기본정보 || {}
    const ordName: string = base.자치법규명 || "알 수 없음"
    const ordEff: string = base.시행일자 || ""
    const dept: string = base.담당부서명 || ""
    const govt: string = base.지자체기관명 || ""

    const articles = toArray(svc.조문?.조) as Array<Record<string, unknown>>

    // 3. 근거 상위법령 추출 (제1조 목적 기준 — 별표 등 무관 인용 배제)
    const purposeText = findPurposeArticle(articles)
    const parentNames = extractBasisLaws(purposeText, ordName)
    if (parentNames.length === 0) {
      return notFound(`[NO_PARENT] '${ordName}' 제1조(목적)에서 근거 상위법령(법률/시행령/시행규칙)을 찾지 못했습니다.\n⚠️ 조례가 상위법을 명시 인용하지 않는 유형일 수 있습니다. get_ordinance로 본문을 직접 확인하세요.`)
    }

    // 4. 각 상위법 현행 시행일 병렬 조회 (조례당 보통 1~4건)
    const statuses = await Promise.all(
      parentNames.map(async (name) => {
        try { return await fetchLawStatus(apiClient, name, input.apiKey) }
        catch { return null }
      })
    )

    // 5. 대조 + 리포트
    let out = `📡 조례 정비 레이더\n`
    out += `조례: ${ordName}\n`
    out += `시행일: ${ordEff || "미상"}`
    if (govt) out += ` | 자치단체: ${govt}`
    if (dept) out += ` | 소관: ${dept}`
    out += `\n\n근거 상위법령 ${parentNames.length}건 대조:\n`

    let needReview = 0
    let unknown = 0
    for (let i = 0; i < parentNames.length; i++) {
      const s = statuses[i]
      if (!s || !s.effDate) {
        unknown++
        out += `  ❓ ${parentNames[i]} — 현행 시행일 확인 불가 (search_law로 개별 확인 권장)\n`
        continue
      }
      const gap = ordEff ? monthsBetween(ordEff, s.effDate) : NaN
      if (!Number.isNaN(gap) && s.effDate > ordEff) {
        needReview++
        const gapText = gap > 0 ? `약 ${gap}개월 뒤` : "조례 시행 이후"
        out += `  ⚠️ ${s.name} — 현행 시행 ${s.effDate} (조례보다 ${gapText} 개정 → 정비 검토 대상, MST=${s.mst})\n`
      } else {
        out += `  ✅ ${s.name} — 현행 시행 ${s.effDate} (조례 시행 시점까지 반영)\n`
      }
    }

    out += `\n📋 요약: `
    if (needReview > 0) {
      out += `근거 상위법 ${parentNames.length}건 중 ${needReview}건이 조례 시행 이후 개정됨 → 정비 검토 대상.\n`
      out += `개정 내용이 조례 위임사항과 관련되는지 확인 권장 — get_law_text(mst=...)로 개정 조문을, compare_law로 신구 대조를 확인하세요.\n`
    } else if (unknown === parentNames.length) {
      out += `상위법 현행 시행일을 확인하지 못했습니다. 개별 search_law로 확인하세요.\n`
    } else {
      out += `근거 상위법이 조례 시행 시점까지 반영된 것으로 보입니다 (개정 시행일 기준).\n`
    }
    out += `\n⚠️ 시행일 선후 비교는 정비 '가능성' 신호이며, 실제 정비 필요 여부는 개정 조문 내용 확인이 필요합니다. LLM은 정비 필요를 단정하지 마세요.`

    return { content: [{ type: "text", text: truncateResponse(out) }] }
  } catch (error) {
    return formatToolError(error, "ordinance_radar")
  }
}
