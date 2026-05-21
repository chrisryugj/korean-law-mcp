#!/usr/bin/env node

const assert = require("assert")

function precedentSearchText() {
  return [
    "판례 검색 결과 (총 3건, 1페이지):",
    "",
    "[111] 첫 번째 판례",
    "  사건번호: 2024다111",
    "",
    "[222] 두 번째 판례",
    "  사건번호: 2024다222",
    "",
    "[333] 세 번째 판례",
    "  사건번호: 2024다333",
    "",
  ].join("\n")
}

function interpretationSearchText() {
  return [
    "해석례 검색 결과 (총 2건, 1페이지):",
    "",
    "[900] 첫 번째 해석례",
    "  해석례번호: 24-001",
    "",
    "[901] 두 번째 해석례",
    "  해석례번호: 24-002",
    "",
  ].join("\n")
}

function makeApiClient() {
  const requests = []
  return {
    requests,
    async fetchApi(request) {
      requests.push(request)
      const id = request.extraParams?.ID
      if (request.endpoint !== "lawService.do") {
        throw new Error(`unexpected endpoint: ${request.endpoint}`)
      }
      if (request.target === "prec") {
        return JSON.stringify({
          PrecService: {
            사건명: `상세 판례 ${id}`,
            사건번호: `2024다${id}`,
            법원명: "대법원",
            선고일자: "20240101",
            판결유형: "판결",
            판시사항: `판시사항 ${id}`,
            판결요지: `판결요지 ${id}`,
            참조조문: "민법 제580조",
            판례내용: `전문 ${id}`,
          },
        })
      }
      if (request.target === "expc") {
        return JSON.stringify({
          ExpcService: {
            안건명: `상세 해석례 ${id}`,
            법령해석례일련번호: id,
            해석일자: "20240101",
            질의기관명: "질의기관",
            해석기관명: "법제처",
            질의요지: `질의요지 ${id}`,
            회답: `회답 ${id}`,
            이유: `이유 ${id}`,
          },
        })
      }
      throw new Error(`unexpected target: ${request.target}`)
    },
  }
}

async function testExtractsMultipleIds() {
  const { extractDetailIds } = await import("../build/tools/search-detail-chain.js")

  assert.deepStrictEqual(
    extractDetailIds("search_precedents", precedentSearchText(), 2),
    ["111", "222"]
  )
  assert.deepStrictEqual(
    extractDetailIds("search_interpretations", interpretationSearchText(), 1),
    ["900"]
  )
}

async function testFetchesTopTwoPrecedentDetails() {
  const { fetchSearchDetailChain } = await import("../build/tools/search-detail-chain.js")
  const apiClient = makeApiClient()

  const result = await fetchSearchDetailChain(
    apiClient,
    "search_precedents",
    { text: precedentSearchText(), isError: false },
    { apiKey: "test" }
  )

  assert.ok(result, "expected detail chain result")
  assert.strictEqual(result.isError, false)
  assert.deepStrictEqual(
    apiClient.requests.map((request) => request.extraParams.ID),
    ["111", "222"]
  )
  assert.ok(result.text.includes("자동 상세조회: search_precedents -> get_precedent_text (상위 2건, full=false)"), result.text)
  assert.ok(result.text.includes("상세 판례 111"), result.text)
  assert.ok(result.text.includes("상세 판례 222"), result.text)
  assert.ok(!result.text.includes("상세 판례 333"), result.text)
}

async function testFetchesTopOneNonPrecedentDetail() {
  const { fetchSearchDetailChain } = await import("../build/tools/search-detail-chain.js")
  const apiClient = makeApiClient()

  const result = await fetchSearchDetailChain(
    apiClient,
    "search_interpretations",
    { text: interpretationSearchText(), isError: false },
    { apiKey: "test" }
  )

  assert.ok(result, "expected interpretation detail result")
  assert.deepStrictEqual(
    apiClient.requests.map((request) => request.extraParams.ID),
    ["900"]
  )
  assert.ok(result.text.includes("자동 상세조회: search_interpretations -> get_interpretation_text (상위 1건)"), result.text)
  assert.ok(result.text.includes("상세 해석례 900"), result.text)
  assert.ok(!result.text.includes("상세 해석례 901"), result.text)
}

async function testCombinedResultsUseTopTwoTotal() {
  const { fetchCombinedSearchDetailChain } = await import("../build/tools/search-detail-chain.js")
  const apiClient = makeApiClient()

  const result = await fetchCombinedSearchDetailChain(
    apiClient,
    "search_precedents",
    [
      { text: "[111] 첫 번째 판례\n[222] 두 번째 판례", isError: false },
      { text: "[333] 세 번째 판례", isError: false },
    ],
    { apiKey: "test" }
  )

  assert.ok(result, "expected combined precedent detail result")
  assert.deepStrictEqual(
    apiClient.requests.map((request) => request.extraParams.ID),
    ["111", "222"]
  )
  assert.ok(result.text.includes("상세 판례 111"), result.text)
  assert.ok(result.text.includes("상세 판례 222"), result.text)
  assert.ok(!result.text.includes("상세 판례 333"), result.text)
}

async function main() {
  await testExtractsMultipleIds()
  await testFetchesTopTwoPrecedentDetails()
  await testFetchesTopOneNonPrecedentDetail()
  await testCombinedResultsUseTopTwoTotal()
  console.log("search detail chain tests passed")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
