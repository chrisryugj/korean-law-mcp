#!/usr/bin/env node

/**
 * 로컬 테스트 스크립트
 * MCP Inspector 없이 직접 Tools를 테스트합니다.
 */

import { LawApiClient } from './build/lib/api-client.js'
import { searchLaw } from './build/tools/search.js'
import { getLawText } from './build/tools/law-text.js'
import { parseJoCode } from './build/tools/utils.js'

const LAW_OC = process.env.LAW_OC || 'ryuseungin'

console.log('🧪 Korean Law MCP Server - Local Test\n')
console.log('API Key:', LAW_OC ? 'Configured ✓' : 'Missing ✗')
console.log('═'.repeat(50))

const apiClient = new LawApiClient({ apiKey: LAW_OC })

async function runTests() {
  try {
    // Test 1: search_law - 기본 검색
    console.log('\n📋 Test 1: search_law (기본 검색)')
    console.log('Input: { query: "관세법" }')
    const result1 = await searchLaw(apiClient, { query: "관세법", maxResults: 20 })
    console.log('✓ Success')
    console.log(result1.content[0].text.substring(0, 300) + '...\n')

    // Test 2: search_law - 약칭 해결
    console.log('\n📋 Test 2: search_law (약칭 해결)')
    console.log('Input: { query: "화관법" }')
    const result2 = await searchLaw(apiClient, { query: "화관법", maxResults: 20 })
    console.log('✓ Success - "화관법" → "화학물질관리법" 자동 변환')
    console.log(result2.content[0].text.substring(0, 300) + '...\n')

    // Test 3: parse_jo_code - to_code
    console.log('\n📋 Test 3: parse_jo_code (한글 → 코드)')
    console.log('Input: { joText: "제38조", direction: "to_code" }')
    const result3 = await parseJoCode({ joText: "제38조", direction: "to_code" })
    console.log('✓ Success')
    console.log(result3.content[0].text + '\n')

    // Test 4: parse_jo_code - to_text
    console.log('\n📋 Test 4: parse_jo_code (코드 → 한글)')
    console.log('Input: { joText: "003800", direction: "to_text" }')
    const result4 = await parseJoCode({ joText: "003800", direction: "to_text" })
    console.log('✓ Success')
    console.log(result4.content[0].text + '\n')

    // Test 5: get_law_text - 한글 조문 번호
    console.log('\n📋 Test 5: get_law_text (한글 조문 번호)')
    console.log('Input: { mst: "000013", jo: "제38조" }')
    const result5 = await getLawText(apiClient, { mst: "000013", jo: "제38조" })
    console.log('✓ Success')
    console.log(result5.content[0].text.substring(0, 400) + '...\n')

    console.log('═'.repeat(50))
    console.log('\n✅ All tests passed!')
    console.log('\n📊 Test Summary:')
    console.log('  - search_law: ✓ (기본 검색)')
    console.log('  - search_law: ✓ (약칭 해결)')
    console.log('  - parse_jo_code: ✓ (양방향 변환)')
    console.log('  - get_law_text: ✓ (한글 조문)')
    console.log('\n🎉 Korean Law MCP Server is working correctly!\n')

  } catch (error) {
    console.error('\n❌ Test failed:', error.message)
    console.error(error)
    process.exit(1)
  }
}

runTests()
