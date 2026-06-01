#!/usr/bin/env node

const assert = require("assert")

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

async function testIgnoresRenderedAiLawText() {
  const { buildCompactLegalQueries } = await import("../build/tools/compact-query-planner.js")

  const candidates = buildCompactLegalQueries({
    originalQuery: "중고거래로 옷을 팔았는데 환불해달라고 합니다",
    aiLawText: "   제0017조 (청약철회등)",
    max: 10,
  }).map((candidate) => candidate.query)

  assert.deepStrictEqual(candidates, [])
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
    aiLawArticles: [{
      lawName: "고용정책 기본법",
      articleNo: "0007",
      articleTitle: "취업기회의 균등한 보장",
      articleContent: "사업주는 모집과 채용에서 고용 차별이 발생하지 않도록 하여야 한다.",
      sourceIndex: 0,
    }],
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

async function testUsesRouterCandidatesWithoutRenderedRetryText() {
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

  assert.deepStrictEqual(candidates.slice(0, 2), [
    "청약철회",
    "전자상거래 청약철회",
  ])
  assert.ok(!candidates.includes("중고거래"), candidates.join(", "))
}

async function testPrioritizesCaseNumberAndOriginalQuery() {
  const { buildCompactLegalQueries } = await import("../build/tools/compact-query-planner.js")

  const candidates = buildCompactLegalQueries({
    originalQuery: "프리랜서 근로자성 판례를 찾아줘",
    includeOriginal: true,
    caseNumber: "2024다12345",
    aiLawArticles: [{
      lawName: "근로기준법",
      articleNo: "0002",
      articleTitle: "근로자 정의",
      articleContent: "근로자란 직업의 종류와 관계없이 임금을 목적으로 사업이나 사업장에 근로를 제공하는 사람을 말한다.",
      sourceIndex: 0,
    }],
    max: 10,
  })

  assert.deepStrictEqual(candidates.slice(0, 2).map((candidate) => candidate.query), [
    "2024다12345",
    "프리랜서 근로자성",
  ])
  assert.strictEqual(candidates[0].source, "case_number")
  assert.strictEqual(candidates[1].source, "original_query")
  assert.ok(
    candidates.findIndex((candidate) => candidate.source === "original_query") <
      candidates.findIndex((candidate) => candidate.source === "ai_law_article_title"),
    candidates.map((candidate) => `${candidate.source}:${candidate.query}`).join(", ")
  )
}

async function testBuildsReducedKeywordsFromOriginalQuery() {
  const { buildCompactLegalQueries } = await import("../build/tools/compact-query-planner.js")

  const candidates = buildCompactLegalQueries({
    originalQuery: "중고거래 옷 구매자 단순 변심 환불 의무",
    includeOriginal: true,
    max: 10,
  })
  const queries = candidates.map((candidate) => candidate.query)

  assert.strictEqual(queries[0], "중고거래 옷 구매자 단순 변심 환불 의무")
  assert.ok(!queries.includes("중고거래"), queries.join(", "))
  assert.ok(candidates.some((candidate) => (
    candidate.source === "original_keyword" &&
    candidate.query.split(/\s+/).length >= 2
  )), candidates.map((candidate) => `${candidate.source}:${candidate.query}`).join(", "))
  assert.strictEqual(candidates[1].source, "original_keyword")
}

async function testBuildsAxisCombinedKeywordsForTaxFraudQuery() {
  const { buildCompactLegalQueries } = await import("../build/tools/compact-query-planner.js")

  const candidates = buildCompactLegalQueries({
    originalQuery: "사기 행위에 의해 부과된 양도소득세 취소가 가능한가?",
    includeOriginal: true,
    max: 10,
  })
  const queries = candidates.map((candidate) => candidate.query)

  assert.ok(queries.includes("양도소득세 사기"), queries.join(", "))
  const combinedIndex = queries.indexOf("양도소득세 사기")
  const singleFraudIndex = queries.indexOf("사기")
  assert.ok(
    singleFraudIndex === -1 || combinedIndex < singleFraudIndex,
    candidates.map((candidate) => `${candidate.source}:${candidate.query}:${candidate.score}`).join(", ")
  )

  const combined = candidates[combinedIndex]
  assert.strictEqual(combined.source, "original_keyword")
  assert.deepStrictEqual(combined.validationTermGroups[0], ["양도소득세", "소득세", "조세", "과세"])
  for (const term of ["사기", "사기행위", "부정한 행위", "허위"]) {
    assert.ok(combined.validationTermGroups[1].includes(term), combined.validationTermGroups[1].join(", "))
  }
}

async function testBuildsAxisCombinedKeywordsForToolArgumentQuery() {
  const { buildCompactLegalQueries } = await import("../build/tools/compact-query-planner.js")

  const candidates = buildCompactLegalQueries({
    originalQuery: "사기 행위에 의해 부과된 양도소득세 취소 가능 여부 및 절차",
    includeOriginal: true,
    max: 10,
  })
  const queries = candidates.map((candidate) => candidate.query)

  assert.ok(queries.includes("양도소득세 사기"), queries.join(", "))
  assert.ok(
    queries.some((query) => query.includes("소득세") && query.includes("양도소득세") && query.includes("사기")),
    queries.join(", ")
  )
  assert.ok(!queries.slice(0, 5).includes("사기"), queries.join(", "))
  assert.ok(!queries.includes("양도소득세 가능한"), queries.join(", "))
}

async function testBuildsAxisCombinedKeywordsForConstructionDefectQuery() {
  const { buildCompactLegalQueries } = await import("../build/tools/compact-query-planner.js")

  const candidates = buildCompactLegalQueries({
    originalQuery: "건설공사 준공 후 하자보수와 지체상금 판례 찾아줘",
    includeOriginal: true,
    max: 10,
  })
  const queries = candidates.map((candidate) => candidate.query)

  assert.ok(queries.includes("건설공사 하자보수"), queries.join(", "))
  assert.ok(
    queries.some((query) => query.includes("건설공사") && query.includes("지체상금")),
    queries.join(", ")
  )
  assert.ok(!queries.slice(0, 5).includes("하자"), queries.join(", "))

  const combined = candidates[queries.indexOf("건설공사 하자보수")]
  assert.deepStrictEqual(combined.validationTermGroups[0], ["건설공사", "건설", "공사", "도급", "하도급"])
  for (const term of ["하자보수", "하자", "하자담보책임", "부실시공"]) {
    assert.ok(combined.validationTermGroups[1].includes(term), combined.validationTermGroups[1].join(", "))
  }

  const delayCombined = candidates.find((candidate) => candidate.query === "건설공사 지체상금")
  assert.ok(delayCombined, queries.join(", "))
  assert.ok(delayCombined.validationTermGroups[1].includes("공기지연"), delayCombined.validationTermGroups[1].join(", "))
}

async function testBuildsAxisCombinedKeywordsForConstructionDelayQuery() {
  const { buildCompactLegalQueries } = await import("../build/tools/compact-query-planner.js")

  const candidates = buildCompactLegalQueries({
    originalQuery: "건설공사 공기지연으로 인한 지체상금 판례",
    includeOriginal: true,
    max: 10,
  })
  const queries = candidates.map((candidate) => candidate.query)

  assert.ok(queries.includes("건설공사 공기지연"), queries.join(", "))
  const combined = candidates[queries.indexOf("건설공사 공기지연")]
  for (const term of ["공기지연", "지체상금", "지연손해금", "공사지연", "공기연장"]) {
    assert.ok(combined.validationTermGroups[1].includes(term), combined.validationTermGroups[1].join(", "))
  }
}

async function testBuildsAxisCombinedKeywordsForConstructionPaymentQuery() {
  const { buildCompactLegalQueries } = await import("../build/tools/compact-query-planner.js")

  const candidates = buildCompactLegalQueries({
    originalQuery: "하도급 공사비 미지급 원청 책임 판례",
    includeOriginal: true,
    max: 10,
  })
  const queries = candidates.map((candidate) => candidate.query)

  assert.ok(queries.includes("하도급 공사비"), queries.join(", "))
  assert.ok(!queries.includes("하도급 도급"), queries.join(", "))
  const combined = candidates[queries.indexOf("하도급 공사비")]
  assert.ok(combined.validationTermGroups[0].includes("하도급"), combined.validationTermGroups[0].join(", "))
  for (const term of ["공사비", "공사대금", "기성금", "추가공사비"]) {
    assert.ok(combined.validationTermGroups[1].includes(term), combined.validationTermGroups[1].join(", "))
  }
}

async function testDoesNotBuildReducedKeywordsForLongNarrative() {
  const { buildCompactLegalQueries } = await import("../build/tools/compact-query-planner.js")

  const candidates = buildCompactLegalQueries({
    originalQuery: "공원에서 풍경 사진을 찍어서 SNS에 올리려고 하는데 사진 구석에 모르는 사람 얼굴이 작게 찍혀 있었다면 허락이 필요한가요",
    includeOriginal: true,
    max: 10,
  }).map((candidate) => candidate.query)

  assert.ok(!candidates.includes("공원"), candidates.join(", "))
  assert.ok(!candidates.includes("공원 풍경"), candidates.join(", "))
}

async function testPrioritizesDocumentHintsAboveAiLawTitles() {
  const { buildCompactLegalQueries } = await import("../build/tools/compact-query-planner.js")

  const candidates = buildCompactLegalQueries({
    originalQuery: "계약서 조항 검토",
    includeOriginal: true,
    documentHints: ["임대차 보증금 반환 판례"],
    aiLawArticles: [{
      lawName: "주택임대차보호법",
      articleNo: "0003",
      articleTitle: "대항력 등",
      articleContent: "임차인은 주택의 인도와 주민등록을 마친 때에는 그 다음 날부터 제삼자에 대하여 효력이 생긴다.",
      sourceIndex: 0,
    }],
    max: 10,
  })

  assert.deepStrictEqual(candidates.slice(0, 2).map((candidate) => candidate.query), [
    "계약서 조항 검토",
    "임대차 보증금 반환 판례",
  ])
  assert.ok(
    candidates.findIndex((candidate) => candidate.source === "document_hint") <
      candidates.findIndex((candidate) => candidate.source === "ai_law_article_title"),
    candidates.map((candidate) => `${candidate.source}:${candidate.query}`).join(", ")
  )
}

async function testDetectsCaseNumberFromOriginalQuery() {
  const { buildCompactLegalQueries } = await import("../build/tools/compact-query-planner.js")

  const candidates = buildCompactLegalQueries({
    originalQuery: "대법원 2023다123456 판결 찾아줘",
    max: 5,
  })

  assert.strictEqual(candidates[0].query, "2023다123456")
  assert.strictEqual(candidates[0].source, "case_number")
  assert.strictEqual(candidates.filter((candidate) => candidate.query === "2023다123456").length, 1)
}

async function testKeepsBareCaseNumberCandidate() {
  const { buildCompactLegalQueries } = await import("../build/tools/compact-query-planner.js")

  const candidates = buildCompactLegalQueries({
    originalQuery: "2023다123456",
    includeOriginal: true,
    max: 5,
  })

  assert.strictEqual(candidates[0].query, "2023다123456")
  assert.strictEqual(candidates[0].source, "case_number")
}

async function testDoesNotClassifyKoreanDateAsCaseNumber() {
  const { buildCompactLegalQueries } = await import("../build/tools/compact-query-planner.js")

  const candidates = buildCompactLegalQueries({
    originalQuery: "2024년 5월 양도소득세 처분 취소",
    includeOriginal: true,
    max: 5,
  })

  assert.ok(
    !candidates.some((candidate) => candidate.source === "case_number"),
    candidates.map((candidate) => `${candidate.source}:${candidate.query}`).join(", ")
  )
}

async function testDoesNotMakeEveryTerminalDeungBodySearch() {
  const { buildCompactLegalQueries } = await import("../build/tools/compact-query-planner.js")

  const candidates = buildCompactLegalQueries({
    originalQuery: "성평등 판례 찾아줘",
    aiLawArticles: [{
      lawName: "양성평등기본법",
      articleNo: "0003",
      articleTitle: "성평등",
      articleContent: "성평등은 모든 영역에서 평등한 책임과 권리를 공유하는 것을 말한다.",
      sourceIndex: 0,
    }],
    max: 10,
  })

  const equality = candidates.find((candidate) => candidate.query === "성평등")
  assert.ok(equality, candidates.map((candidate) => candidate.query).join(", "))
  assert.strictEqual(equality.search, 1)
  assert.ok(
    !candidates.some((candidate) => candidate.query === "성평 등" && candidate.search === 2),
    candidates.map((candidate) => `${candidate.query}:${candidate.search}`).join(", ")
  )
}

async function testKeepsSpacedTerminalDeungBodySearchForAiLawTitle() {
  const { buildCompactLegalQueries } = await import("../build/tools/compact-query-planner.js")

  const candidates = buildCompactLegalQueries({
    originalQuery: "중고거래 환불",
    aiLawArticles: [{
      lawName: "콘텐츠산업 진흥법",
      articleNo: "0027",
      articleTitle: "청약철회 등",
      articleContent: "청약철회 등 계약 해제 관련 표시를 하여야 한다.",
      sourceIndex: 0,
    }],
    max: 10,
  })

  assert.ok(
    candidates.some((candidate) => candidate.query === "청약철회 등" && candidate.search === 2),
    candidates.map((candidate) => `${candidate.query}:${candidate.search}`).join(", ")
  )
}

async function testOriginalQueryDoesNotUseRenderedFailureSuggestions() {
  const { buildCompactLegalQueries } = await import("../build/tools/compact-query-planner.js")

  const candidates = buildCompactLegalQueries({
    originalQuery: "근로자성 판례 찾아줘",
    includeOriginal: true,
    failedSearchText: '재시도 제안: "근로자" 또는 "사용종속관계"',
    max: 10,
  }).map((candidate) => candidate.query)

  assert.deepStrictEqual(candidates, [
    "근로자성",
  ])
}

async function testDoesNotMineCandidatesFromRenderedFailureText() {
  const { buildCompactLegalQueries } = await import("../build/tools/compact-query-planner.js")

  const longCandidate = "가".repeat(41)
  const candidates = buildCompactLegalQueries({
    originalQuery: "원문 그대로",
    failedSearchText: `재시도 제안: "원문 그대로" 또는 "공원에서" 또는 "관한 계약" 또는 "${longCandidate}" 또는 "청약철회"`,
    max: 10,
  }).map((candidate) => candidate.query)

  assert.deepStrictEqual(candidates, [])
}

async function main() {
  await testIgnoresRenderedAiLawText()
  await testUsesRawAiLawArticleSignalsBeforeFormattedText()
  await testDoesNotDestructivelyStripEqualityTitle()
  await testDoesNotExtractBodySuffixKeywords()
  await testDoesNotCreateCandidatesFromArticleContentReferences()
  await testUsesRouterCandidatesWithoutRenderedRetryText()
  await testPrioritizesCaseNumberAndOriginalQuery()
  await testBuildsReducedKeywordsFromOriginalQuery()
  await testBuildsAxisCombinedKeywordsForTaxFraudQuery()
  await testBuildsAxisCombinedKeywordsForToolArgumentQuery()
  await testBuildsAxisCombinedKeywordsForConstructionDefectQuery()
  await testBuildsAxisCombinedKeywordsForConstructionDelayQuery()
  await testBuildsAxisCombinedKeywordsForConstructionPaymentQuery()
  await testDoesNotBuildReducedKeywordsForLongNarrative()
  await testPrioritizesDocumentHintsAboveAiLawTitles()
  await testDetectsCaseNumberFromOriginalQuery()
  await testKeepsBareCaseNumberCandidate()
  await testDoesNotClassifyKoreanDateAsCaseNumber()
  await testDoesNotMakeEveryTerminalDeungBodySearch()
  await testKeepsSpacedTerminalDeungBodySearchForAiLawTitle()
  await testOriginalQueryDoesNotUseRenderedFailureSuggestions()
  await testDoesNotMineCandidatesFromRenderedFailureText()
  console.log("compact query planner tests passed")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
