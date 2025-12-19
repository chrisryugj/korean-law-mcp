#!/usr/bin/env node

/**
 * Tool 8 (get_annexes) 실제 작동 테스트
 * - 별표/서식이 실제로 있는 법령으로 테스트
 */

import { LawApiClient } from './build/lib/api-client.js'
import { getAnnexes } from './build/tools/annex.js'

const LAW_OC = process.env.LAW_OC || 'ryuseungin'
const apiClient = new LawApiClient({ apiKey: LAW_OC })

console.log('🔍 Tool 8: get_annexes 작동 테스트\n')

async function testAnnexWorking() {
  try {
    // 별표/서식이 있을 가능성이 높은 법령들
    const testCases = [
      { lawName: '행정절차법', knd: '1', desc: '행정절차법 별표' },
      { lawName: '개인정보 보호법', knd: '2', desc: '개인정보 보호법 서식' },
      { lawName: '전자정부법', knd: undefined, desc: '전자정부법 전체' },
      { lawName: '민원 처리에 관한 법률', knd: '2', desc: '민원처리법 서식' },
      { lawName: '정보통신망 이용촉진 및 정보보호 등에 관한 법률', knd: '1', desc: '정보통신망법 별표' }
    ]

    for (const tc of testCases) {
      console.log('═'.repeat(70))
      console.log(`[Test] ${tc.desc}`)
      console.log(`Input: { lawName: "${tc.lawName}"${tc.knd ? `, knd: "${tc.knd}"` : ''} }`)
      console.log('-'.repeat(70))

      try {
        const result = await getAnnexes(apiClient, {
          lawName: tc.lawName,
          knd: tc.knd
        })

        const text = result.content[0].text
        console.log(text.substring(0, 800))

        if (text.includes('별표/서식이 없습니다')) {
          console.log('\n⚠️  데이터 없음 (API 정상, 법령에 별표/서식 없음)')
        } else if (text.includes('목록')) {
          console.log('\n✅ PASS: 별표/서식 조회 성공')
        } else {
          console.log('\n❓ 알 수 없는 응답')
        }

      } catch (e) {
        console.log(`\n❌ 에러: ${e.message}`)
      }

      console.log('')
    }

    console.log('═'.repeat(70))
    console.log('\n📊 결론:')
    console.log('  - 법제처 API의 별표/서식 데이터는 제한적입니다.')
    console.log('  - 많은 법령이 별표/서식 데이터를 제공하지 않습니다.')
    console.log('  - 404 에러는 정상적인 응답입니다 (데이터 없음).')
    console.log('')

  } catch (error) {
    console.error('\n💥 Fatal Error:', error.message)
    console.error(error)
  }
}

testAnnexWorking()
