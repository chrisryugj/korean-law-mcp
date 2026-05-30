#!/usr/bin/env node

const assert = require("assert")

function structuredResult(ids) {
  return {
    originalArgs: { query: "위약금 감액", display: 10, page: 1 },
    totalCount: ids.length,
    page: 1,
    hits: ids.map((id) => ({
      id,
      title: `검색 판례 ${id}`,
      caseNumber: `2024다${id}`,
      court: "대법원",
      date: "20240101",
      decisionType: "판결",
      searchMode: 1,
    })),
    attempts: [],
    fallbackUsed: false,
  }
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

function makeApiClient(resolver) {
  const detailIds = []
  return {
    detailIds,
    async fetchApi(request) {
      if (request.target === "prec" && request.endpoint === "lawService.do") {
        const id = String(request.extraParams?.ID || "")
        detailIds.push(id)
        return resolver(id, request)
      }
      throw new Error(`unexpected API request: ${JSON.stringify(request)}`)
    },
  }
}

async function testFetchesTopTwoStructuredHits() {
  const { fetchPrecedentEvidence } = await import("../build/tools/precedent-evidence.js")
  const apiClient = makeApiClient((id) => precedentDetailJson(id))

  const result = await fetchPrecedentEvidence(apiClient, structuredResult(["111", "222", "333"]), {
    apiKey: "test",
  })

  assert.deepStrictEqual(apiClient.detailIds.slice(0, 2), ["111", "222"])
  assert.strictEqual(result.isError, false)
  assert.strictEqual(result.items.length, 2)
  assert.ok(result.text.includes("자동 상세조회: search_precedents -> get_precedent_text (상위 2건, full=false)"), result.text)
  assert.ok(result.text.includes("[111] 검색 판례 111"), result.text)
  assert.ok(result.text.includes("상세 판례 111"), result.text)
  assert.ok(result.text.includes("상세 판례 222"), result.text)
  assert.ok(!result.text.includes("상세 판례 333"), result.text)
}

async function testPreservesPartialDetailFailure() {
  const { fetchPrecedentEvidence } = await import("../build/tools/precedent-evidence.js")
  const apiClient = makeApiClient((id) => {
    if (id === "222") throw new Error("detail unavailable")
    return precedentDetailJson(id)
  })

  const result = await fetchPrecedentEvidence(apiClient, structuredResult(["111", "222"]), {
    apiKey: "test",
  })

  assert.deepStrictEqual(apiClient.detailIds.slice(0, 2), ["111", "222"])
  assert.strictEqual(result.isError, false)
  assert.strictEqual(result.items.length, 2)
  assert.strictEqual(result.items[0].isError, false)
  assert.strictEqual(result.items[1].isError, true)
  assert.ok(result.items[1].detailError.includes("detail unavailable"))
  assert.ok(result.text.includes("상세 판례 111"), result.text)
  assert.ok(result.text.includes("상세조회 실패"), result.text)
}

async function testCapsDetailLimit() {
  const { fetchPrecedentEvidence } = await import("../build/tools/precedent-evidence.js")
  const apiClient = makeApiClient((id) => precedentDetailJson(id))

  const result = await fetchPrecedentEvidence(
    apiClient,
    structuredResult(["101", "102", "103", "104", "105", "106"]),
    { detailLimit: 50, apiKey: "test" }
  )

  assert.deepStrictEqual(apiClient.detailIds, ["101", "102", "103", "104", "105"])
  assert.strictEqual(result.items.length, 5)
}

async function testReturnsNullForNoHits() {
  const { fetchPrecedentEvidence } = await import("../build/tools/precedent-evidence.js")
  const apiClient = makeApiClient((id) => precedentDetailJson(id))

  const result = await fetchPrecedentEvidence(apiClient, structuredResult([]), {
    apiKey: "test",
  })

  assert.strictEqual(result, null)
  assert.deepStrictEqual(apiClient.detailIds, [])
}

async function testValidationRequiresAllAxisGroups() {
  const { validatePrecedentSearchResult } = await import("../build/tools/precedent-evidence.js")
  const apiClient = makeApiClient((id) => precedentDetailJson(id))

  const input = {
    originalArgs: { query: "사기 행위에 의해 부과된 양도소득세 취소가 가능한가?", display: 5, page: 1 },
    attempt: {
      query: "양도소득세 사기",
      search: 1,
      reason: "original_keyword",
      totalCount: 1,
      hitCount: 1,
      success: true,
      requiresResultValidation: true,
      validationTermGroups: [
        ["양도소득세", "소득세", "조세", "과세"],
        ["사기", "사기행위", "부정한행위", "허위"],
      ],
    },
    hits: [{
      id: "999",
      title: "특정경제범죄가중처벌등에관한법률위반(사기)",
      caseNumber: "2025도999",
      court: "대법원",
      date: "20250101",
      decisionType: "판결",
      searchMode: 1,
    }],
  }

  const accepted = await validatePrecedentSearchResult(apiClient, input, { apiKey: "test" })

  assert.strictEqual(accepted, false)
}

async function testValidationAcceptsSeparatedAxisTerms() {
  const { validatePrecedentSearchResult } = await import("../build/tools/precedent-evidence.js")
  const apiClient = makeApiClient((id) => precedentDetailJson(id))

  const input = {
    originalArgs: { query: "사기 행위에 의해 부과된 양도소득세 취소가 가능한가?", display: 5, page: 1 },
    attempt: {
      query: "양도소득세 사기",
      search: 1,
      reason: "original_keyword",
      totalCount: 1,
      hitCount: 1,
      success: true,
      requiresResultValidation: true,
      validationTermGroups: [
        ["양도소득세", "소득세", "조세", "과세"],
        ["사기", "사기행위", "부정한행위", "허위"],
      ],
    },
    hits: [{
      id: "998",
      title: "허위계약서를 작성하는 방법으로 양도소득세 신고를 한 것은 사기 기타 부정한 행위에 해당함",
      caseNumber: "2025구합998",
      court: "서울행정법원",
      date: "20250101",
      decisionType: "판결",
      searchMode: 1,
    }],
  }

  const accepted = await validatePrecedentSearchResult(apiClient, input, { apiKey: "test" })

  assert.strictEqual(accepted, true)
  assert.deepStrictEqual(apiClient.detailIds, [])
}

async function main() {
  await testFetchesTopTwoStructuredHits()
  await testPreservesPartialDetailFailure()
  await testCapsDetailLimit()
  await testReturnsNullForNoHits()
  await testValidationRequiresAllAxisGroups()
  await testValidationAcceptsSeparatedAxisTerms()
  console.log("precedent evidence tests passed")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
