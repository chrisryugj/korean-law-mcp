#!/usr/bin/env node

const assert = require("assert")

function precedentXml(items) {
  const rows = items.map((item) => [
    "<prec>",
    `<판례일련번호>${item.id}</판례일련번호>`,
    `<사건명>${item.title}</사건명>`,
    `<사건번호>${item.caseNumber || "2024다12345"}</사건번호>`,
    `<법원명>${item.court || "대법원"}</법원명>`,
    `<선고일자>${item.date || "20240101"}</선고일자>`,
    `<판결유형>${item.type || "판결"}</판결유형>`,
    `<판례상세링크>${item.link || `https://example.test/${item.id}`}</판례상세링크>`,
    "</prec>",
  ].join("")).join("")
  return `<PrecSearch><totalCnt>${items.length}</totalCnt><page>1</page>${rows}</PrecSearch>`
}

function noPrecedentXml() {
  return "<PrecSearch><totalCnt>0</totalCnt><page>1</page></PrecSearch>"
}

function makeApiClient(resolver) {
  const requests = []
  return {
    requests,
    async fetchApi(request) {
      requests.push(request)
      return resolver(request)
    },
  }
}

async function testReturnsStructuredOriginalQueryResult() {
  const { searchPrecedentsStructured } = await import("../build/tools/precedent-search-core.js")
  const apiClient = makeApiClient(() => precedentXml([{ id: "100", title: "근로자성 사건" }]))

  const result = await searchPrecedentsStructured(apiClient, {
    query: "프리랜서 근로자성",
    display: 5,
    page: 1,
    apiKey: "test",
  })

  assert.strictEqual(result.hits.length, 1)
  assert.strictEqual(result.hits[0].id, "100")
  assert.strictEqual(result.hits[0].title, "근로자성 사건")
  assert.strictEqual(result.hits[0].sourceQuery, "프리랜서 근로자성")
  assert.strictEqual(result.hits[0].searchMode, 1)
  assert.strictEqual(result.attempts.length, 1)
  assert.strictEqual(result.attempts[0].reason, "original_query")
  assert.strictEqual(apiClient.requests[0].extraParams.query, "프리랜서 근로자성")
  assert.strictEqual(apiClient.requests[0].extraParams.display, "5")
}

async function testFallsBackToBodySearchForConceptQuery() {
  const { searchPrecedentsStructured } = await import("../build/tools/precedent-search-core.js")
  const apiClient = makeApiClient((request) => {
    if (request.extraParams.search === "2") {
      return precedentXml([{ id: "200", title: "본문 근로자성 사건" }])
    }
    return noPrecedentXml()
  })

  const result = await searchPrecedentsStructured(apiClient, {
    query: "근로자성",
    display: 3,
    page: 1,
    apiKey: "test",
  })

  assert.strictEqual(result.fallbackUsed, true)
  assert.strictEqual(result.hits[0].id, "200")
  assert.deepStrictEqual(result.attempts.map((attempt) => `${attempt.reason}:${attempt.search}`), [
    "original_query:1",
    "body_search:2",
  ])
}

async function testUsesExplicitCaseNumberBeforeQueryFallback() {
  const { searchPrecedentsStructured } = await import("../build/tools/precedent-search-core.js")
  const apiClient = makeApiClient((request) => {
    if (request.extraParams.nb === "2024다12345") {
      return precedentXml([{ id: "300", title: "사건번호 사건", caseNumber: "2024다12345" }])
    }
    return noPrecedentXml()
  })

  const result = await searchPrecedentsStructured(apiClient, {
    query: "근로자성 판례",
    caseNumber: "2024다12345",
    display: 5,
    page: 1,
    apiKey: "test",
  })

  assert.strictEqual(result.hits[0].id, "300")
  assert.strictEqual(result.attempts[0].reason, "case_number")
  assert.strictEqual(apiClient.requests[0].extraParams.nb, "2024다12345")
  assert.strictEqual(apiClient.requests[0].extraParams.query, undefined)
}

async function testMarksDateRelaxedResultsOutOfRequestedRange() {
  const { searchPrecedentsStructured } = await import("../build/tools/precedent-search-core.js")
  const apiClient = makeApiClient(() => precedentXml([
    { id: "400", title: "과거 판례", date: "20190101" },
  ]))

  const result = await searchPrecedentsStructured(apiClient, {
    query: "보증금 반환",
    fromDate: "20240101",
    toDate: "20241231",
    display: 5,
    page: 1,
    apiKey: "test",
  })

  assert.strictEqual(result.hits.length, 1)
  assert.strictEqual(result.hits[0].outOfRequestedDateRange, true)
  assert.strictEqual(result.successfulAttempt.outOfRequestedDateRange, true)
  assert.strictEqual(result.fallbackUsed, true)
  assert.ok(result.attempts.some((attempt) => attempt.reason === "date_relaxed"))
}

async function testDateFilteredTotalCountMatchesRenderedHits() {
  const { searchPrecedentsStructured } = await import("../build/tools/precedent-search-core.js")
  const apiClient = makeApiClient(() => precedentXml([
    { id: "410", title: "범위 내 판례", date: "20240101" },
    { id: "411", title: "범위 밖 판례", date: "20190101" },
  ]))

  const result = await searchPrecedentsStructured(apiClient, {
    query: "보증금 반환",
    fromDate: "20240101",
    toDate: "20241231",
    display: 5,
    page: 1,
    apiKey: "test",
  })

  assert.strictEqual(result.hits.length, 1)
  assert.strictEqual(result.totalCount, 1)
  assert.strictEqual(result.hits[0].id, "410")
}

async function testReturnsAttemptsForNoResult() {
  const { searchPrecedentsStructured } = await import("../build/tools/precedent-search-core.js")
  const apiClient = makeApiClient(() => noPrecedentXml())

  const result = await searchPrecedentsStructured(apiClient, {
    query: "없는 판례",
    display: 5,
    page: 1,
    apiKey: "test",
  })

  assert.strictEqual(result.hits.length, 0)
  assert.strictEqual(result.totalCount, 0)
  assert.ok(result.attempts.length >= 1)
  assert.ok(result.attempts.every((attempt) => attempt.success === false))
}

async function testPropagatesApiFailureWithoutFallback() {
  const { searchPrecedentsStructured } = await import("../build/tools/precedent-search-core.js")
  const apiClient = makeApiClient(() => {
    throw new Error("invalid api key")
  })

  await assert.rejects(
    () => searchPrecedentsStructured(apiClient, {
      query: "근로자성",
      display: 5,
      page: 1,
      apiKey: "test",
    }),
    /invalid api key/
  )
  assert.strictEqual(apiClient.requests.length, 1)
}

async function testCanDisableFallbackForExactReferenceSearch() {
  const { searchPrecedentsStructured } = await import("../build/tools/precedent-search-core.js")
  const apiClient = makeApiClient((request) => {
    if (request.extraParams.query === "양도소득세 사기") {
      return precedentXml([{ id: "900", title: "fallback result" }])
    }
    return noPrecedentXml()
  })

  const result = await searchPrecedentsStructured(apiClient, {
    query: "소득세법 제101조",
    display: 5,
    page: 1,
    apiKey: "test",
  }, {
    fallbackPolicy: "none",
  })

  assert.strictEqual(result.hits.length, 0)
  assert.deepStrictEqual(apiClient.requests.map((request) => request.extraParams.query), ["소득세법 제101조"])
}

async function main() {
  await testReturnsStructuredOriginalQueryResult()
  await testFallsBackToBodySearchForConceptQuery()
  await testUsesExplicitCaseNumberBeforeQueryFallback()
  await testMarksDateRelaxedResultsOutOfRequestedRange()
  await testDateFilteredTotalCountMatchesRenderedHits()
  await testReturnsAttemptsForNoResult()
  await testPropagatesApiFailureWithoutFallback()
  await testCanDisableFallbackForExactReferenceSearch()
  console.log("precedent search core tests passed")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
