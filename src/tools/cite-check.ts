/**
 * cite_check — 판례 생사 확인 / 인용 추적 (v4.3 killer feature, 한국형 Shepard's Citator)
 *
 * 문제: 전원합의체로 변경·폐기된 판례를 살아있는 것처럼 인용하는 것이
 *       판례 인용에서 가장 위험한 실수. LLM도 사람도 자주 범한다.
 *
 * 입력: 사건번호 (예: '2013다61381')
 * 처리:
 *   1. nb= 정확 검색으로 대상 판례 특정
 *   2. 본문검색(search=2)으로 그 사건번호를 인용한 후속 판례 역추적
 *   3. 후속 판례 중 전원합의체 우선 본문 정밀 스캔 → 변경·폐기 문구 감지
 *   4. 판정: 계속 인용 / 전합 후속 존재 / 변경 신호 감지 + 인용 타임라인
 *
 * 차별점: impact_map은 조문→판례 방향만 다룸. 판례→판례 인용 관계는 이 도구가 유일.
 * 한계: 법제처 수록 판례(대법원 중심) 범위 내 — 출력에 명시하여 과신 방지.
 */
import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError, notFoundResponse } from "../lib/errors.js"
import { parsePrecedentXML, type PrecedentItem } from "../lib/xml-parser.js"
import { cleanHtml } from "../lib/article-parser.js"
import type { ToolResponse } from "../lib/types.js"

export const CiteCheckSchema = z.object({
  caseNumber: z.string().describe("사건번호 (예: '2013다61381', '대법원 2018.10.30. 선고 2013다61381'처럼 문장 포함 가능)"),
  display: z.number().optional().default(20).describe("후속 인용 판례 최대 표시 수 (기본 20)"),
  deepScan: z.boolean().optional().default(true).describe("후속 인용 상위 판례 본문 정밀 스캔 (변경·폐기 문구 감지, 기본 true)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
})

export type CiteCheckInput = z.infer<typeof CiteCheckSchema>

/** 텍스트에서 사건번호 추출 (예: 2013다61381, 96누4671, 2010두28604) */
const CASE_NO_RE = /(\d{2,4})\s*([가-힣]{1,5})\s*(\d{1,7})/g

export function extractCaseNumbers(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  CASE_NO_RE.lastIndex = 0
  while ((m = CASE_NO_RE.exec(text)) !== null) {
    const cn = `${m[1]}${m[2]}${m[3]}`
    if (!seen.has(cn)) {
      seen.add(cn)
      out.push(cn)
    }
  }
  return out
}

/** 변경·폐기 treatment 신호 패턴 (대법원 전원합의체 판례변경 상투 문구) */
const CHANGE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /변경하기로\s*(?:한다|하면서|함|하였)/, label: "판례 변경 선언" },
  { re: /폐기하기로|폐기한다|폐기되었/, label: "판례 폐기 선언" },
  { re: /더\s*이상\s*유지(?:될\s*수\s*없|하기\s*어렵)/, label: "선례 유지 불가 판시" },
  { re: /배치되는\s*범위\s*에?서?\s*(?:이를\s*)?(?:모두\s*)?변경/, label: "저촉 범위 변경" },
]

interface CitingCase extends PrecedentItem {
  isEnBanc: boolean
}

function toYmd(date?: string): string {
  return (date || "").replace(/[^\d]/g, "")
}

function isEnBancItem(item: PrecedentItem): boolean {
  return /전원합의체/.test(`${item.판례명 || ""} ${item.판결유형 || ""}`)
}

async function fetchPrecedentDetail(
  apiClient: LawApiClient,
  id: string,
  apiKey?: string
): Promise<Record<string, unknown> | null> {
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
  } catch {
    return null
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * 본문에서 대상 판례 언급 주변 ±window 자 내 변경 문구 감지 + 인용 맥락 추출.
 *
 * 판결문 관행 주의: 사건번호를 한 번 쓰고 "(이하 '2008년 전원합의체 판결'이라 한다)"로
 * 별칭을 정의한 뒤, 정작 변경 선언은 별칭으로 한다 (예: 2018다248626 → 2007다27670 변경).
 * 사건번호만 추적하면 false negative — 별칭 정의를 감지해 별칭 출현 지점도 함께 스캔한다.
 */
function scanTreatment(body: string, targetCaseNo: string, window = 250): {
  changeSignals: string[]
  context?: string
} {
  const clean = cleanHtml(body).replace(/\s+/g, " ")
  // 사건번호는 본문에서 "2013다61381" 또는 "2013 다 61381" 형태
  const targetSrc = targetCaseNo.replace(/(\d)([가-힣]+)(\d)/, "$1\\s*$2\\s*$3")
  const refIndices: number[] = []
  let m: RegExpExecArray | null

  const targetRe = new RegExp(targetSrc, "g")
  while ((m = targetRe.exec(clean)) !== null) refIndices.push(m.index)

  // 별칭 정의: "…2007다27670 전원합의체 판결(이하 '2008년 전원합의체 판결'이라 한다)"
  const aliasDefRe = new RegExp(
    targetSrc + "[^(]{0,40}\\(\\s*이하\\s*[‘'\"“]?([^’'\"”)]{2,40}?)[’'\"”]?\\s*(?:이?라\\s*고?\\s*)?한다",
    "g"
  )
  const aliases = new Set<string>()
  while ((m = aliasDefRe.exec(clean)) !== null) aliases.add(m[1].trim())
  for (const alias of aliases) {
    const aliasRe = new RegExp(escapeRe(alias), "g")
    while ((m = aliasRe.exec(clean)) !== null) refIndices.push(m.index)
  }

  const signals = new Set<string>()
  let context: string | undefined
  for (const idx of refIndices.sort((a, b) => a - b)) {
    const win = clean.slice(Math.max(0, idx - window), Math.min(clean.length, idx + window))
    if (!context) context = win.slice(0, 300)
    for (const { re, label } of CHANGE_PATTERNS) {
      if (re.test(win)) {
        signals.add(label)
        context = win.slice(0, 300)  // 신호 잡힌 맥락을 우선 노출
      }
    }
  }
  return { changeSignals: [...signals], context }
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
        const body = String(d?.판례내용 || "")
        if (!body) return
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
    } else if (citing.length > 0) {
      const enBancNote = enBancCiting.length > 0 ? ` (전원합의체 ${enBancCiting.length}건 포함 정밀 스캔 완료)` : ""
      verdict = `✅ 후속 인용 ${citing.length}건, 변경·폐기 신호 미감지 — 계속 인용되는 것으로 추정${enBancNote}`
    } else {
      verdict = `ℹ️ 법제처 수록 범위 내 후속 인용 없음 — 미수록 판례의 인용 가능성은 배제 못 함`
    }

    // 출력 조립
    const refCases = extractCaseNumbers(String(targetDetail?.참조판례 || "")).filter(c => c !== caseNo)
    const lines: string[] = []
    lines.push(`═══ 판례 인용 추적 (Citator): ${caseNo} ═══`)
    lines.push(`대상: ${target.법원명 || ""} ${target.선고일자 || ""} 선고 ${target.사건번호 || caseNo} ${isEnBancItem(target) ? "전원합의체 " : ""}판결`)
    if (target.판례명) lines.push(`사건명: ${target.판례명}`)
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

    if (scanResults.length > 0) {
      lines.push("")
      lines.push(`▶ 본문 정밀 스캔 (${scanResults.length}건)`)
      for (const r of scanResults) {
        const mark = r.signals.length > 0 ? `🚨 ${r.signals.join(", ")}` : "인용 확인 (변경 문구 없음)"
        lines.push(`  - ${r.item.사건번호}: ${mark}`)
        if (r.context) lines.push(`    맥락: "…${r.context}…"`)
      }
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
