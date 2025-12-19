#!/usr/bin/env node

/**
 * Tool 7, 8, 9 재테스트
 */

import { LawApiClient } from './build/lib/api-client.js'
import { searchLaw } from './build/tools/search.js'
import { getThreeTier } from './build/tools/three-tier.js'
import { getAnnexes } from './build/tools/annex.js'
import { searchAdminRule } from './build/tools/admin-rule.js'

const LAW_OC = process.env.LAW_OC || 'ryuseungin'
const apiClient = new LawApiClient({ apiKey: LAW_OC })

console.log('🔍 Tool 7, 8, 9 상세 테스트\n')

async function testTools789() {
  try {
    // 관세법 MST 가져오기
    const searchResult = await searchLaw(apiClient, { query: '관세법', maxResults: 1 })
    const mstMatch = searchResult.content[0].text.match(/MST: (\d+)/)
    const mst = mstMatch[1]

    // ========================================
    // Tool 7: get_three_tier
    // ========================================
    console.log('═'.repeat(70))
    console.log('Tool 7: get_three_tier')
    console.log('═'.repeat(70))
    console.log(`Input: { mst: "${mst}", knd: "2" }`)
    console.log('')

    const result7 = await getThreeTier(apiClient, { mst, knd: '2' })
    const text7 = result7.content[0].text

    console.log(text7.substring(0, 1500))
    console.log('')

    if (text7.includes('시행령') || text7.includes('시행규칙')) {
      console.log('✅ PASS: 시행령/시행규칙 위임 관계 정상 출력')
    } else if (text7.includes('3단비교 데이터가 없습니다')) {
      console.log('⚠️  데이터 없음 (API 응답 없음)')
    } else {
      console.log('❌ FAIL: 예상되는 내용 없음')
    }

    // ========================================
    // Tool 8: get_annexes
    // ========================================
    console.log('\n' + '═'.repeat(70))
    console.log('Tool 8: get_annexes')
    console.log('═'.repeat(70))

    // 8-1: 시행령 별표 테스트
    console.log('\n[Test 8-1] 관세법 시행령 별표')
    console.log('Input: { lawName: "관세법 시행령", knd: "1" }')
    try {
      const result8_1 = await getAnnexes(apiClient, { lawName: '관세법 시행령', knd: '1' })
      const text8_1 = result8_1.content[0].text
      console.log(text8_1.substring(0, 800))
      console.log('')
      if (text8_1.includes('별표') && !text8_1.includes('없습니다')) {
        console.log('✅ PASS: 시행령 별표 조회 성공')
      } else {
        console.log('⚠️  별표 없음')
      }
    } catch (e) {
      console.log(`❌ FAIL: ${e.message}`)
    }

    // 8-2: 시행규칙 서식 테스트
    console.log('\n[Test 8-2] 관세법 시행규칙 서식')
    console.log('Input: { lawName: "관세법 시행규칙", knd: "2" }')
    try {
      const result8_2 = await getAnnexes(apiClient, { lawName: '관세법 시행규칙', knd: '2' })
      const text8_2 = result8_2.content[0].text
      console.log(text8_2.substring(0, 800))
      console.log('')
      if (text8_2.includes('서식') && !text8_2.includes('없습니다')) {
        console.log('✅ PASS: 시행규칙 서식 조회 성공')
      } else {
        console.log('⚠️  서식 없음')
      }
    } catch (e) {
      console.log(`❌ FAIL: ${e.message}`)
    }

    // ========================================
    // Tool 9: search_admin_rule
    // ========================================
    console.log('\n' + '═'.repeat(70))
    console.log('Tool 9: search_admin_rule')
    console.log('═'.repeat(70))

    // 9-1: 예규 검색
    console.log('\n[Test 9-1] 예규 검색')
    console.log('Input: { query: "개인정보", knd: "2" }')
    const result9_1 = await searchAdminRule(apiClient, { query: '개인정보', knd: '2', maxResults: 5 })
    const text9_1 = result9_1.content[0].text
    console.log(text9_1.substring(0, 800))
    console.log('')
    if (text9_1.includes('행정규칙ID') || text9_1.includes('예규')) {
      console.log('✅ PASS: 예규 검색 성공')
    } else if (text9_1.includes('없습니다')) {
      console.log('❌ FAIL: 검색 결과 없음 (API 문제 또는 쿼리 문제)')
    }

    // 9-2: 고시 검색
    console.log('\n[Test 9-2] 고시 검색')
    console.log('Input: { query: "관세", knd: "3" }')
    const result9_2 = await searchAdminRule(apiClient, { query: '관세', knd: '3', maxResults: 5 })
    const text9_2 = result9_2.content[0].text
    console.log(text9_2.substring(0, 800))
    console.log('')
    if (text9_2.includes('행정규칙ID') || text9_2.includes('고시')) {
      console.log('✅ PASS: 고시 검색 성공')
    } else if (text9_2.includes('없습니다')) {
      console.log('❌ FAIL: 검색 결과 없음 (API 문제 또는 쿼리 문제)')
    }

    // 9-3: 전체 검색
    console.log('\n[Test 9-3] 행정규칙 전체 검색 (knd 없음)')
    console.log('Input: { query: "관세청" }')
    const result9_3 = await searchAdminRule(apiClient, { query: '관세청', maxResults: 5 })
    const text9_3 = result9_3.content[0].text
    console.log(text9_3.substring(0, 800))
    console.log('')
    if (text9_3.includes('행정규칙ID')) {
      console.log('✅ PASS: 행정규칙 검색 성공')
    } else if (text9_3.includes('없습니다')) {
      console.log('❌ FAIL: 검색 결과 없음 - API가 행정규칙 데이터를 제공하지 않는 것으로 보임')
    }

    console.log('\n' + '═'.repeat(70))
    console.log('\n📊 Tool 7, 8, 9 테스트 완료')
    console.log('\n⚠️  주의: 일부 API는 데이터가 없거나 제한적일 수 있습니다.')

  } catch (error) {
    console.error('\n💥 Error:', error.message)
    console.error(error)
  }
}

testTools789()
