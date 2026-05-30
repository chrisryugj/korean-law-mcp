#!/usr/bin/env node

const assert = require("assert")

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
  const searchRequests = []
  const detailIds = []
  return {
    searchRequests,
    detailIds,
    async fetchApi(request) {
      if (request.target === "prec" && request.endpoint === "lawSearch.do") {
        searchRequests.push(request)
        return precedentXml(["111", "222", "333"])
      }
      if (request.target === "prec" && request.endpoint === "lawService.do") {
        const id = String(request.extraParams?.ID || "")
        detailIds.push(id)
        return precedentDetailJson(id)
      }
      throw new Error(`unexpected API request: ${JSON.stringify(request)}`)
    },
  }
}

async function testDefaultPrecedentSearchRemainsListOnly() {
  const { searchDecisions } = await import("../build/tools/unified-decisions.js")
  const apiClient = makeApiClient()

  const result = await searchDecisions(apiClient, {
    domain: "precedent",
    query: "위약금 감액",
    display: 3,
    page: 1,
    apiKey: "test",
  })
  const text = result.content?.[0]?.text || ""

  assert.deepStrictEqual(apiClient.detailIds, [])
  assert.ok(text.includes("[111] 검색 판례 111"), text)
  assert.ok(!text.includes("자동 상세조회"), text)
}

async function testIncludeTextFetchesBoundedPrecedentDetails() {
  const { searchDecisions } = await import("../build/tools/unified-decisions.js")
  const apiClient = makeApiClient()

  const result = await searchDecisions(apiClient, {
    domain: "precedent",
    query: "위약금 감액",
    display: 3,
    page: 1,
    options: {
      includeText: true,
      detailLimit: 2,
    },
    apiKey: "test",
  })
  const text = result.content?.[0]?.text || ""

  assert.deepStrictEqual(apiClient.detailIds, ["111", "222"])
  assert.ok(text.includes("판례 검색 결과"), text)
  assert.ok(text.includes("[111] 검색 판례 111"), text)
  assert.ok(text.includes("자동 상세조회: search_precedents -> get_precedent_text (상위 2건, full=false)"), text)
  assert.ok(text.includes("상세 판례 111"), text)
  assert.ok(text.includes("상세 판례 222"), text)
  assert.ok(!text.includes("상세 판례 333"), text)
}

async function testIncludeTextPassesPrecedentOptionsToSearch() {
  const { searchDecisions } = await import("../build/tools/unified-decisions.js")
  const apiClient = makeApiClient()

  await searchDecisions(apiClient, {
    domain: "precedent",
    query: "위약금 감액",
    options: {
      includeText: true,
      court: "대법원",
      fromDate: "20240101",
      toDate: "20241231",
      detailLimit: 1,
    },
    apiKey: "test",
  })

  assert.strictEqual(apiClient.searchRequests[0].extraParams.curt, "대법원")
  assert.deepStrictEqual(apiClient.detailIds, ["111"])
}

async function main() {
  await testDefaultPrecedentSearchRemainsListOnly()
  await testIncludeTextFetchesBoundedPrecedentDetails()
  await testIncludeTextPassesPrecedentOptionsToSearch()
  console.log("search_decisions precedent includeText tests passed")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
