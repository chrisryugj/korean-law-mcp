/**
 * applicable_law — 행위시법 판단 (v4.3 killer feature)
 *
 * 문제: "사건 발생 시점(예: 2023.5.10)에 어떤 법이 적용되나"는 법률 실무 최빈 질문인데,
 *       LLM은 항상 현행법으로 답해서 오답을 낸다. 결론은 부칙 경과조치가 뒤집을 수 있다.
 *
 * 입력: 법령명 + 기준일(행위·계약·처분 시점) + 조문(선택)
 * 처리:
 *   1. lsHistory 연혁으로 기준일에 시행 중이던 버전(MST) 특정
 *   2. 그 버전의 해당 조문 본문 조회 (eflaw는 MST가 버전 고유)
 *   3. 현행 조문과 동일/변경 비교
 *   4. 이후 개정 부칙에서 적용례·경과조치 자동 발췌 (공포번호 매칭)
 *   5. 행위시법/재판시법/제재처분 법리 주의 문구
 *
 * 차별점: time_travel은 두 시점 diff. 이 도구는 "특정 시점의 적용 법령 버전 특정 + 경과규정".
 * 한계: 경과조치 '해석'은 하지 않음 — 발췌와 경고까지만 (해석은 사람/LLM 몫).
 */
import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError, notFoundResponse } from "../lib/errors.js"
import { findLaws } from "../lib/law-search.js"
import { fetchHistoricalVersionsFull, type HistoricalVersion } from "../lib/historical-utils.js"
import { buildJO } from "../lib/law-parser.js"
import { cleanHtml } from "../lib/article-parser.js"
import { toArray } from "../lib/xml-parser.js"
import type { ToolResponse } from "../lib/types.js"

export const ApplicableLawSchema = z.object({
  lawName: z.string().describe("법령명 (예: '도로교통법', '근로기준법')"),
  date: z.string().describe("기준일 — 행위·계약·처분 시점 (예: '2023-05-10', '2023.5.10', '20230510')"),
  jo: z.string().optional().describe("조문 번호 (예: '제44조', '제10조의2'). 지정 시 해당 시점 조문 본문 + 현행 비교 제공"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
})

export type ApplicableLawInput = z.infer<typeof ApplicableLawSchema>

/** 다양한 날짜 표기 → YYYYMMDD. 실패 시 null */
export function normalizeDate(input: string): string | null {
  const m = input.trim().match(/(\d{4})\s*[.\-/년\s]?\s*(\d{1,2})\s*[.\-/월\s]?\s*(\d{1,2})\s*일?/)
  if (!m) {
    const digits = input.replace(/\D/g, "")
    return /^\d{8}$/.test(digits) ? digits : null
  }
  const y = parseInt(m[1], 10)
  const mo = parseInt(m[2], 10)
  const d = parseInt(m[3], 10)
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return `${y}${String(mo).padStart(2, "0")}${String(d).padStart(2, "0")}`
}

function fmtYmd(ymd: string): string {
  if (!/^\d{8}$/.test(ymd)) return ymd
  return `${ymd.slice(0, 4)}.${parseInt(ymd.slice(4, 6), 10)}.${parseInt(ymd.slice(6, 8), 10)}.`
}

/** eflaw JSON에서 조문 본문 추출 (항·호 평탄화) */
function extractJoText(jsonText: string): string {
  try {
    const json = JSON.parse(jsonText)
    const units = toArray<any>(json?.법령?.조문?.조문단위)
    const found = units.find((u: any) => u?.조문여부 === "조문")
    if (!found) return ""
    const parts: string[] = []
    parts.push(cleanHtml(String(found.조문내용 || "")))
    for (const h of toArray<any>(found.항)) {
      if (h?.항내용) parts.push(cleanHtml(String(h.항내용)))
      for (const ho of toArray<any>(h?.호)) {
        if (ho?.호내용) parts.push(cleanHtml(String(ho.호내용)))
      }
    }
    return parts.join("\n").trim()
  } catch {
    return ""
  }
}

/** 부칙내용(중첩 배열/문자열)을 라인 배열로 평탄화 */
function flattenAddendum(content: unknown): string[] {
  if (content === null || content === undefined) return []
  if (typeof content === "string") {
    return content.split(/\n/).map(s => cleanHtml(s).trim()).filter(Boolean)
  }
  if (Array.isArray(content)) return content.flatMap(flattenAddendum)
  return [cleanHtml(String(content)).trim()].filter(Boolean)
}

/** 경과규정·적용례 신호 패턴 */
const TRANSITION_RE = /적용례|경과조치|종전의\s*규정|시행\s*전에?\s*|행위에\s*대하여|예에\s*따른다|불구하고.*적용/

interface AddendumExcerpt {
  header: string   // "부칙 <제19158호, 2023.1.3.>"
  lines: string[]  // 적용례·경과조치 발췌
}

function extractTransitionExcerpts(
  units: any[],
  relevantAncNos: Set<string>,
  joDisplay?: string,
  maxAddenda = 6,
  maxLinesPer = 3
): AddendumExcerpt[] {
  const out: AddendumExcerpt[] = []
  // 최신 부칙부터 (공포일자 내림차순)
  const sorted = [...units].sort((a, b) =>
    String(b?.부칙공포일자 || "").localeCompare(String(a?.부칙공포일자 || "")))

  for (const unit of sorted) {
    if (out.length >= maxAddenda) break
    const ancNo = String(parseInt(String(unit?.부칙공포번호 || "0"), 10))
    if (relevantAncNos.size > 0 && !relevantAncNos.has(ancNo)) continue

    const lines = flattenAddendum(unit?.부칙내용)
    if (lines.length === 0) continue
    // 원문 첫 줄이 "부칙 <제N호,...>" 형식이면 사용, "부칙"만 있으면 공포번호·일자로 구성
    const header = lines[0].startsWith("부칙") && /제\s*\d+\s*호/.test(lines[0]) ? lines[0]
      : `부칙 <제${unit?.부칙공포번호}호, ${fmtYmd(String(unit?.부칙공포일자 || ""))}>`

    // 조문 지정 시: 해당 조문 언급 라인 최우선 → 경과규정 신호 라인
    const joHits = joDisplay ? lines.filter(l => l.includes(joDisplay)) : []
    const transitionHits = lines.filter(l => TRANSITION_RE.test(l) && !joHits.includes(l))
    const picked = [...joHits, ...transitionHits].slice(0, maxLinesPer)
    if (picked.length === 0) continue

    out.push({ header, lines: picked.map(l => l.length > 250 ? l.slice(0, 250) + "…" : l) })
  }
  return out
}

export async function applicableLaw(
  apiClient: LawApiClient,
  input: ApplicableLawInput
): Promise<ToolResponse> {
  try {
    const date = normalizeDate(input.date)
    if (!date) {
      return notFoundResponse(`기준일 '${input.date}'을(를) 해석하지 못했습니다.`, [
        "지원 형식: 2023-05-10 / 2023.5.10 / 20230510 / 2023년 5월 10일",
      ])
    }

    // 1. 법령 식별
    const laws = await findLaws(apiClient, input.lawName, input.apiKey, 1)
    if (laws.length === 0) {
      return notFoundResponse(`'${input.lawName}' 법령을 찾을 수 없습니다.`, [
        "search_law로 정확한 법령명을 먼저 확인하세요.",
      ])
    }
    const law = laws[0]

    // 2. 연혁 → 기준일 시행 버전 특정 (versions는 시행일 내림차순)
    const { versions } = await fetchHistoricalVersionsFull(apiClient, law.lawName, input.apiKey)
    if (versions.length === 0) {
      return notFoundResponse(`'${law.lawName}' 연혁을 조회하지 못했습니다.`, [
        "get_law_history 또는 search_historical_law로 직접 확인하세요.",
      ])
    }

    const applicable = versions.find(v => v.efYd && v.efYd <= date)
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "")
    const current = versions.find(v => v.efYd && v.efYd <= today)
    const laterVersions = versions.filter(v => v.efYd && v.efYd > date && v.efYd <= today)

    const lines: string[] = []
    lines.push(`═══ 행위시법 판단: ${law.lawName} @ ${fmtYmd(date)} ═══`)
    lines.push("")

    if (!applicable) {
      const earliest = versions[versions.length - 1]
      lines.push(`✗ 기준일 ${fmtYmd(date)} 당시 이 법령은 시행 전입니다.`)
      lines.push(`  최초 시행일: ${fmtYmd(earliest?.efYd || "")} (${earliest?.rrCls || "제정"})`)
      lines.push("")
      lines.push("⚠️ 기준일에 적용할 이 법령의 버전이 없습니다. 당시 규율하던 구법(폐지 법령)이 있는지 search_historical_law로 확인하세요.")
      return { content: [{ type: "text", text: truncateResponse(lines.join("\n")) }] }
    }

    // 적용 버전 표시
    lines.push(`▶ 기준일에 시행 중이던 버전`)
    const promulgation = [`제${applicable.ancNo}호`, applicable.ancYd ? fmtYmd(applicable.ancYd) : "", applicable.rrCls]
      .filter(Boolean).join(", ")
    lines.push(`  ${law.lawName} [시행 ${fmtYmd(applicable.efYd)}] [${promulgation}] (MST ${applicable.mst})`)
    if (laterVersions.length > 0) {
      lines.push(`  ↳ 기준일 이후 현재까지 ${laterVersions.length}차례 개정·시행됨 (현행: 시행 ${fmtYmd(current?.efYd || "")})`)
    } else {
      lines.push(`  ↳ 이 버전이 현행입니다 (기준일 이후 개정 없음)`)
    }

    // 3. 조문 비교 (jo 지정 시)
    const joDisplay = input.jo ? (input.jo.startsWith("제") ? input.jo : `제${input.jo}`) : undefined
    if (joDisplay) {
      const joCode = buildJO(joDisplay)
      // eflaw는 MST 단독 조회 불가 — 해당 버전의 efYd 동반 필수 (없으면 "일치하는 법령이 없습니다")
      const [thenJson, nowJson] = await Promise.all([
        apiClient.getLawText({ mst: applicable.mst, jo: joCode, efYd: applicable.efYd, apiKey: input.apiKey }).catch(() => ""),
        current && current.mst !== applicable.mst
          ? apiClient.getLawText({ mst: current.mst, jo: joCode, efYd: current.efYd, apiKey: input.apiKey }).catch(() => "")
          : Promise.resolve(""),
      ])
      const thenText = thenJson ? extractJoText(thenJson) : ""
      const nowText = nowJson ? extractJoText(nowJson) : ""

      lines.push("")
      lines.push(`▶ 기준일 시점 조문: ${joDisplay}`)
      if (thenText) {
        lines.push(thenText.length > 2000 ? thenText.slice(0, 2000) + "\n…(생략)" : thenText)
      } else {
        lines.push(`  [NOT_FOUND] 해당 버전에서 ${joDisplay}를 찾지 못했습니다 (당시 미신설이거나 조회 실패). LLM은 본문을 추측하지 마세요.`)
      }

      if (current && current.mst !== applicable.mst) {
        lines.push("")
        const norm = (s: string) => s.replace(/\s+/g, "")
        if (thenText && nowText) {
          if (norm(thenText) === norm(nowText)) {
            lines.push(`▶ 현행과 비교: ✅ 동일 (기준일 이후 이 조문은 개정되지 않음)`)
          } else {
            lines.push(`▶ 현행과 비교: △ 변경됨 — 현행 본문과 다릅니다. 인용 시 반드시 기준일 버전을 사용하세요.`)
            lines.push(`  상세 diff: chain_amendment_track(query="${law.lawName}", scenario="time_travel", fromDate="${date}", toDate="${today}")`)
          }
        } else {
          lines.push(`▶ 현행과 비교: 비교 불가 (한쪽 본문 조회 실패)`)
        }
      }
    }

    // 4. 이후 개정 부칙의 적용례·경과조치 발췌
    if (laterVersions.length > 0 && current) {
      try {
        const lawJson = await apiClient.fetchApi({
          endpoint: "lawService.do",
          target: "law",
          type: "JSON",
          extraParams: { MST: current.mst },
          apiKey: input.apiKey,
        })
        const parsed = JSON.parse(lawJson)
        const units = toArray<any>(parsed?.법령?.부칙?.부칙단위)
        // 기준일 이후 시행 개정들의 공포번호 + 적용 버전 자신의 부칙
        const relevant = new Set<string>([
          ...laterVersions.map(v => String(parseInt(v.ancNo || "0", 10))),
          String(parseInt(applicable.ancNo || "0", 10)),
        ])
        const excerpts = extractTransitionExcerpts(units, relevant, joDisplay)

        lines.push("")
        if (excerpts.length > 0) {
          lines.push(`▶ 적용례·경과조치 발췌 (기준일 사건에 영향 가능 — 반드시 확인)`)
          for (const ex of excerpts) {
            lines.push(`  ◆ ${ex.header}`)
            ex.lines.forEach(l => lines.push(`    ${l}`))
          }
        } else {
          lines.push(`▶ 적용례·경과조치: 이후 개정 부칙에서 경과규정 신호 미발견 (부칙 원문 확인: get_law_text)`)
        }
      } catch {
        lines.push("")
        lines.push(`▶ 적용례·경과조치: [FAILED] 부칙 조회 실패 — get_law_text(mst="${current.mst}")로 부칙을 직접 확인하세요.`)
      }
    }

    // 5. 법리 주의 문구
    lines.push("")
    lines.push("⚖️ 적용 법령 판단 시 주의")
    lines.push("  - 형사처벌: 행위시법 원칙 (형법 제1조제1항). 단, 재판 시 법이 더 가벼우면 신법 적용 (같은 조 제2항)")
    lines.push("  - 제재처분(과징금·영업정지 등): 위반행위 시 법령 적용 (행정기본법 제14조제3항 본문). 단, 제재 기준이 가벼워졌으면 변경된 법령 (같은 항 단서)")
    lines.push("  - 인허가 등 일반 처분: 원칙적으로 처분 시 법령 (행정기본법 제14조제2항)")
    lines.push("  - 위 원칙은 부칙 경과규정이 우선합니다 — 위 발췌를 반드시 확인하세요. 이 도구는 발췌만 제공하며 해석하지 않습니다.")

    return { content: [{ type: "text", text: truncateResponse(lines.join("\n")) }] }
  } catch (error) {
    return formatToolError(error, "applicable_law")
  }
}
