#!/usr/bin/env node

import { LawApiClient } from './build/lib/api-client.js'
import { searchLaw } from './build/tools/search.js'
import { getLawText } from './build/tools/law-text.js'

const LAW_OC = process.env.LAW_OC || 'ryuseungin'
const apiClient = new LawApiClient({ apiKey: LAW_OC })

async function debug() {
  console.log('🔍 Debug: get_law_text 문제 분석\n')

  // 1. 먼저 관세법 검색해서 최신 MST 가져오기
  console.log('Step 1: 관세법 검색')
  const searchResult = await searchLaw(apiClient, { query: "관세법", maxResults: 20 })
  console.log(searchResult.content[0].text.substring(0, 500))

  // 2. 검색 결과에서 첫 번째 MST 추출
  const mstMatch = searchResult.content[0].text.match(/MST: (\d+)/)
  const lawIdMatch = searchResult.content[0].text.match(/법령ID: (\d+)/)

  if (mstMatch) {
    const mst = mstMatch[1]
    const lawId = lawIdMatch ? lawIdMatch[1] : null

    console.log(`\n추출된 MST: ${mst}`)
    console.log(`추출된 법령ID: ${lawId}`)

    // 3. MST로 조문 조회 (조문 번호 없이)
    console.log('\n\nStep 2: MST로 전체 법령 조회')
    try {
      const result1 = await getLawText(apiClient, { mst })
      console.log('✓ 전체 법령 조회 성공:')
      console.log(result1.content[0].text.substring(0, 600))
    } catch (error) {
      console.error('✗ 전체 법령 조회 실패:', error.message)
    }

    // 4. MST + 조문번호로 조회
    console.log('\n\nStep 3: MST + 제38조 조회')
    try {
      const result2 = await getLawText(apiClient, { mst, jo: "제38조" })
      console.log('✓ 조문 조회 성공:')
      console.log(result2.content[0].text.substring(0, 600))
    } catch (error) {
      console.error('✗ 조문 조회 실패:', error.message)
    }

    // 5. 법령ID로 조회
    if (lawId) {
      console.log('\n\nStep 4: 법령ID로 조회')
      try {
        const result3 = await getLawText(apiClient, { lawId })
        console.log('✓ 법령ID 조회 성공:')
        console.log(result3.content[0].text.substring(0, 600))
      } catch (error) {
        console.error('✗ 법령ID 조회 실패:', error.message)
      }
    }
  }
}

debug().catch(console.error)
