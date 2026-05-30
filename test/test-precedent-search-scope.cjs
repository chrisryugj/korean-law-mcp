#!/usr/bin/env node

const assert = require("assert")

function noPrecedentXml() {
  return "<PrecSearch><totalCnt>0</totalCnt><page>1</page></PrecSearch>"
}

function precedentXml(items) {
  const rows = items.map((item) => [
    "<prec>",
    `<판례일련번호>${item.id}</판례일련번호>`,
    `<사건명>${item.title}</사건명>`,
    `<사건번호>${item.caseNumber || "2024다12345"}</사건번호>`,
    `<법원명>${item.court || "대법원"}</법원명>`,
    `<선고일자>${item.date || "20240101"}</선고일자>`,
    `<판결유형>${item.type || "판결"}</판결유형>`,
    "</prec>",
  ].join("")).join("")
  return `<PrecSearch><totalCnt>${items.length}</totalCnt><page>1</page>${rows}</PrecSearch>`
}

function precedentDetailJson(title, body) {
  return JSON.stringify({
    PrecService: {
      사건명: title,
      사건번호: "2024다12345",
      법원명: "대법원",
      선고일자: "20240101",
      사건종류명: "민사",
      판결유형: "판결",
      판례내용: body,
    },
  })
}

async function testPassesSearchScope() {
  const { searchPrecedents } = await import("../build/tools/precedents.js")
  const calls = []
  const apiClient = {
    async fetchApi(request) {
      calls.push(request)
      return noPrecedentXml()
    },
  }

  await searchPrecedents(apiClient, {
    query: "청약철회 등",
    search: 2,
    display: 5,
    page: 1,
    apiKey: "test",
  })

  assert.strictEqual(calls[0].extraParams.search, "2")
}

async function testKeepsDefaultSearchScopeImplicit() {
  const { searchPrecedents } = await import("../build/tools/precedents.js")
  const calls = []
  const apiClient = {
    async fetchApi(request) {
      calls.push(request)
      return noPrecedentXml()
    },
  }

  await searchPrecedents(apiClient, {
    query: "청약철회",
    display: 5,
    page: 1,
    apiKey: "test",
  })

  assert.ok(!("search" in calls[0].extraParams), JSON.stringify(calls[0].extraParams))
}

async function testDirectSearchValidatesAxisFallback() {
  const { searchPrecedents } = await import("../build/tools/precedents.js")
  const calls = []
  const apiClient = {
    async fetchApi(request) {
      calls.push(request)
      if (request.target === "prec" && request.endpoint === "lawSearch.do") {
        const query = request.extraParams?.query || ""
        if (query === "양도소득세 사기") {
          return precedentXml([{
            id: "999",
            title: "특정경제범죄가중처벌등에관한법률위반(사기)",
          }])
        }
        return noPrecedentXml()
      }
      if (request.target === "prec" && request.endpoint === "lawService.do") {
        return precedentDetailJson("특정경제범죄가중처벌등에관한법률위반(사기)", "일반 형사 사기 사건")
      }
      throw new Error(`unexpected API request: ${JSON.stringify(request)}`)
    },
  }

  const result = await searchPrecedents(apiClient, {
    query: "사기 행위에 의해 부과된 양도소득세 취소가 가능한가?",
    display: 5,
    page: 1,
    apiKey: "test",
  })
  const text = result.content?.[0]?.text || ""

  assert.strictEqual(result.isError, true)
  assert.ok(text.includes("[NOT_FOUND]"), text)
  assert.ok(calls.some((request) => request.endpoint === "lawService.do"), "expected detail validation request")
}

async function main() {
  await testPassesSearchScope()
  await testKeepsDefaultSearchScopeImplicit()
  await testDirectSearchValidatesAxisFallback()
  console.log("precedent search scope tests passed")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
