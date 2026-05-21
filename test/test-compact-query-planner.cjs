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

const AI_LAW_ARTICLES = [
  {
    lawName: "콘텐츠산업 진흥법",
    articleNo: "0002",
    articleTitle: "정의",
    articleContent: "이 법에서 사용하는 용어의 뜻은 다음과 같다.",
    sourceIndex: 0,
  },
  {
    lawName: "전자상거래 등에서의 소비자보호에 관한 법률",
    articleNo: "0017",
    articleTitle: "청약철회등",
    articleContent: "제17조(청약철회등) 소비자는 통신판매업자와 재화등의 구매에 관한 계약을 체결한 경우 청약철회등을 할 수 있다.",
    sourceIndex: 1,
  },
]

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

async function testUsesRawAiLawArticleSignalsBeforeFormattedText() {
  const { buildCompactLegalQueries } = await import("../build/tools/compact-query-planner.js")

  const candidates = buildCompactLegalQueries({
    originalQuery: "중고거래로 옷을 팔았는데 환불해달라고 합니다",
    aiLawArticles: AI_LAW_ARTICLES,
    max: 10,
  })
  const queries = candidates.map((candidate) => candidate.query)

  assert.ok(queries.includes("청약철회등"), queries.join(", "))
  assert.ok(queries.includes("청약철회"), queries.join(", "))
  assert.ok(queries.includes("청약철회 등"), queries.join(", "))
  assert.ok(queries.includes("전자상거래 등에서의 소비자보호에 관한 법률 청약철회"), queries.join(", "))
  assert.ok(!queries.includes("정의"), queries.join(", "))

  const rawTitle = candidates.find((candidate) => candidate.query === "청약철회등")
  const titleSearch = candidates.find((candidate) => candidate.query === "청약철회")
  const bodySearch = candidates.find((candidate) => candidate.query === "청약철회 등")

  assert.strictEqual(rawTitle.semanticAnchor, "청약철회등")
  assert.strictEqual(rawTitle.variantKind, "raw")
  assert.strictEqual(titleSearch.search, 1)
  assert.strictEqual(titleSearch.variantKind, "terminal_function_word_removed")
  assert.strictEqual(titleSearch.requiresResultValidation, true)
  assert.strictEqual(bodySearch.search, 2)
  assert.strictEqual(bodySearch.variantKind, "terminal_function_word_spaced")
  assert.strictEqual(bodySearch.requiresResultValidation, true)
}

async function testDoesNotDestructivelyStripEqualityTitle() {
  const { buildCompactLegalQueries } = await import("../build/tools/compact-query-planner.js")

  const candidates = buildCompactLegalQueries({
    originalQuery: "직장에서 성평등 침해를 받았습니다",
    aiLawArticles: [{
      lawName: "양성평등기본법",
      articleNo: "0003",
      articleTitle: "성평등",
      articleContent: "성평등은 정치ㆍ경제ㆍ사회ㆍ문화의 모든 영역에서 평등한 책임과 권리를 공유하는 것을 말한다.",
      sourceIndex: 0,
    }],
    max: 10,
  }).map((candidate) => candidate.query)

  assert.ok(candidates.includes("성평등"), candidates.join(", "))
  assert.ok(!candidates.includes("성평"), candidates.join(", "))
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

async function testDoesNotCreateCandidatesFromArticleContentReferences() {
  const { buildCompactLegalQueries } = await import("../build/tools/compact-query-planner.js")

  const candidates = buildCompactLegalQueries({
    originalQuery: "소비자가 환불을 요구합니다",
    aiLawArticles: [{
      lawName: "콘텐츠산업 진흥법",
      articleNo: "0027",
      articleTitle: "표시의무",
      articleContent: "콘텐츠제작자는 「전자상거래 등에서의 소비자보호에 관한 법률」 제17조(청약철회등)에 따라 표시하여야 한다.",
      sourceIndex: 0,
    }],
    max: 10,
  }).map((candidate) => candidate.query)

  assert.ok(candidates.includes("표시의무"), candidates.join(", "))
  assert.ok(!candidates.includes("청약철회"), candidates.join(", "))
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
  await testUsesRawAiLawArticleSignalsBeforeFormattedText()
  await testDoesNotDestructivelyStripEqualityTitle()
  await testDoesNotExtractBodySuffixKeywords()
  await testDoesNotCreateCandidatesFromArticleContentReferences()
  await testUsesRetrySuggestionsAndRouterCandidates()
  await testFiltersWeakCandidates()
  console.log("compact query planner tests passed")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
