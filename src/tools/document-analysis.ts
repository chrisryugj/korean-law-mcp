/**
 * 문서 리스크 분석 도구
 *
 * 계약서/약관/협정서 텍스트를 입력받아
 * 조항별 잠재적 법적 리스크를 식별하고 관련 검색 힌트를 제공.
 * API 호출 없이 순수 텍스트 분석만 수행.
 */

import { z } from "zod"
import { truncateResponse } from "../lib/schemas.js"
import {
  classifyDocument, DOC_LABELS, SEARCH_SUGGESTIONS,
  extractClauses, RISK_RULES, matchRule, computeRiskScore,
  extractAmounts, extractPeriods,
  detectConflicts, detectConflictsInText,
  type RiskRule,
} from "../lib/risk-rules.js"

// ────────────────────────────────────────
// 스키마
// ────────────────────────────────────────

export const AnalyzeDocumentSchema = z.object({
  text: z.string().describe("분석할 계약서/약관 전문 텍스트"),
  maxClauses: z.number().min(1).max(30).default(15).describe("분석할 최대 조항 수 (기본:15)"),
})

export type AnalyzeDocumentInput = z.infer<typeof AnalyzeDocumentSchema>

// ────────────────────────────────────────
// 핸들러
// ────────────────────────────────────────

export async function analyzeDocument(
  _apiClient: unknown,
  input: AnalyzeDocumentInput,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const { text, maxClauses } = input

  if (text.length < 20) {
    return {
      content: [{ type: "text", text: "분석할 텍스트가 너무 짧습니다. 계약서/약관 전문을 입력해주세요." }],
      isError: true,
    }
  }

  // 1. 문서 유형 분류
  const docType = classifyDocument(text)
  const docLabel = DOC_LABELS[docType]

  // 2. 조항 추출
  const clauses = extractClauses(text, maxClauses)

  // 3. 리스크 분석
  interface Finding { clause?: string; rule: RiskRule }
  const findings: Finding[] = []

  if (clauses.length > 0) {
    for (const clause of clauses) {
      for (const rule of RISK_RULES) {
        if (matchRule(rule, clause.body)) {
          findings.push({ clause: clause.label, rule })
        }
      }
    }
  } else {
    for (const rule of RISK_RULES) {
      if (matchRule(rule, text)) {
        findings.push({ rule })
      }
    }
  }

  // 4. 리스크 점수
  const { score, gradeLabel } = computeRiskScore(findings.map(f => f.rule))

  // 5. 금액/기간 추출
  const amounts = extractAmounts(text)
  const periods = extractPeriods(text)

  // 6. 조항 충돌 탐지
  const conflicts = clauses.length >= 2
    ? detectConflicts(clauses)
    : detectConflictsInText(text)

  // 7. 결과 포맷팅
  let out = `=== 문서 리스크 분석 ===\n\n`
  out += `문서 유형: ${docLabel}\n`
  out += `추출 조항: ${clauses.length}개\n`
  out += `발견 리스크: ${findings.length}건\n`
  out += `위험도: ${score}점 (${gradeLabel})\n\n`

  // 핵심 수치
  if (amounts.length > 0 || periods.length > 0) {
    out += `--- 핵심 수치 ---\n`
    for (const a of amounts) out += `  [금액] ${a.label}: ${a.value}\n`
    for (const p of periods) out += `  [기간] ${p.label}: ${p.value}\n`
    out += `\n`
  }

  // 리스크 항목
  if (findings.length === 0) {
    out += `특별한 리스크 패턴이 감지되지 않았습니다.\n`
    out += `다만 법적 효력은 전문가 확인이 필요합니다.\n\n`
  } else {
    const sorted = [...findings].sort((a, b) =>
      a.rule.severity === b.rule.severity ? 0 : a.rule.severity === "high" ? -1 : 1
    )
    for (const f of sorted) {
      const icon = f.rule.severity === "high" ? "[위험]" : "[주의]"
      const loc = f.clause ? ` (${f.clause})` : ""
      out += `${icon} ${f.rule.name}${loc}\n`
      out += `  ${f.rule.description}\n`
      out += `  검색: ${f.rule.searchHints.join(" / ")}\n\n`
    }
  }

  // 조항 충돌
  if (conflicts.length > 0) {
    out += `--- 조항 충돌 탐지 ---\n`
    for (const c of conflicts) {
      const loc = c.clauseA && c.clauseB ? ` (${c.clauseA} vs ${c.clauseB})` : ""
      out += `[충돌] ${c.type}${loc}\n`
      out += `  ${c.description}\n\n`
    }
  }

  // 추천 검색어
  out += `--- 추천 검색어 ---\n`
  for (const s of SEARCH_SUGGESTIONS[docType]) {
    out += `  - ${s}\n`
  }

  // 도구 안내
  out += `\n[안내] 관련 법령을 확인하려면:\n`
  out += `  search_law(query="관련 법령명") / get_law_text()\n`
  out += `  search_precedents(query="관련 키워드") / 판례 검색\n`
  out += `  chain_document_review(text="...") / 리스크+법령+판례 종합 검토\n`

  return {
    content: [{ type: "text", text: truncateResponse(out) }],
  }
}
