#!/usr/bin/env node

/**
 * Tool 8 (get_annexes) 조례 테스트 - 광진구 복무조례
 */

import { LawApiClient } from './build/lib/api-client.js'
import { getAnnexes } from './build/tools/annex.js'
import { searchLaw } from './build/tools/search.js'

const LAW_OC = process.env.LAW_OC || 'ryuseungin'
const apiClient = new LawApiClient({ apiKey: LAW_OC })

console.log('🔍 광진구 복무조례 별표 테스트\n')

async function testOrdinance() {
  try {
    // Step 1: 조례 검색
    console.log('═'.repeat(70))
    console.log('[Step 1] 광진구 복무조례 검색')
    console.log('═'.repeat(70))

    const searchResult = await searchLaw(apiClient, {
      query: '광진구 복무 조례',
      maxResults: 5
    })

    console.log(searchResult.content[0].text)
    console.log('')

    // Step 2: 별표 조회 (다양한 이름 시도)
    const testCases = [
      { lawName: '광진구 복무 조례', desc: '광진구 복무 조례' },
      { lawName: '서울특별시 광진구 공무원 복무 조례', desc: '서울특별시 광진구 공무원 복무 조례' },
      { lawName: '서울특별시광진구공무원복무조례', desc: '서울특별시광진구공무원복무조례 (띄어쓰기 없음)' },
      { lawName: '광진구 공무원 복무 조례', desc: '광진구 공무원 복무 조례' },
    ]

    for (const tc of testCases) {
      console.log('═'.repeat(70))
      console.log(`[Test] ${tc.desc}`)
      console.log('═'.repeat(70))

      try {
        // 별표 조회
        const annexResult = await getAnnexes(apiClient, {
          lawName: tc.lawName,
          knd: '1'
        })

        console.log(annexResult.content[0].text)
        console.log('')

        if (!annexResult.content[0].text.includes('없습니다')) {
          console.log('✅ 성공! 별표 발견')
          break
        }

      } catch (e) {
        console.log(`❌ 에러: ${e.message}`)
      }

      console.log('')
    }

    console.log('═'.repeat(70))
    console.log('✅ 테스트 완료')
    console.log('═'.repeat(70))

  } catch (error) {
    console.error('\n💥 Fatal Error:', error.message)
    console.error(error)
  }
}

testOrdinance()
