#!/usr/bin/env node

/**
 * Tool 8 (get_annexes) 지방공무원 복무규정 테스트
 */

import { LawApiClient } from './build/lib/api-client.js'
import { getAnnexes } from './build/tools/annex.js'
import { getLawText } from './build/tools/law-text.js'
import { searchLaw } from './build/tools/search.js'

const LAW_OC = process.env.LAW_OC || 'ryuseungin'
const apiClient = new LawApiClient({ apiKey: LAW_OC })

console.log('🔍 지방공무원 복무규정 제7조의7 테스트\n')

async function testSpecific() {
  try {
    // Step 1: 법령 검색
    console.log('═'.repeat(70))
    console.log('[Step 1] 지방공무원 복무규정 검색')
    console.log('═'.repeat(70))

    const searchResult = await searchLaw(apiClient, {
      query: '지방공무원 복무규정',
      maxResults: 3
    })

    console.log(searchResult.content[0].text.substring(0, 500))

    const mstMatch = searchResult.content[0].text.match(/MST: (\d+)/)
    const mst = mstMatch ? mstMatch[1] : null

    if (!mst) {
      console.log('❌ MST를 찾을 수 없습니다.')
      return
    }

    console.log(`\n✅ MST 발견: ${mst}\n`)

    // Step 2: 제7조의7 조회
    console.log('═'.repeat(70))
    console.log('[Step 2] 제7조의7 조회')
    console.log('═'.repeat(70))

    const lawTextResult = await getLawText(apiClient, {
      mst,
      jo: '제7조의7'
    })

    console.log(lawTextResult.content[0].text)
    console.log('')

    // Step 3: 별표 조회
    console.log('═'.repeat(70))
    console.log('[Step 3] 지방공무원 복무규정 별표 조회')
    console.log('═'.repeat(70))

    const annexResult = await getAnnexes(apiClient, {
      lawName: '지방공무원 복무규정',
      knd: '1'  // 별표
    })

    console.log(annexResult.content[0].text)
    console.log('')

    // Step 4: 서식 조회
    console.log('═'.repeat(70))
    console.log('[Step 4] 지방공무원 복무규정 서식 조회')
    console.log('═'.repeat(70))

    const formResult = await getAnnexes(apiClient, {
      lawName: '지방공무원 복무규정',
      knd: '2'  // 서식
    })

    console.log(formResult.content[0].text)
    console.log('')

    // Step 5: 전체 조회
    console.log('═'.repeat(70))
    console.log('[Step 5] 지방공무원 복무규정 별표/서식 전체 조회')
    console.log('═'.repeat(70))

    const allResult = await getAnnexes(apiClient, {
      lawName: '지방공무원 복무규정'
    })

    console.log(allResult.content[0].text)
    console.log('')

    console.log('═'.repeat(70))
    console.log('✅ 테스트 완료')
    console.log('═'.repeat(70))

  } catch (error) {
    console.error('\n💥 Fatal Error:', error.message)
    console.error(error)
  }
}

testSpecific()
