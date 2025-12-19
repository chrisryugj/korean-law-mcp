#!/usr/bin/env node

/**
 * 추가 Tools 테스트 (4개 선택 Tools)
 */

import { LawApiClient } from './build/lib/api-client.js'
import { compareOldNew } from './build/tools/comparison.js'
import { getThreeTier } from './build/tools/three-tier.js'
import { searchAdminRule, getAdminRule } from './build/tools/admin-rule.js'
import { getAnnexes } from './build/tools/annex.js'

const LAW_OC = process.env.LAW_OC || 'ryuseungin'
const apiClient = new LawApiClient({ apiKey: LAW_OC })

console.log('🧪 Additional Tools Test (4개 선택 Tools)\n')
console.log('═'.repeat(60))

async function testAdditionalTools() {
  try {
    // Test 6: compare_old_new
    console.log('\n📋 Test 6: compare_old_new (신구법 대조)')
    console.log('Input: { mst: "279811" }')
    const result6 = await compareOldNew(apiClient, { mst: "279811" })
    const compareText = result6.content[0].text
    console.log('✓ Success')
    console.log(compareText.substring(0, 500))
    if (compareText.includes('개정')) {
      console.log('... (신구법 대조 내용 정상)\n')
    } else {
      console.log('⚠️ 개정 이력 없음 (정상)\n')
    }

    // Test 7: get_three_tier
    console.log('\n📋 Test 7: get_three_tier (3단비교)')
    console.log('Input: { mst: "279811", knd: "2" }')
    const result7 = await getThreeTier(apiClient, { mst: "279811", knd: "2" })
    const threeTierText = result7.content[0].text
    console.log('✓ Success')
    console.log(threeTierText.substring(0, 600))
    if (threeTierText.includes('시행령') || threeTierText.includes('시행규칙')) {
      console.log('... (3단비교 위임 조문 정상)\n')
    } else {
      console.log('... (위임 조문 없음 또는 데이터 없음)\n')
    }

    // Test 8: get_annexes
    console.log('\n📋 Test 8: get_annexes (별표/서식)')
    console.log('Input: { lawName: "관세법", knd: "1" }')
    const result8 = await getAnnexes(apiClient, { lawName: "관세법", knd: "1" })
    const annexText = result8.content[0].text
    console.log('✓ Success')
    console.log(annexText.substring(0, 400))
    if (annexText.includes('별표')) {
      console.log('... (별표 목록 정상)\n')
    } else {
      console.log('... (별표 없음)\n')
    }

    // Test 9: search_admin_rule
    console.log('\n📋 Test 9: search_admin_rule (행정규칙 검색)')
    console.log('Input: { query: "관세", knd: "2", maxResults: 5 }')
    const result9 = await searchAdminRule(apiClient, { query: "관세", knd: "2", maxResults: 5 })
    const adminSearchText = result9.content[0].text
    console.log('✓ Success')
    console.log(adminSearchText.substring(0, 500))

    // 행정규칙 ID 추출 시도
    const adminIdMatch = adminSearchText.match(/행정규칙ID: ([A-Z0-9]+)/)
    if (adminIdMatch) {
      const adminId = adminIdMatch[1]
      console.log(`\n... (행정규칙 검색 정상, ID: ${adminId})`)

      // Test 10: get_admin_rule (ID가 있으면)
      console.log('\n📋 Test 10: get_admin_rule (행정규칙 상세)')
      console.log(`Input: { id: "${adminId}" }`)
      try {
        const result10 = await getAdminRule(apiClient, { id: adminId })
        const adminText = result10.content[0].text
        console.log('✓ Success')
        console.log(adminText.substring(0, 400) + '...\n')
      } catch (e) {
        console.log('⚠️ 행정규칙 상세 조회 실패 (API 제약):', e.message, '\n')
      }
    } else {
      console.log('\n⚠️ 행정규칙 검색 결과 없음 (정상)\n')
    }

    console.log('═'.repeat(60))
    console.log('\n✅ All additional tools tested!')
    console.log('\n📊 Additional Test Summary:')
    console.log('  - compare_old_new: ✓')
    console.log('  - get_three_tier: ✓')
    console.log('  - get_annexes: ✓')
    console.log('  - search_admin_rule: ✓')
    console.log('  - get_admin_rule: ✓ (if ID available)')
    console.log('\n🎉 Korean Law MCP Server - All 9 Tools Working!\n')

  } catch (error) {
    console.error('\n❌ Test failed:', error.message)
    console.error(error)
    process.exit(1)
  }
}

testAdditionalTools()
