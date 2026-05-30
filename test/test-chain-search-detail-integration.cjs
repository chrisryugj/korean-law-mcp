#!/usr/bin/env node

const assert = require("assert")

function noLawXml() {
  return "<LawSearch><totalCnt>0</totalCnt><page>1</page></LawSearch>"
}

function noAiLawXml() {
  return "<aiSearch><검색결과개수>0</검색결과개수><page>1</page></aiSearch>"
}

function noInterpretationXml() {
  return "<Expc><totalCnt>0</totalCnt><page>1</page></Expc>"
}

function precedentXml(ids) {
  return [
    "<PrecSearch>",
    `<totalCnt>${ids.length}</totalCnt>`,
    "<page>1</page>",
    ...ids.map((id) => [
      "<prec>",
      `<판례일련번호>${id}</판례일련번호>`,
      `<사건명>검색 판례 ${id}</사건명>`,
      `<사건번호>2024다${id}</사건번호>`,
      "<법원명>대법원</법원명>",
      "<선고일자>20240101</선고일자>",
      "<판결유형>판결</판결유형>",
      `<판례상세링크>https://example.test/prec/${id}</판례상세링크>`,
      "</prec>",
    ].join("")),
    "</PrecSearch>",
  ].join("")
}

function precedentDetailJson(id) {
  return JSON.stringify({
    PrecService: {
      사건명: `상세 판례 ${id}`,
      사건번호: `2024다${id}`,
      법원명: "대법원",
      선고일자: "20240101",
      사건종류명: "민사",
      판결유형: "판결",
      판시사항: `판시사항 ${id}`,
      판결요지: `판결요지 ${id}`,
      참조조문: "민법 제398조",
      판례내용: `전문 ${id}`,
    },
  })
}

function makeApiClient() {
  const precedentSearchQueries = []
  const precedentDetailIds = []
  return {
    precedentSearchQueries,
    precedentDetailIds,
    async searchLaw() {
      return noLawXml()
    },
    async fetchApi(request) {
      if (request.target === "aiSearch") return noAiLawXml()
      if (request.target === "expc") return noInterpretationXml()
      if (request.target === "prec" && request.endpoint === "lawSearch.do") {
        const query = String(request.extraParams?.query || "")
        precedentSearchQueries.push(query)
        if (query.includes("위약금 감액")) return precedentXml(["111", "222"])
        if (query.includes("판례")) return precedentXml(["333"])
        return precedentXml(["111", "222", "333"])
      }
      if (request.target === "prec" && request.endpoint === "lawService.do") {
        const id = String(request.extraParams?.ID || "")
        precedentDetailIds.push(id)
        return precedentDetailJson(id)
      }
      throw new Error(`unexpected API request: ${JSON.stringify(request)}`)
    },
  }
}

function makePrecedentFailureApiClient() {
  return {
    async searchLaw() {
      return noLawXml()
    },
    async fetchApi(request) {
      if (request.target === "aiSearch") return noAiLawXml()
      if (request.target === "expc") return noInterpretationXml()
      if (request.target === "prec" && request.endpoint === "lawSearch.do") {
        throw new Error("precedent API down")
      }
      throw new Error(`unexpected API request: ${JSON.stringify(request)}`)
    },
  }
}

async function testChainFullResearchFetchesTopTwoPrecedentDetails(chainFullResearch) {
  const apiClient = makeApiClient()

  const result = await chainFullResearch(apiClient, {
    query: "청약철회 청구",
    apiKey: "test",
  })
  const text = result.content?.[0]?.text || ""

  assert.deepStrictEqual(apiClient.precedentDetailIds, ["111", "222"])
  assert.ok(text.includes("▶ 관련 판례 상세"), text)
  assert.ok(text.includes("자동 상세조회: search_precedents -> get_precedent_text (상위 2건, full=false)"), text)
  assert.ok(text.includes("상세 판례 111"), text)
  assert.ok(text.includes("상세 판례 222"), text)
  assert.ok(!text.includes("상세 판례 333"), text)
}

async function testChainFullResearchSurvivesPrecedentSearchFailure(chainFullResearch) {
  const apiClient = makePrecedentFailureApiClient()

  const result = await chainFullResearch(apiClient, {
    query: "청약철회 청구",
    apiKey: "test",
  })
  const text = result.content?.[0]?.text || ""

  assert.ok(!result.isError, text)
  assert.ok(text.includes("═══ 종합 리서치: 청약철회 청구 ═══"), text)
  assert.ok(text.includes("▶ 관련 판례 [NOT_FOUND / FAILED]"), text)
  assert.ok(text.includes("precedent API down"), text)
  assert.ok(text.includes("▶ 법령 해석례"), text)
}

async function testDocumentReviewFetchesTopTwoPrecedentDetailsTotal(chainDocumentReview) {
  const apiClient = makeApiClient()

  const result = await chainDocumentReview(apiClient, {
    text: "제1조 환불은 어떠한 경우에도 불가하다. 제2조 위약금은 계약금액의 80%로 한다.",
    apiKey: "test",
  })
  const text = result.content?.[0]?.text || ""

  assert.deepStrictEqual(apiClient.precedentDetailIds, ["111", "222"])
  assert.ok(text.includes("▶ 관련 판례 상세"), text)
  assert.ok(text.includes("상세 판례 111"), text)
  assert.ok(text.includes("상세 판례 222"), text)
  assert.ok(!text.includes("상세 판례 333"), text)
}

async function testDocumentReviewSurvivesPrecedentSearchFailure(chainDocumentReview) {
  const apiClient = makePrecedentFailureApiClient()

  const result = await chainDocumentReview(apiClient, {
    text: "제1조 환불은 어떠한 경우에도 불가하다.",
    apiKey: "test",
  })
  const text = result.content?.[0]?.text || ""

  assert.ok(!result.isError, text)
  assert.ok(text.includes("▶ 문서 리스크 분석"), text)
  assert.ok(text.includes("▶ 판례 검색 실패"), text)
  assert.ok(text.includes("precedent API down"), text)
}

async function main() {
  const { chainFullResearch, chainDocumentReview } = await import("../build/tools/chains.js")
  await testChainFullResearchFetchesTopTwoPrecedentDetails(chainFullResearch)
  await testChainFullResearchSurvivesPrecedentSearchFailure(chainFullResearch)
  await testDocumentReviewFetchesTopTwoPrecedentDetailsTotal(chainDocumentReview)
  await testDocumentReviewSurvivesPrecedentSearchFailure(chainDocumentReview)
  console.log("chain search detail integration tests passed")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
