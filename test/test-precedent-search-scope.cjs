#!/usr/bin/env node

const assert = require("assert")

function noPrecedentXml() {
  return "<PrecSearch><totalCnt>0</totalCnt><page>1</page></PrecSearch>"
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

async function main() {
  await testPassesSearchScope()
  await testKeepsDefaultSearchScopeImplicit()
  console.log("precedent search scope tests passed")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
