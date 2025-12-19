#!/usr/bin/env node

/**
 * Tool 8 (get_annexes) Raw API 응답 확인
 */

import { LawApiClient } from './build/lib/api-client.js'

const LAW_OC = process.env.LAW_OC || 'ryuseungin'
const apiClient = new LawApiClient({ apiKey: LAW_OC })

console.log('🔍 Tool 8: get_annexes Raw API 테스트\n')

async function testAnnexRaw() {
  try {
    // 테스트 케이스들
    const testCases = [
      { lawName: '소득세법', knd: '1', desc: '소득세법 별표' },
      { lawName: '부가가치세법', knd: '2', desc: '부가가치세법 서식' },
      { lawName: '관세법 시행령', knd: '1', desc: '관세법 시행령 별표' },
      { lawName: '관세법 시행규칙', knd: '2', desc: '관세법 시행규칙 서식' }
    ]

    for (const tc of testCases) {
      console.log('═'.repeat(70))
      console.log(`[Test] ${tc.desc}`)
      console.log(`Input: { lawName: "${tc.lawName}", knd: "${tc.knd}" }`)
      console.log('-'.repeat(70))

      try {
        const rawJson = await apiClient.getAnnexes({
          lawName: tc.lawName,
          knd: tc.knd
        })

        console.log('\n[Raw JSON Response] (첫 1500자):')
        console.log(rawJson.substring(0, 1500))
        console.log('')

        // JSON 파싱
        const json = JSON.parse(rawJson)
        console.log('[JSON Keys]:', Object.keys(json))
        console.log('')

        // 별표서식 필드 확인
        const annexList = json?.별표서식 || []
        console.log(`[별표서식 배열 길이]: ${Array.isArray(annexList) ? annexList.length : 'N/A'}`)

        if (Array.isArray(annexList) && annexList.length > 0) {
          console.log('\n[첫 번째 항목 구조]:')
          console.log(JSON.stringify(annexList[0], null, 2).substring(0, 800))
          console.log('\n✅ 데이터 있음')
        } else {
          console.log('⚠️  별표/서식 없음 (API 응답 정상, 데이터 없음)')
        }

      } catch (e) {
        console.log(`❌ 에러: ${e.message}`)
      }

      console.log('')
    }

  } catch (error) {
    console.error('\n💥 Fatal Error:', error.message)
    console.error(error)
  }
}

testAnnexRaw()
