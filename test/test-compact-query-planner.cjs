#!/usr/bin/env node

const assert = require("assert")

const AI_LAW_TEXT = [
  "지능형 법령검색 결과 (법령조문, 2건):",
  "",
  "전자상거래 등에서의 소비자보호에 관한 법률",
  "   제0017조 (청약철회등)",
  "   소비자는 통신판매업자와 재화등의 구매에 관한 계약을 체결한 경우 청약철회등을 할 수 있다.",
  "   시행: 2026.01.20 | 공정거래위원회",
  "",
  "고용정책 기본법",
  "   제0007조 (취업기회의 균등한 보장)",
  "   사업주는 모집과 채용에서 고용 차별이 발생하지 않도록 하여야 한다.",
  "   시행: 2026.01.01 | 고용노동부",
].join("\n")

async function testUsesStructuredAiLawSignals() {
  const { buildCompactLegalQueries } = await import("../build/tools/compact-query-planner.js")

  const candidates = buildCompactLegalQueries({
    originalQuery: "중고거래로 옷을 팔았는데 환불해달라고 합니다",
    aiLawText: AI_LAW_TEXT,
    max: 10,
  }).map((candidate) => candidate.query)

  assert.ok(candidates.includes("청약철회"), candidates.join(", "))
  assert.ok(candidates.includes("전자상거래 등에서의 소비자보호에 관한 법률 청약철회"), candidates.join(", "))
  assert.ok(candidates.includes("취업기회의 균등한 보장"), candidates.join(", "))
  assert.ok(candidates.includes("고용정책 기본법 취업기회의 균등한 보장"), candidates.join(", "))
}

async function testDoesNotExtractBodySuffixKeywords() {
  const { buildCompactLegalQueries } = await import("../build/tools/compact-query-planner.js")

  const candidates = buildCompactLegalQueries({
    originalQuery: "채용 과정에서 불합리한 대우를 받았습니다",
    aiLawText: AI_LAW_TEXT,
    max: 10,
  }).map((candidate) => candidate.query)

  assert.ok(!candidates.includes("고용 차별"), candidates.join(", "))
}

async function testUsesRetrySuggestionsAndRouterCandidates() {
  const { buildCompactLegalQueries } = await import("../build/tools/compact-query-planner.js")

  const candidates = buildCompactLegalQueries({
    originalQuery: "청약철회 판례를 찾아줘",
    route: {
      params: { query: "청약철회" },
      pipeline: [{ params: { query: "전자상거래 청약철회" } }],
    },
    failedSearchText: '재시도 제안: "중고거래" 또는 "중고거래 옷"',
    max: 10,
  }).map((candidate) => candidate.query)

  assert.deepStrictEqual(candidates.slice(0, 4), [
    "중고거래",
    "중고거래 옷",
    "청약철회",
    "전자상거래 청약철회",
  ])
}

async function testFiltersWeakCandidates() {
  const { buildCompactLegalQueries } = await import("../build/tools/compact-query-planner.js")

  const longCandidate = "가".repeat(41)
  const candidates = buildCompactLegalQueries({
    originalQuery: "원문 그대로",
    failedSearchText: `재시도 제안: "원문 그대로" 또는 "공원에서" 또는 "관한 계약" 또는 "${longCandidate}" 또는 "청약철회"`,
    max: 10,
  }).map((candidate) => candidate.query)

  assert.deepStrictEqual(candidates, ["청약철회"])
}

async function main() {
  await testUsesStructuredAiLawSignals()
  await testDoesNotExtractBodySuffixKeywords()
  await testUsesRetrySuggestionsAndRouterCandidates()
  await testFiltersWeakCandidates()
  console.log("compact query planner tests passed")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
