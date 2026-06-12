#!/usr/bin/env node

/**
 * legal_research/legal_analysis 통합 진입점 디스패치 회귀 테스트 (v4.4.1)
 *
 * 네트워크 없이 검증 가능한 계층만 다룬다:
 * 1. 광고 스키마 계약 — io:"input" 직렬화 (default 필드가 required로 새는 버그 회귀 방지)
 *    + apiKey 숨김
 * 2. task↔scenario 호환 — 체인 스키마 파생(pickScenario) 수용/폐기 매트릭스
 * 3. 필수 파라미터 가드 — apiClient 접근 전에 inputError로 반환되는지
 * 4. withNote — 경고 노트가 응답 첫 줄에 주입되는지
 */

const assert = require("assert")
const { pathToFileURL } = require("url")
const path = require("path")

const load = (rel) => import(pathToFileURL(path.resolve(__dirname, rel)).href)

async function main() {
  const registry = await load("../build/tool-registry.js")
  const research = await load("../build/tools/legal-research.js")
  const analysis = await load("../build/tools/legal-analysis.js")
  const chains = await load("../build/tools/chains.js")

  const { allTools, toMcpInputSchema, TOOL_COUNTS } = registry
  const { legalResearch, LegalResearchSchema, pickScenario, withNote } = research
  const { legalAnalysis, LegalAnalysisSchema } = analysis

  // ── 1. 광고 스키마 계약 ──────────────────────────────────────────
  const advertised = (name) => {
    const tool = allTools.find((t) => t.name === name)
    assert.ok(tool, `${name} 도구가 allTools에 없음`)
    return toMcpInputSchema(tool.schema)
  }

  // .default() 필드(task, display)는 required가 아니어야 함 (io:"input" 회귀 방지)
  assert.deepStrictEqual(advertised("legal_research").required, [],
    "legal_research: 모든 필드 optional (task는 default 보유)")
  assert.deepStrictEqual(advertised("legal_analysis").required, ["mode"],
    "legal_analysis: mode만 required")
  assert.deepStrictEqual(advertised("search_law").required, ["query"],
    "search_law: display(default 보유)는 required가 아니어야 함")

  // apiKey는 광고 스키마에서 숨김 (정식 경로는 HTTP 헤더)
  for (const name of ["legal_research", "legal_analysis", "search_law", "get_law_text"]) {
    const s = advertised(name)
    assert.ok(!("apiKey" in (s.properties || {})), `${name}: apiKey가 광고 스키마에 노출됨`)
    assert.ok(!(s.required || []).includes("apiKey"), `${name}: apiKey가 required에 노출됨`)
  }
  console.log("✓ 광고 스키마 계약 (io:input required + apiKey 숨김)")

  // ── 2. task↔scenario 호환 매트릭스 (체인 스키마 파생) ──────────────
  const MATRIX = [
    [chains.chainLawSystemSchema, "law_system", ["delegation", "impact"]],
    [chains.chainActionBasisSchema, "action_basis", ["penalty"]],
    [chains.chainAmendmentTrackSchema, "amendment_track", ["timeline", "time_travel"]],
    [chains.chainOrdinanceCompareSchema, "ordinance_compare", ["compliance"]],
    [chains.chainFullResearchSchema, "full_research", ["customs", "action_plan"]],
    [chains.chainProcedureDetailSchema, "procedure_detail", ["manual"]],
  ]
  const ALL_SCENARIOS = [
    "delegation", "impact", "penalty", "timeline", "time_travel",
    "compliance", "customs", "action_plan", "manual",
  ]
  for (const [schema, task, allowed] of MATRIX) {
    const field = schema.shape.scenario
    assert.ok(field, `${task}: 체인 스키마에 scenario 필드 없음`)
    for (const sc of ALL_SCENARIOS) {
      const { value, note } = pickScenario(field, sc, task)
      if (allowed.includes(sc)) {
        assert.strictEqual(value, sc, `${task}+${sc}: 호환 시나리오는 통과해야 함`)
        assert.strictEqual(note, undefined, `${task}+${sc}: 호환인데 경고 노트 발생`)
      } else {
        assert.strictEqual(value, undefined, `${task}+${sc}: 비호환 시나리오는 폐기돼야 함`)
        assert.ok(note && note.includes(sc) && note.includes(task),
          `${task}+${sc}: 폐기 시 task/scenario 명시 경고 필요`)
      }
    }
    // 미지정은 그대로 통과 (자동 감지 경로)
    const empty = pickScenario(field, undefined, task)
    assert.strictEqual(empty.value, undefined)
    assert.strictEqual(empty.note, undefined)
  }
  console.log("✓ task↔scenario 호환 매트릭스 (6 task × 9 scenario + 미지정)")

  // ── 3. 필수 파라미터 가드 (apiClient 도달 전 차단 → null 전달로 검증) ──
  const expectError = async (fn, input, parse, fragment) => {
    const res = await fn(null, parse.parse(input))
    assert.strictEqual(res.isError, true, `${JSON.stringify(input)} → isError여야 함`)
    assert.ok(res.content[0].text.includes(fragment),
      `에러 메시지에 '${fragment}' 누락: ${res.content[0].text}`)
  }

  // legal_research: task별 query/text 가드 (task 기본값 full_research 포함)
  await expectError(legalResearch, {}, LegalResearchSchema, "query가 필요")
  await expectError(legalResearch, { task: "law_system" }, LegalResearchSchema, "query가 필요")
  await expectError(legalResearch, { task: "document_review" }, LegalResearchSchema, "text(문서 전문)가 필요")

  // legal_analysis: mode별 필수 조합 가드
  await expectError(legalAnalysis, { mode: "verify_citations" }, LegalAnalysisSchema, "text가 필요")
  await expectError(legalAnalysis, { mode: "cite_check" }, LegalAnalysisSchema, "caseNumber가 필요")
  await expectError(legalAnalysis, { mode: "applicable_law", lawName: "민법" }, LegalAnalysisSchema, "lawName과 date가 필요")
  await expectError(legalAnalysis, { mode: "applicable_law", date: "2023-05-10" }, LegalAnalysisSchema, "lawName과 date가 필요")
  await expectError(legalAnalysis, { mode: "impact_map", lawName: "민법" }, LegalAnalysisSchema, "lawName과 jo가 필요")
  console.log("✓ 필수 파라미터 가드 (apiClient 미접근)")

  // ── 4. withNote 주입 ───────────────────────────────────────────
  const base = { content: [{ type: "text", text: "본문" }] }
  const noted = withNote("⚠ 경고", base)
  assert.strictEqual(noted.content.length, 2)
  assert.strictEqual(noted.content[0].text, "⚠ 경고", "경고는 첫 줄이어야 함")
  assert.strictEqual(noted.content[1].text, "본문")
  assert.strictEqual(base.content.length, 1, "원본 응답 변형 금지")
  assert.strictEqual(withNote(undefined, base), base, "노트 없으면 원본 그대로")
  console.log("✓ withNote 경고 첫 줄 주입")

  // ── 5. 노출 수 파생값 ──────────────────────────────────────────
  assert.strictEqual(TOOL_COUNTS.exposed, 9, "노출 도구는 9개")
  assert.ok(TOOL_COUNTS.total > 90, "전체 도구 수 파생 확인")
  console.log(`✓ TOOL_COUNTS (exposed=${TOOL_COUNTS.exposed}, total=${TOOL_COUNTS.total})`)

  console.log("\nPASS: test-legal-research-analysis-dispatch")
}

main().catch((e) => {
  console.error("FAIL:", e.message)
  process.exit(1)
})
