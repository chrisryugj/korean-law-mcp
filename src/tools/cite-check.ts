/**
 * cite_check — 판례 생사 확인 / 인용 추적 (v4.3 killer feature, 한국형 Shepard's Citator)
 *
 * 문제: 전원합의체로 변경·폐기된 판례를 살아있는 것처럼 인용하는 것이 판례 인용에서 가장 위험한 실수.
 * 입력 사건번호(예: '2013다61381')로 ① nb= 정확 검색으로 대상 판례를 특정하고
 * ② 본문검색(search=2)으로 그 사건번호를 인용한 후속 판례를 역추적한 뒤
 * ③ 전원합의체 우선으로 본문을 정밀 스캔해 변경·폐기 문구를 감지하고
 * ④ 판정(계속 인용 / 전합 후속 존재 / 변경 신호)과 인용 타임라인을 낸다.
 *
 * 차별점: impact_map은 조문→판례 방향만 다룸. 판례→판례 인용 관계는 이 도구가 유일.
 * 한계: 법제처 수록 판례(대법원 중심) 범위 — 출력에 명시하여 과신 방지.
 */
import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError, notFoundResponse } from "../lib/errors.js"
import { parsePrecedentXML, type PrecedentItem } from "../lib/xml-parser.js"
import { extractCaseNumbers, fieldHasExactCase } from "../lib/case-citation.js"
import { extractHolding, scanTreatment, fieldText } from "../lib/precedent-body.js"
import { rethrowIfFatal } from "../lib/fatal-errors.js"
import type { ToolResponse } from "../lib/types.js"

export const CiteCheckSchema = z.object({
  caseNumber: z.string().describe("사건번호 (예: '2013다61381', '대법원 2018.10.30. 선고 2013다61381'처럼 문장 포함 가능)"),
  display: z.number().optional().default(20).describe("후속 인용 판례 최대 표시 수 (기본 20)"),
  deepScan: z.boolean().optional().default(true).describe("후속 인용 상위 판례 본문 정밀 스캔 (변경·폐기 문구 감지, 기본 true)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
})

export type CiteCheckInput = z.infer<typeof CiteCheckSchema>

interface CitingCase extends PrecedentItem {
  isEnBanc: boolean
}

function toYmd(date?: string): string {
  return (date || "").replace(/[^\d]/g, "")
}

function isEnBancItem(item: PrecedentItem): boolean {
  return /전원합의체/.test(`${item.판례명 || ""} ${item.판결유형 || ""}`)
}

async function fetchPrecedentDetail(apiClient: LawApiClient, id: string, apiKey?: string): Promise<Record<string, unknown> | null> {
  try {
    const text = await apiClient.fetchApi({
      endpoint: "lawService.do",
      target: "prec",
      type: "JSON",
      extraParams: { ID: id },
      apiKey,
    })
    const json = JSON.parse(text)
    return json?.PrecService || json || null
  } catch (error) {
    // 예산 소진·요청 취소는 "본문 없음"이 아니다 (2026-09-23 리뷰 B#11). 그 밖의 실패(null)는
    // 호출부가 "스캔 못 함"으로 밝힌다: 조용히 빠지면 판정이 ✅ "계속 인용 추정"으로 나간다.
    rethrowIfFatal(error)
    return null
  }
}

export async function citeCheck(
  apiClient: LawApiClient,
  input: CiteCheckInput
): Promise<ToolResponse> {
  try {
    const candidates = extractCaseNumbers(input.caseNumber)
    if (candidates.length === 0) {
      return notFoundResponse(`'${input.caseNumber}'에서 사건번호를 추출하지 못했습니다.`, [
        "사건번호 형식 예: 2013다61381, 96누4671, 2018두42559",
      ])
    }
    const caseNo = candidates[0]

    // 1단계: 대상 판례 특정 (nb= 정확 검색)
    const targetXml = await apiClient.fetchApi({
      endpoint: "lawSearch.do",
      target: "prec",
      extraParams: { nb: caseNo, display: "10" },
      apiKey: input.apiKey,
    })
    const targetParsed = parsePrecedentXML(targetXml)
    // 동일 사건번호 정확 매칭 우선, 대법원 우선
    const exact = targetParsed.items.filter(i => (i.사건번호 || "").replace(/\s/g, "").includes(caseNo))
    const pool = exact.length > 0 ? exact : targetParsed.items
    const target = pool.find(i => /대법원/.test(i.법원명 || "")) || pool[0]

    if (!target) {
      return notFoundResponse(`사건번호 '${caseNo}' 판례를 법제처 DB에서 찾을 수 없습니다.`, [
        "법제처 수록 판례는 대법원 중심입니다. 하급심은 search_decisions(query=키워드)로 검색하세요.",
        "사건번호 오탈자 확인 (예: 다/두/도/누 구분)",
      ])
    }

    // 2~3단계 병렬: 대상 상세(참조판례) + 후속 인용 역추적(본문검색)
    const [targetDetail, citingXml] = await Promise.all([
      fetchPrecedentDetail(apiClient, target.판례일련번호, input.apiKey),
      apiClient.fetchApi({
        endpoint: "lawSearch.do",
        target: "prec",
        extraParams: { search: "2", query: caseNo, display: "50" },
        apiKey: input.apiKey,
      }),
    ])

    const citingParsed = parsePrecedentXML(citingXml)
    const citing: CitingCase[] = citingParsed.items
      .filter(i => i.판례일련번호 !== target.판례일련번호)
      .filter(i => (i.사건번호 || "").replace(/\s/g, "") !== caseNo)
      .map(i => ({ ...i, isEnBanc: isEnBancItem(i) }))
      .sort((a, b) => toYmd(b.선고일자).localeCompare(toYmd(a.선고일자)))

    // 4단계: 정밀 스캔 — 전원합의체 > 대법원 > 최신 순으로 최대 3건
    const scanResults: Array<{ item: CitingCase; signals: string[]; context?: string }> = []
    // 본문을 받지 못해 스캔하지 못한 후속 판례 (B#11). "변경 문구 없음"과 섞으면 안 된다
    const scanFailed: CitingCase[] = []
    if (input.deepScan && citing.length > 0) {
      const prioritized = [...citing].sort((a, b) => {
        if (a.isEnBanc !== b.isEnBanc) return a.isEnBanc ? -1 : 1
        const aSup = /대법원/.test(a.법원명 || "") ? 1 : 0
        const bSup = /대법원/.test(b.법원명 || "") ? 1 : 0
        if (aSup !== bSup) return bSup - aSup
        return toYmd(b.선고일자).localeCompare(toYmd(a.선고일자))
      }).slice(0, 3)

      const details = await Promise.all(
        prioritized.map(i => fetchPrecedentDetail(apiClient, i.판례일련번호, input.apiKey))
      )
      details.forEach((d, idx) => {
        // String()으로 뭉개면 `{#text:…}` 본문이 "[object Object]"가 되는데, 이건 비어 있지
        // 않아 아래 가드를 통과한다 → 변경 문구를 못 찾고 "계속 인용 추정"으로 인증된다.
        const body = fieldText(d?.판례내용)
        if (!body) {
          scanFailed.push(prioritized[idx])
          return
        }
        const { changeSignals, context } = scanTreatment(body, caseNo)
        scanResults.push({ item: prioritized[idx], signals: changeSignals, context })
      })
    }

    // 판정
    const changed = scanResults.filter(r => r.signals.length > 0)
    const enBancCiting = citing.filter(c => c.isEnBanc)
    const scannedIds = new Set(scanResults.map(r => r.item.판례일련번호))
    const enBancUnscanned = enBancCiting.filter(c => !scannedIds.has(c.판례일련번호))
    let verdict: string
    if (changed.length > 0) {
      verdict = `❌ 변경·폐기 신호 감지 — ${changed.map(r => `${r.item.사건번호}(${r.signals.join(", ")})`).join("; ")}\n   ⚠️ 이 판례를 현재 법리로 인용하기 전에 반드시 해당 후속 판결 전문을 확인하세요.`
    } else if (enBancUnscanned.length > 0) {
      // 스캔 안 된 전합 후속이 남아있을 때만 경고 (판례 변경은 전원합의체에서만 가능, 법원조직법 제7조)
      verdict = `⚠️ 미스캔 전원합의체 후속 판결 ${enBancUnscanned.length}건 존재 — 법리 변경 여부 본문 확인 권장 (${enBancUnscanned.slice(0, 3).map(c => c.사건번호).join(", ")})`
    } else if (citing.length > 0 && scanFailed.length > 0) {
      // 스캔을 못 한 건이 남았는데 ✅ 를 주면 조회 실패가 "변경 신호 없음"으로 둔갑한다 (B#11)
      verdict = `⚠️ 후속 인용 ${citing.length}건, 정밀 스캔 대상 ${scanResults.length + scanFailed.length}건 중 ${scanFailed.length}건 본문 확인 불가: 변경·폐기 여부 미확정 (${scanFailed.map(c => c.사건번호).join(", ")}). get_decision_text 로 해당 판결 전문을 확인하세요.`
    } else if (citing.length > 0) {
      const enBancNote = enBancCiting.length > 0 ? ` (전원합의체 ${enBancCiting.length}건 포함 정밀 스캔 완료)` : ""
      verdict = `✅ 후속 인용 ${citing.length}건, 변경·폐기 신호 미감지 — 계속 인용되는 것으로 추정${enBancNote}`
    } else {
      verdict = `ℹ️ 법제처 수록 범위 내 후속 인용 없음 — 미수록 판례의 인용 가능성은 배제 못 함`
    }

    // 출력 조립
    const refCases = extractCaseNumbers(fieldText(targetDetail?.참조판례)).filter(c => c !== caseNo)
    const lines: string[] = []
    lines.push(`═══ 판례 인용 추적 (Citator): ${caseNo} ═══`)
    lines.push(`대상: ${target.법원명 || ""} ${target.선고일자 || ""} 선고 ${target.사건번호 || caseNo} ${isEnBancItem(target) ? "전원합의체 " : ""}판결`)
    // nb=는 전방 일치라 잘린 입력("2013다6138")에도 이웃 판례가 특정된다. 부분 입력 관용은
    // 기능으로 유지하되, 입력과 다른 판례가 특정되면 그 사실을 병기한다 — 무경고면 다른
    // 판례의 생사 판정이 입력 사건번호의 것으로 읽힌다 (#150).
    if (!fieldHasExactCase(target.사건번호 || "", caseNo)) {
      lines.push(`⚠ 입력 사건번호와 다른 판례가 특정됨: ${caseNo} → ${target.사건번호 || "(사건번호 없음)"} — 아래 판정은 특정된 판례 기준입니다.`)
    }
    if (target.판례명) lines.push(`사건명: ${target.판례명}`)
    // 사건명만으로는 판결의 정체성을 알 수 없다 — 생사만 답하면 오소개로 이어진다(#95).
    const holding = extractHolding(targetDetail)
    if (holding) lines.push(`${holding.label}: ${holding.text}`)
    // 대상 본문을 못 받으면 판시사항·참조판례가 조용히 빠진다. 없는 것과 못 받은 것을 가른다 (B#11)
    if (!targetDetail) lines.push(`⚠ 대상 판례 본문 조회 실패: 판시사항·참조판례를 확인하지 못했습니다 (get_decision_text 로 재조회).`)
    lines.push("")
    lines.push(`📊 판정: ${verdict}`)

    if (citing.length > 0) {
      lines.push("")
      lines.push(`▶ 이 판례를 인용한 후속 판례 (${citing.length}건, 최신순)`)
      citing.slice(0, input.display).forEach((c, i) => {
        const enBanc = c.isEnBanc ? " ⚡전원합의체" : ""
        lines.push(`  ${i + 1}. ${c.법원명 || ""} ${c.선고일자 || ""} ${c.사건번호 || ""}${enBanc} — ${(c.판례명 || "").slice(0, 60)}`)
      })
      if (citing.length > input.display) lines.push(`  … 외 ${citing.length - input.display}건`)
    }

    if (scanResults.length > 0 || scanFailed.length > 0) {
      lines.push("")
      lines.push(scanFailed.length > 0
        ? `▶ 본문 정밀 스캔 (${scanResults.length + scanFailed.length}건, 본문 확인 불가 ${scanFailed.length}건)`
        : `▶ 본문 정밀 스캔 (${scanResults.length}건)`)
      for (const r of scanResults) {
        const mark = r.signals.length > 0 ? `🚨 ${r.signals.join(", ")}` : "인용 확인 (변경 문구 없음)"
        lines.push(`  - ${r.item.사건번호}: ${mark}`)
        if (r.context) lines.push(`    맥락: "…${r.context}…"`)
      }
      for (const c of scanFailed) lines.push(`  - ${c.사건번호}: 본문 확인 불가 (조회 실패 또는 본문 미제공, 스캔 못 함)`)
    }

    if (refCases.length > 0) {
      lines.push("")
      lines.push(`▶ 이 판례가 인용한 판례 (참조판례 ${refCases.length}건)`)
      lines.push(`  ${refCases.join(", ")}`)
      lines.push(`  ↳ 각 판례의 생사 확인: cite_check(caseNumber="...")`)
    }

    lines.push("")
    lines.push("⚠️ 한계: 법제처 수록 판례(대법원 중심) 범위 내 검색입니다. 하급심·미수록 판례의 인용은 포함되지 않으며,")
    lines.push("   변경 신호 감지는 휴리스틱입니다. 최종 확인은 후속 판결 전문 검토(get_decision_text) 및 종합법률정보 병행을 권장합니다.")

    return { content: [{ type: "text", text: truncateResponse(lines.join("\n")) }] }
  } catch (error) {
    return formatToolError(error, "cite_check")
  }
}
