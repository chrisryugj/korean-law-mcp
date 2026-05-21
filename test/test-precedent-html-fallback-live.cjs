#!/usr/bin/env node

const assert = require("assert")
const path = require("path")
const dotenv = require("dotenv")

dotenv.config({ path: path.resolve(process.cwd(), ".env"), quiet: true })

function extractNtsPrecedentId(xml) {
  const itemRegex = /<prec\b[^>]*>([\s\S]*?)<\/prec>/g
  let match
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1]
    if (!item.includes("<데이터출처명>국세법령정보시스템</데이터출처명>")) continue
    const id = item.match(/<판례일련번호>(.*?)<\/판례일련번호>/)?.[1]?.trim()
    if (id) return id
  }
  return ""
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
  assert.ok(text.includes("전문:"), text)
  assert.ok(/양도소득세|양도|과세|처분/.test(text), text)
  assert.ok(text.includes("국세법령정보시스템 판례"), text)
  assert.ok(!text.includes("<html"), text)
  assert.ok(!text.includes("<iframe"), text)
  assert.ok(!text.includes("dcmFleByte"), text)
  assert.ok(!text.includes("action.do"), text)

  console.log(`precedent html fallback live test passed: id=${id}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
