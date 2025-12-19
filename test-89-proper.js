#!/usr/bin/env node

/**
 * Tool 8, 9 정확한 테스트
 */

import { LawApiClient } from './build/lib/api-client.js'
import { getAnnexes } from './build/tools/annex.js'
import { searchAdminRule } from './build/tools/admin-rule.js'
import { getOrdinance } from './build/tools/ordinance.js'

const LAW_OC = process.env.LAW_OC || 'ryuseungin'
const apiClient = new LawApiClient({ apiKey: LAW_OC })

console.log('🔍 Tool 8, 9 정확한 테스트\n')

async function test89() {
  try {
    // ========================================
    // Tool 8: get_annexes (광진구 조례 별표)
    // ========================================
    console.log('═'.repeat(70))
    console.log('Tool 8: get_annexes (조례 별표)')
    console.log('═'.repeat(70))

    // 먼저 광진구 관련 조례 검색
    console.log('\n[사전 조사] 법제처 API에서 조례 별표 조회 가능 여부 확인')
    console.log('참고: get_annexes는 법령의 별표/서식을 조회하는 도구입니다.')
    console.log('      자치법규(조례)는 별도로 get_ordinance 도구를 사용해야 합니다.\n')

    // 일반 법령의 별표 테스트
    console.log('[Test 8-1] 소득세법 별표')
    console.log('Input: { lawName: "소득세법", knd: "1" }')
    try {
      const result8_1 = await getAnnexes(apiClient, { lawName: '소득세법', knd: '1' })
      console.log(result8_1.content[0].text.substring(0, 500))
      console.log('✅ PASS: 별표 조회 정상\n')
    } catch (e) {
      console.log(`결과: ${e.message}`)
      console.log('⚠️  별표 없음 또는 API 미지원\n')
    }

    console.log('[Test 8-2] 부가가치세법 서식')
    console.log('Input: { lawName: "부가가치세법", knd: "2" }')
    try {
      const result8_2 = await getAnnexes(apiClient, { lawName: '부가가치세법', knd: '2' })
      console.log(result8_2.content[0].text.substring(0, 500))
      console.log('✅ PASS: 서식 조회 정상\n')
    } catch (e) {
      console.log(`결과: ${e.message}`)
      console.log('⚠️  서식 없음 또는 API 미지원\n')
    }

    // ========================================
    // Tool 9: search_admin_rule (관세법 관련)
    // ========================================
    console.log('═'.repeat(70))
    console.log('Tool 9: search_admin_rule (관세법 관련 행정규칙)')
    console.log('═'.repeat(70))

    // Raw API 테스트
    console.log('\n[Raw API Test] 행정규칙 검색 API 직접 호출')
    try {
      const rawXml = await apiClient.searchAdminRule({ query: '관세' })
      console.log('Raw XML 응답 (첫 500자):')
      console.log(rawXml.substring(0, 500))
      console.log('')

      if (rawXml.includes('<행정규칙>') || rawXml.includes('<admrul>')) {
        console.log('✅ API 응답 있음\n')
      } else {
        console.log('⚠️  검색 결과 없음\n')
      }
    } catch (e) {
      console.log(`API 에러: ${e.message}\n`)
    }

    // 다양한 검색어로 시도
    const queries = [
      { query: '관세', knd: undefined, desc: '관세 (전체)' },
      { query: '관세청', knd: undefined, desc: '관세청 (전체)' },
      { query: '수출입', knd: '3', desc: '수출입 (고시)' },
      { query: '통관', knd: '3', desc: '통관 (고시)' },
      { query: '관세행정', knd: '2', desc: '관세행정 (예규)' }
    ]

    for (const q of queries) {
      console.log(`[Test] ${q.desc}`)
      console.log(`Input: { query: "${q.query}"${q.knd ? `, knd: "${q.knd}"` : ''} }`)

      try {
        const result = await searchAdminRule(apiClient, { query: q.query, knd: q.knd, maxResults: 3 })
        const text = result.content[0].text

        if (text.includes('행정규칙ID')) {
          console.log('✅ PASS: 검색 성공')
          console.log(text.substring(0, 400))
          console.log('')
          break // 성공하면 더 이상 테스트 안 함
        } else {
          console.log('❌ 검색 결과 없음')
          console.log('')
        }
      } catch (e) {
        console.log(`❌ 에러: ${e.message}`)
        console.log('')
      }
    }

    console.log('═'.repeat(70))
    console.log('\n📊 테스트 결론:')
    console.log('  - Tool 8 (get_annexes): 법령의 별표/서식 조회 (일부 법령만 지원)')
    console.log('  - Tool 9 (search_admin_rule): 행정규칙 검색 (API 데이터 제한적)')
    console.log('\n⚠️  주의: 법제처 API는 모든 데이터를 제공하지 않을 수 있습니다.')

  } catch (error) {
    console.error('\n💥 Fatal Error:', error.message)
    console.error(error)
  }
}

test89()
