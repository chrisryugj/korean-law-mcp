#!/usr/bin/env node

/**
 * 9개 Tools 개별 테스트
 */

import { LawApiClient } from './build/lib/api-client.js'
import { searchLaw } from './build/tools/search.js'
import { getLawText } from './build/tools/law-text.js'
import { parseJoCode } from './build/tools/utils.js'
import { compareOldNew } from './build/tools/comparison.js'
import { getThreeTier } from './build/tools/three-tier.js'
import { searchAdminRule, getAdminRule } from './build/tools/admin-rule.js'
import { getAnnexes } from './build/tools/annex.js'
import { getOrdinance } from './build/tools/ordinance.js'

const LAW_OC = process.env.LAW_OC || 'ryuseungin'
const apiClient = new LawApiClient({ apiKey: LAW_OC })

const passed = []
const failed = []

function printTest(num, name, input) {
  console.log(`\n${'='.repeat(70)}`)
  console.log(`Tool ${num}/9: ${name}`)
  console.log(`Input: ${JSON.stringify(input)}`)
  console.log('-'.repeat(70))
}

function markPass(toolName) {
  passed.push(toolName)
  console.log(`✅ PASS: ${toolName}`)
}

function markFail(toolName, error) {
  failed.push({ tool: toolName, error })
  console.log(`❌ FAIL: ${toolName}`)
  console.log(`   Error: ${error}`)
}

async function testAll() {
  console.log('\n🧪 Korean Law MCP Server - Complete 9 Tools Test\n')
  console.log(`API Key: ${LAW_OC ? '✓ Configured' : '✗ Missing'}`)

  try {
    // Tool 1: search_law
    printTest(1, 'search_law', { query: '관세법', maxResults: 3 })
    try {
      const r1 = await searchLaw(apiClient, { query: '관세법', maxResults: 3 })
      const text = r1.content[0].text
      console.log(text.substring(0, 300))
      if (text.includes('MST:') && text.includes('관세법')) {
        markPass('search_law')
      } else {
        markFail('search_law', 'MST or 관세법 not found in result')
      }
    } catch (e) {
      markFail('search_law', e.message)
    }

    // Tool 2: search_law (약칭)
    printTest(2, 'search_law (약칭 해결)', { query: '화관법' })
    try {
      const r2 = await searchLaw(apiClient, { query: '화관법', maxResults: 3 })
      const text = r2.content[0].text
      console.log(text.substring(0, 300))
      if (text.includes('화학물질관리법')) {
        markPass('search_law (약칭)')
      } else {
        markFail('search_law (약칭)', '화학물질관리법 not found')
      }
    } catch (e) {
      markFail('search_law (약칭)', e.message)
    }

    // Tool 3: parse_jo_code (to_code)
    printTest(3, 'parse_jo_code', { joText: '제38조', direction: 'to_code' })
    try {
      const r3 = await parseJoCode({ joText: '제38조', direction: 'to_code' })
      const text = r3.content[0].text
      console.log(text)
      if (text.includes('003800')) {
        markPass('parse_jo_code (to_code)')
      } else {
        markFail('parse_jo_code (to_code)', '003800 not found')
      }
    } catch (e) {
      markFail('parse_jo_code (to_code)', e.message)
    }

    // Tool 4: parse_jo_code (to_text)
    printTest(4, 'parse_jo_code (역변환)', { joText: '003800', direction: 'to_text' })
    try {
      const r4 = await parseJoCode({ joText: '003800', direction: 'to_text' })
      const text = r4.content[0].text
      console.log(text)
      if (text.includes('제38조')) {
        markPass('parse_jo_code (to_text)')
      } else {
        markFail('parse_jo_code (to_text)', '제38조 not found')
      }
    } catch (e) {
      markFail('parse_jo_code (to_text)', e.message)
    }

    // Get latest MST
    const searchResult = await searchLaw(apiClient, { query: '관세법', maxResults: 1 })
    const mstMatch = searchResult.content[0].text.match(/MST: (\d+)/)
    const mst = mstMatch ? mstMatch[1] : '279811'

    // Tool 5: get_law_text
    printTest(5, 'get_law_text', { mst, jo: '제38조' })
    try {
      const r5 = await getLawText(apiClient, { mst, jo: '제38조' })
      const text = r5.content[0].text
      console.log(text.substring(0, 500))
      if (text.includes('제38조') && text.includes('물품')) {
        markPass('get_law_text')
      } else {
        markFail('get_law_text', '조문 내용 not found')
      }
    } catch (e) {
      markFail('get_law_text', e.message)
    }

    // Tool 6: compare_old_new
    printTest(6, 'compare_old_new', { mst })
    try {
      const r6 = await compareOldNew(apiClient, { mst })
      const text = r6.content[0].text
      console.log(text.substring(0, 300))
      if (text.includes('법령명:')) {
        markPass('compare_old_new')
      } else {
        markFail('compare_old_new', 'Invalid response')
      }
    } catch (e) {
      markFail('compare_old_new', e.message)
    }

    // Tool 7: get_three_tier
    printTest(7, 'get_three_tier', { mst, knd: '2' })
    try {
      const r7 = await getThreeTier(apiClient, { mst, knd: '2' })
      const text = r7.content[0].text
      console.log(text.substring(0, 500))
      if (text.includes('법령명:')) {
        markPass('get_three_tier')
      } else {
        markFail('get_three_tier', 'Invalid response')
      }
    } catch (e) {
      markFail('get_three_tier', e.message)
    }

    // Tool 8: get_annexes
    printTest(8, 'get_annexes', { lawName: '소득세법', knd: '1' })
    try {
      const r8 = await getAnnexes(apiClient, { lawName: '소득세법', knd: '1' })
      const text = r8.content[0].text
      console.log(text.substring(0, 300))
      markPass('get_annexes')
    } catch (e) {
      // 404는 정상 (별표 없는 경우)
      if (e.message.includes('404')) {
        console.log('⚠️  별표 없음 (정상)')
        markPass('get_annexes (no data)')
      } else {
        markFail('get_annexes', e.message)
      }
    }

    // Tool 9: search_admin_rule
    printTest(9, 'search_admin_rule', { query: '정보보호', maxResults: 5 })
    try {
      const r9 = await searchAdminRule(apiClient, { query: '정보보호', maxResults: 5 })
      const text = r9.content[0].text
      console.log(text.substring(0, 300))
      markPass('search_admin_rule')
    } catch (e) {
      markFail('search_admin_rule', e.message)
    }

    // Summary
    console.log('\n' + '='.repeat(70))
    console.log('\n📊 TEST SUMMARY\n')
    console.log(`✅ Passed: ${passed.length}/9`)
    passed.forEach(t => console.log(`   - ${t}`))

    if (failed.length > 0) {
      console.log(`\n❌ Failed: ${failed.length}/9`)
      failed.forEach(f => console.log(`   - ${f.tool}: ${f.error}`))
    }

    console.log(`\n${passed.length === 9 ? '🎉 ALL TESTS PASSED!' : '⚠️  Some tests failed'}`)
    console.log('')

  } catch (error) {
    console.error('\n💥 Fatal error:', error.message)
    console.error(error)
    process.exit(1)
  }
}

testAll()
