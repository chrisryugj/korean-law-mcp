#!/usr/bin/env node

import { LawApiClient } from './build/lib/api-client.js'

const LAW_OC = process.env.LAW_OC || 'ryuseungin'
const apiClient = new LawApiClient({ apiKey: LAW_OC })

async function testRawAPI() {
  console.log('🔍 Raw API Response Test\n')

  // 최신 관세법 MST
  const mst = "279811"

  console.log(`MST: ${mst}`)
  console.log('조문 번호: 003800 (제38조)')
  console.log('\n' + '='.repeat(60))

  const rawResponse = await apiClient.getLawText({ mst, jo: "003800" })

  console.log('\nRaw API Response (first 2000 chars):')
  console.log(rawResponse.substring(0, 2000))

  console.log('\n' + '='.repeat(60))
  console.log('\nParsing JSON...')

  const json = JSON.parse(rawResponse)
  console.log('\nJSON Keys:', Object.keys(json))
  console.log('\nJSON Structure:')
  console.log(JSON.stringify(json, null, 2).substring(0, 3000))
}

testRawAPI().catch(err => {
  console.error('Error:', err.message)
  console.error(err)
})
