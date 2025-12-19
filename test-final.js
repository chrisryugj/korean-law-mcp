#!/usr/bin/env node

import { LawApiClient } from './build/lib/api-client.js'
import { searchLaw } from './build/tools/search.js'
import { getLawText } from './build/tools/law-text.js'
import { parseJoCode } from './build/tools/utils.js'

const LAW_OC = process.env.LAW_OC || 'ryuseungin'
const apiClient = new LawApiClient({ apiKey: LAW_OC })

async function finalTest() {
  console.log('🎯 Final Test - 관세법 제38조 완전 테스트\n')

  // 1. 관세법 검색
  console.log('Step 1: 관세법 검색')
  const searchResult = await searchLaw(apiClient, { query: "관세법", maxResults: 1 })
  const mstMatch = searchResult.content[0].text.match(/MST: (\d+)/)
  const mst = mstMatch[1]
  console.log(`✓ 최신 MST: ${mst}\n`)

  // 2. 제38조 조회 (한글)
  console.log('Step 2: 제38조 조회 (한글 조문 번호)')
  const result1 = await getLawText(apiClient, { mst, jo: "제38조" })
  console.log(result1.content[0].text)
  console.log('='.repeat(60) + '\n')

  // 3. 제38조 조회 (JO 코드)
  console.log('Step 3: 제38조 조회 (JO 코드 003800)')
  const result2 = await getLawText(apiClient, { mst, jo: "003800" })
  console.log(result2.content[0].text)
  console.log('='.repeat(60) + '\n')

  // 4. 전체 법령 조회 (조문 번호 없이)
  console.log('Step 4: 전체 법령 조회 (첫 5개 조문)')
  const result3 = await getLawText(apiClient, { mst })
  const fullText = result3.content[0].text
  console.log(fullText.substring(0, 1500))
  
  if (fullText.includes('제38조') || fullText.includes('제1조')) {
    console.log('\n✅ SUCCESS! 법령 내용이 정상적으로 파싱되었습니다!')
  } else {
    console.log('\n⚠️ WARNING: 조문 내용 확인 필요')
  }
}

finalTest().catch(console.error)
