#!/usr/bin/env node

/**
 * 지방공무원 복무규정 Raw API 응답 확인
 */

import { LawApiClient } from './build/lib/api-client.js'

const LAW_OC = process.env.LAW_OC || 'ryuseungin'
const apiClient = new LawApiClient({ apiKey: LAW_OC })

console.log('🔍 지방공무원 복무규정 Raw API 테스트\n')

async function testRaw() {
  try {
    const mst = '272849'

    // Test 1: 조문 조회 Raw API
    console.log('═'.repeat(70))
    console.log('[Test 1] 제7조의7 Raw API 응답')
    console.log('═'.repeat(70))
    console.log(`MST: ${mst}`)
    console.log('JO Code: 000707 (제7조의7)')
    console.log('')

    try {
      const rawLawText = await apiClient.getLawText({
        mst,
        jo: '000707'
      })

      console.log('Raw JSON Response (첫 2000자):')
      console.log(rawLawText.substring(0, 2000))
      console.log('')

      const json = JSON.parse(rawLawText)
      console.log('JSON Keys:', Object.keys(json))
      console.log('')

      if (json.법령) {
        console.log('법령 Keys:', Object.keys(json.법령))
        console.log('')

        if (json.법령.조문) {
          console.log('조문 Keys:', Object.keys(json.법령.조문))
          console.log('')

          const units = json.법령.조문.조문단위 || []
          console.log(`조문단위 배열 길이: ${Array.isArray(units) ? units.length : 'N/A'}`)

          if (Array.isArray(units) && units.length > 0) {
            console.log('\n첫 번째 조문단위:')
            console.log(JSON.stringify(units[0], null, 2).substring(0, 1000))
          }
        }
      }
    } catch (e) {
      console.log(`❌ 에러: ${e.message}`)
    }

    console.log('\n')

    // Test 2: 별표 조회 Raw API
    console.log('═'.repeat(70))
    console.log('[Test 2] 별표 Raw API 응답')
    console.log('═'.repeat(70))
    console.log('lawName: 지방공무원 복무규정')
    console.log('')

    try {
      const rawAnnex = await apiClient.getAnnexes({
        lawName: '지방공무원 복무규정',
        knd: '1'
      })

      console.log('Raw JSON Response:')
      console.log(rawAnnex.substring(0, 1000))
      console.log('')

      const annexJson = JSON.parse(rawAnnex)
      console.log('JSON Keys:', Object.keys(annexJson))
      console.log('')

    } catch (e) {
      console.log(`❌ 에러: ${e.message}`)
      console.log('')
      console.log('⚠️  법제처 API에서 별표/서식 데이터를 제공하지 않습니다.')
    }

    console.log('')
    console.log('═'.repeat(70))
    console.log('📊 결론:')
    console.log('  1. 조문 조회: JSON 구조 확인 필요')
    console.log('  2. 별표 조회: API에서 404 반환 (데이터 없음)')
    console.log('═'.repeat(70))

  } catch (error) {
    console.error('\n💥 Fatal Error:', error.message)
    console.error(error)
  }
}

testRaw()
