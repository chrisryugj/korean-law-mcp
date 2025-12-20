#!/usr/bin/env node

/**
 * 전체 툴 테스트 스크립트 (1~20번)
 * 각 툴을 순차적으로 실행하여 정상 동작 확인
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// .env 파일 로드
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const lines = envContent.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, value] = trimmed.split('=');
        if (key && value) {
          process.env[key.trim()] = value.trim();
        }
      }
    }
  }
}

loadEnv();

// 서버 프로세스
let serverProcess = null;

// 각 테스트 케이스
const tests = [
  {
    name: '1. search_law',
    tool: 'search_law',
    args: { query: '관세법', maxResults: 5 }
  },
  {
    name: '2. get_law_text',
    tool: 'get_law_text',
    args: { mst: '279811', jo: '제38조' }  // 올바른 MST 사용
  },
  {
    name: '3. parse_jo_code',
    tool: 'parse_jo_code',
    args: { joText: '제38조', direction: 'to_code' }
  },
  {
    name: '4. compare_old_new',
    tool: 'compare_old_new',
    args: { mst: '279811' }  // 올바른 MST 사용
  },
  {
    name: '5. get_three_tier',
    tool: 'get_three_tier',
    args: { mst: '279811', knd: '2' }  // 올바른 MST 사용
  },
  {
    name: '6. search_admin_rule',
    tool: 'search_admin_rule',
    args: { query: '관세', maxResults: 5 }
  },
  {
    name: '7. get_admin_rule',
    tool: 'get_admin_rule',
    args: null,  // Will be filled from test 6 results
    dependsOn: 6,
    extractId: true,
    idType: 'adminRuleSeq'  // 행정규칙일련번호 추출
  },
  {
    name: '8. get_annexes',
    tool: 'get_annexes',
    args: { lawName: '관세법', knd: '1' }
  },
  {
    name: '9. get_ordinance',
    tool: 'get_ordinance',
    args: { ordinSeq: '5000001' },  // 샘플 자치법규일련번호
    skipExtraction: true  // ID 추출 건너뛰기
  },
  {
    name: '10. search_ordinance',
    tool: 'search_ordinance',
    args: { query: '환경', display: 5 }  // 더 구체적인 검색어
  },
  {
    name: '11. compare_articles',
    tool: 'compare_articles',
    args: {
      law1: { mst: '279811', jo: '제38조' },  // 올바른 MST 사용
      law2: { mst: '279811', jo: '제39조' }
    }
  },
  {
    name: '12. get_law_tree',
    tool: 'get_law_tree',
    args: { mst: '279811' }  // 올바른 MST 사용
  },
  {
    name: '13. search_all',
    tool: 'search_all',
    args: { query: '환경', maxResults: 3 }
  },
  {
    name: '14. suggest_law_names',
    tool: 'suggest_law_names',
    args: { partial: '관세' }
  },
  {
    name: '15. search_precedents',
    tool: 'search_precedents',
    args: { query: '자동차', display: 5 }
  },
  {
    name: '16. get_precedent_text',
    tool: 'get_precedent_text',
    args: null,  // Will be filled from test 15 results
    dependsOn: 15,
    extractId: true
  },
  {
    name: '17. search_interpretations',
    tool: 'search_interpretations',
    args: { query: '근로기준법', display: 5 }
  },
  {
    name: '18. get_interpretation_text',
    tool: 'get_interpretation_text',
    args: null,  // Will be filled from test 17 results
    dependsOn: 17,
    extractId: true
  },
  {
    name: '19. get_batch_articles',
    tool: 'get_batch_articles',
    args: { mst: '279811', articles: ['제38조', '제39조', '제40조'] }  // 올바른 MST 사용
  },
  {
    name: '20. get_article_with_precedents',
    tool: 'get_article_with_precedents',
    args: { mst: '279811', jo: '제38조', includePrecedents: true }  // 올바른 MST 사용
  }
];

// 서버 시작
function startServer() {
  return new Promise((resolve, reject) => {
    const serverPath = path.join(__dirname, '..', 'build', 'index.js');
    console.log('🚀 Starting MCP server...');

    serverProcess = spawn('node', [serverPath], {
      env: { ...process.env, LAW_OC: process.env.LAW_OC },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let initialized = false;

    serverProcess.stderr.on('data', (data) => {
      const output = data.toString();
      if (output.includes('running on stdio') && !initialized) {
        initialized = true;
        console.log('✅ Server started\n');
        setTimeout(resolve, 500);
      }
    });

    serverProcess.on('error', (error) => {
      reject(error);
    });

    serverProcess.on('exit', (code) => {
      if (!initialized) {
        reject(new Error(`Server exited prematurely with code ${code}`));
      }
    });
  });
}

// MCP 요청 전송
function sendMCPRequest(toolName, args) {
  return new Promise((resolve, reject) => {
    const request = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args
      }
    };

    const requestString = JSON.stringify(request) + '\n';

    let responseData = '';

    const dataHandler = (data) => {
      responseData += data.toString();

      try {
        const lines = responseData.split('\n').filter(line => line.trim());
        for (const line of lines) {
          const response = JSON.parse(line);
          if (response.id === request.id) {
            serverProcess.stdout.removeListener('data', dataHandler);
            resolve(response);
            return;
          }
        }
      } catch (e) {
        // 아직 완전한 JSON이 아님, 계속 대기
      }
    };

    serverProcess.stdout.on('data', dataHandler);

    serverProcess.stdin.write(requestString);

    setTimeout(() => {
      serverProcess.stdout.removeListener('data', dataHandler);
      reject(new Error('Request timeout'));
    }, 10000);
  });
}

// ID 추출 헬퍼 함수
function extractIdFromResponse(content, testIndex, idType) {
  // test 6 (행정규칙 검색) - 행정규칙일련번호 추출
  if (testIndex === 6 && idType === 'adminRuleSeq') {
    const match = content.match(/행정규칙일련번호: (\d+)/);
    if (match) return match[1];
  }

  // test 10 (자치법규 검색) - ordinSeq 추출
  if (testIndex === 10) {
    // 출력 형식: [자치법규일련번호] 자치법규명
    const match = content.match(/\[(\d+)\]/);
    if (match) return match[1];
  }

  // test 15 (판례 검색) - 판례ID 추출
  if (testIndex === 15) {
    const match = content.match(/\[(\d+)\]/);
    if (match) return match[1];
  }

  // test 17 (해석례 검색) - 해석례ID 추출
  if (testIndex === 17) {
    const match = content.match(/\[(\d+)\]/);
    if (match) return match[1];
  }

  return null;
}

// 단일 테스트 실행
async function runTest(test, index, total, previousResults) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[${index}/${total}] ${test.name}`);
  console.log(`${'='.repeat(60)}`);

  // ID 추출이 필요한 경우
  if (test.extractId && test.dependsOn) {
    const dependentResult = previousResults[test.dependsOn - 1];
    if (!dependentResult || !dependentResult.success) {
      console.log('⏭️  Skipped (dependent test failed)');
      return { success: false, skipped: true, error: 'Dependent test failed' };
    }

    const content = dependentResult.data.content[0].text;
    const extractedId = extractIdFromResponse(content, test.dependsOn, test.idType);

    if (!extractedId) {
      console.log('⏭️  Skipped (could not extract ID from previous test)');
      return { success: false, skipped: true, error: 'Could not extract ID' };
    }

    // ID에 따라 args 설정
    if (test.name.includes('admin_rule')) {
      test.args = { id: extractedId };  // 행정규칙일련번호
    } else if (test.name.includes('ordinance')) {
      test.args = { ordinSeq: extractedId };
    } else if (test.name.includes('precedent')) {
      test.args = { id: extractedId };
    } else if (test.name.includes('interpretation')) {
      test.args = { id: extractedId };
    }

    console.log(`📎 Extracted ID from test ${test.dependsOn}: ${extractedId}`);
  }

  console.log(`Tool: ${test.tool}`);
  console.log(`Args:`, JSON.stringify(test.args, null, 2));
  console.log('');

  try {
    const response = await sendMCPRequest(test.tool, test.args);

    if (response.error) {
      console.log('❌ Error:', response.error.message);
      return { success: false, error: response.error.message };
    }

    if (response.result && response.result.content) {
      const content = response.result.content[0].text;
      const preview = content.length > 300 ? content.substring(0, 300) + '...' : content;
      console.log('✅ Success');
      console.log('Response preview:');
      console.log(preview);
      return { success: true, data: response.result };
    }

    console.log('⚠️  Unexpected response format');
    return { success: false, error: 'Unexpected response format' };

  } catch (error) {
    console.log('❌ Exception:', error.message);
    return { success: false, error: error.message };
  }
}

// 메인 테스트 실행기
async function runAllTests() {
  console.log('========================================');
  console.log('Korean Law MCP - 전체 툴 테스트');
  console.log('========================================\n');

  if (!process.env.LAW_OC) {
    console.error('❌ Error: LAW_OC 환경변수가 설정되지 않았습니다');
    process.exit(1);
  }

  const results = [];

  try {
    await startServer();

    for (let i = 0; i < tests.length; i++) {
      const result = await runTest(tests[i], i + 1, tests.length, results);
      results.push({ test: tests[i].name, ...result });

      // API 요청 간 대기 (rate limit 방지)
      if (!result.skipped) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
  } finally {
    if (serverProcess) {
      serverProcess.kill();
      console.log('\n🛑 Server stopped');
    }
  }

  // 결과 요약
  console.log('\n\n========================================');
  console.log('Test Summary');
  console.log('========================================\n');

  const skippedCount = results.filter(r => r.skipped).length;
  const successCount = results.filter(r => r.success && !r.skipped).length;
  const failCount = results.filter(r => !r.success).length;

  console.log(`Total: ${results.length}`);
  console.log(`✅ Passed: ${successCount}`);
  console.log(`⏭️  Skipped: ${skippedCount}`);
  console.log(`❌ Failed: ${failCount}`);

  if (failCount > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.success).forEach(r => {
      console.log(`  - ${r.test}: ${r.error}`);
    });
  }

  console.log('');
  process.exit(failCount > 0 ? 1 : 0);
}

// 실행
runAllTests();
