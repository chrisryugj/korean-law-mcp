#!/usr/bin/env node

const assert = require("assert")
const path = require("path")
const dotenv = require("dotenv")

dotenv.config({ path: path.resolve(process.cwd(), ".env"), quiet: true })

function extractNtsPrecedentId(xml) {
  return extractNtsPrecedentItems(xml)[0]?.id || ""
}

function extractNtsPrecedentItems(xml) {
  const itemRegex = /<prec\b[^>]*>([\s\S]*?)<\/prec>/g
  const items = []
  let match
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1]
    if (!item.includes("<데이터출처명>국세법령정보시스템</데이터출처명>")) continue
    const id = item.match(/<판례일련번호>(.*?)<\/판례일련번호>/)?.[1]?.trim()
    const name = item.match(/<판례명>([\s\S]*?)<\/판례명>/)?.[1]?.trim() || ""
    if (id) items.push({ id, name })
  }
  return items
}

function assertCleanPrecedentText(text) {
  assert.ok(text.includes("전문:"), text)
  assert.ok(text.includes("국세법령정보시스템 판례"), text)
  assert.ok(!text.includes("<html"), text)
  assert.ok(!text.includes("<iframe"), text)
  assert.ok(!text.includes("dcmFleByte"), text)
  assert.ok(!text.includes("action.do"), text)
}

function extractSearchResultIds(text) {
  return [...text.matchAll(/^\[(\d+)\]\s+/gm)].map((match) => match[1])
}

async function testKnownNtsPrecedent616821(apiClient, apiKey) {
  const { getPrecedentText } = await import("../build/tools/precedents.js")

  const result = await getPrecedentText(apiClient, { id: "616821", apiKey, full: false })
  const text = result.content?.[0]?.text || ""
  assert.notStrictEqual(result.isError, true, text)
  assert.ok(text.includes("사해행위취소소송"), text)
  assertCleanPrecedentText(text)
}

async function testTaxCancellationTopTwoAutoDetails(apiClient, apiKey) {
  const { searchPrecedents } = await import("../build/tools/precedents.js")
  const { fetchSearchDetailChain } = await import("../build/tools/search-detail-chain.js")

  const result = await searchPrecedents(apiClient, { query: "양도소득세 취소", search: 1, display: 5, apiKey })
  const searchText = result.content?.[0]?.text || ""
  assert.notStrictEqual(result.isError, true, searchText)

  const ids = extractSearchResultIds(searchText).slice(0, 2)
  assert.strictEqual(ids.length, 2, searchText)

  const detail = await fetchSearchDetailChain(apiClient, "search_precedents", {
    text: searchText,
    isError: false,
  }, { apiKey })
  const detailText = detail?.text || ""
  assert.notStrictEqual(detail?.isError, true, detailText)
  assert.ok(detailText.includes(`[${ids[0]}]`), detailText)
  assert.ok(detailText.includes(`[${ids[1]}]`), detailText)
  assert.ok(/양도소득세|취소|처분|국세법령정보시스템 판례/.test(detailText), detailText)
  assert.ok(!detailText.includes("[EXTERNAL_API_ERROR]"), detailText)
}

async function testTaxQuestionFallsBackToBodySearch(apiClient, apiKey) {
  const { searchAiLawStructured } = await import("../build/tools/life-law.js")
  const { searchPrecedents, getPrecedentText } = await import("../build/tools/precedents.js")

  const query = "양도소득세 납세고지서 취소"
  const ai = await searchAiLawStructured(apiClient, { query, search: "0", display: 3, page: 1, apiKey })
  const laws = ai.articleSignals.map((item) => item.lawName).join(" ")
  assert.ok(/소득세법|국세징수법|조세특례제한법/.test(laws), laws)

  const titleSearch = await searchPrecedents(apiClient, { query, search: 1, display: 5, apiKey })
  const titleSearchText = titleSearch.content?.[0]?.text || ""
  if (titleSearch.isError !== true) {
    assert.ok(extractSearchResultIds(titleSearchText).length > 0, titleSearchText)
  }

  const bodySearch = await searchPrecedents(apiClient, { query, search: 2, display: 5, apiKey })
  const bodySearchText = bodySearch.content?.[0]?.text || ""
  assert.notStrictEqual(bodySearch.isError, true, bodySearchText)

  const xml = await apiClient.fetchApi({
    endpoint: "lawSearch.do",
    target: "prec",
    type: "XML",
    extraParams: {
      query,
      search: "2",
      display: "20",
    },
    apiKey,
  })
  const ntsId = extractNtsPrecedentId(xml)
  assert.ok(ntsId, "expected at least one 국세법령정보시스템 precedent for body search")

  const result = await getPrecedentText(apiClient, { id: ntsId, apiKey, full: false })
  const text = result.content?.[0]?.text || ""
  assert.notStrictEqual(result.isError, true, text)
  assertCleanPrecedentText(text)
}

async function testNtsDcmContentFallback(apiClient, apiKey) {
  const { getPrecedentText } = await import("../build/tools/precedents.js")

  const xml = await apiClient.fetchApi({
    endpoint: "lawSearch.do",
    target: "prec",
    type: "XML",
    extraParams: {
      query: "상속세",
      search: "2",
      display: "30",
    },
    apiKey,
  })
  const ntsIds = extractNtsPrecedentItems(xml).map((item) => item.id)
  assert.ok(ntsIds.includes("615819"), "expected live 상속세 search results to include NTS precedent id=615819")

  const result = await getPrecedentText(apiClient, { id: "615819", apiKey, full: false })
  const text = result.content?.[0]?.text || ""
  assert.notStrictEqual(result.isError, true, text)
  assertCleanPrecedentText(text)
}

async function main() {
  const apiKey = process.env.LAW_OC || process.env.KOREAN_LAW_API_KEY
  if (!apiKey) {
    console.error("❌ repo root .env에 LAW_OC 또는 KOREAN_LAW_API_KEY가 필요합니다")
    process.exit(1)
  }

  const { LawApiClient } = await import("../build/lib/api-client.js")
  const { getPrecedentText } = await import("../build/tools/precedents.js")
  const apiClient = new LawApiClient({ apiKey })

  const xml = await apiClient.fetchApi({
    endpoint: "lawSearch.do",
    target: "prec",
    type: "XML",
    extraParams: {
      query: "양도소득세",
      display: "10",
    },
    apiKey,
  })
  const id = extractNtsPrecedentId(xml)
  assert.ok(id, "expected at least one 국세법령정보시스템 precedent for query=양도소득세")

  const result = await getPrecedentText(apiClient, { id, apiKey, full: false })
  const text = result.content?.[0]?.text || ""

  assert.notStrictEqual(result.isError, true, text)
  assert.ok(/양도소득세|양도|과세|처분/.test(text), text)
  assertCleanPrecedentText(text)

  await testTaxQuestionFallsBackToBodySearch(apiClient, apiKey)
  await testNtsDcmContentFallback(apiClient, apiKey)
  await testKnownNtsPrecedent616821(apiClient, apiKey)
  await testTaxCancellationTopTwoAutoDetails(apiClient, apiKey)

  console.log(`precedent html fallback live test passed: id=${id}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
