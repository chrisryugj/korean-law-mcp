#!/usr/bin/env node

/**
 * get_ordinance 툴 단독 테스트
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

let serverProcess = null;

// 서버 시작
function startServer() {
  return new Promise((resolve, reject) => {
    const serverPath = path.join(__dirname, '..', 'build', 'index.js');
    console.log('🚀 Starting MCP server...\n');

    serverProcess = spawn('node', [serverPath], {
      env: { ...process.env, LAW_OC: process.env.LAW_OC },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let initialized = false;

    serverProcess.stderr.on('data', (data) => {
      const output = data.toString();

      // DEBUG 로그 출력
      if (output.includes('[DEBUG]')) {
        console.log(output);
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

    // MCP initialize 핸드셰이크로 기동 확인
    // (서버는 STDIO 모드에서 부팅 로그를 출력하지 않음 — stdout 오염 방지, 99b855d 이후)
    let initBuf = '';
    const onInitData = (data) => {
      initBuf += data.toString();
      for (const line of initBuf.split('\n')) {
        if (!line.trim()) continue;
        try {
          const resp = JSON.parse(line);
          if (resp.id === 'init' && !initialized) {
            initialized = true;
            serverProcess.stdout.removeListener('data', onInitData);
            serverProcess.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
            console.log('✅ Server started\n');
            setTimeout(resolve, 300);
            return;
          }
        } catch (e) {}
      }
    };
    serverProcess.stdout.on('data', onInitData);
    setTimeout(() => {
      serverProcess.stdin.write(JSON.stringify({
        jsonrpc: '2.0', id: 'init', method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } }
      }) + '\n');
    }, 300);
    setTimeout(() => {
      if (!initialized) reject(new Error('initialize timeout (8s)'));
    }, 8000);
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

// 테스트 실행
async function runTest() {
  console.log('========================================');
  console.log('get_ordinance Tool 테스트');
  console.log('========================================\n');

  if (!process.env.LAW_OC) {
    console.error('❌ Error: LAW_OC 환경변수가 설정되지 않았습니다');
    process.exit(1);
  }

  try {
    await startServer();

    // 테스트 케이스 1: 먼저 검색해서 실제 ID 찾기
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Step 1: search_ordinance로 자치법규 검색');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const searchResponse = await sendMCPRequest('search_ordinance', {
      query: '서울특별시',
      display: 3
    });

    if (searchResponse.error) {
      console.log('❌ 검색 실패:', searchResponse.error.message);
      throw new Error('Search failed');
    }

    const searchContent = searchResponse.result.content[0].text;
    console.log('검색 결과:');
    console.log(searchContent);
    console.log('\n');

    // 디버깅: 원본 응답 확인
    console.log('📊 응답 길이:', searchContent.length, '자');
    console.log('📊 응답 미리보기 (처음 200자):');
    console.log(searchContent.substring(0, 200));
    console.log('\n');

    // ID 추출
    const idMatch = searchContent.match(/\[(\d+)\]/);
    if (!idMatch) {
      console.log('⚠️  자치법규일련번호를 찾을 수 없습니다. 다른 검색어로 시도합니다.\n');

      // 다른 검색어로 재시도
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('Step 1-2: 다른 검색어로 재시도 (환경)');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      const retryResponse = await sendMCPRequest('search_ordinance', {
        query: '환경',
        display: 3
      });

      const retryContent = retryResponse.result.content[0].text;
      console.log('검색 결과:');
      console.log(retryContent);
      console.log('\n');

      const retryMatch = retryContent.match(/\[(\d+)\]/);
      if (!retryMatch) {
        console.log('❌ 여전히 자치법규일련번호를 찾을 수 없습니다.');
        console.log('💡 API 응답에 문제가 있을 수 있습니다.\n');

        // 하드코딩된 ID로 시도
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('Step 2: 샘플 ID로 get_ordinance 테스트');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        await testWithSampleIds();
        return;
      }
    }

    const ordinSeq = idMatch ? idMatch[1] : null;

    if (!ordinSeq) {
      await testWithSampleIds();
      return;
    }

    console.log(`📎 추출된 자치법규일련번호: ${ordinSeq}\n`);

    // 테스트 케이스 2: get_ordinance로 전문 조회
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Step 2: get_ordinance로 전문 조회');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const getResponse = await sendMCPRequest('get_ordinance', {
      ordinSeq: ordinSeq
    });

    if (getResponse.error) {
      console.log('❌ 조회 실패:', getResponse.error.message);
    } else if (getResponse.result && getResponse.result.content) {
      const content = getResponse.result.content[0].text;
      const preview = content.length > 500 ? content.substring(0, 500) + '...\n(전체 길이: ' + content.length + '자)' : content;

      console.log('✅ 조회 성공\n');
      console.log('응답 미리보기:');
      console.log('─'.repeat(60));
      console.log(preview);
      console.log('─'.repeat(60));
    } else {
      console.log('⚠️  예상치 못한 응답 형식');
    }

  } catch (error) {
    console.error('\n❌ 오류 발생:', error.message);
  } finally {
    if (serverProcess) {
      serverProcess.kill();
      console.log('\n🛑 Server stopped');
    }
  }
}

// 샘플 ID들로 테스트
async function testWithSampleIds() {
  const sampleIds = ['5000001', '6000001', '7000001'];

  console.log('여러 샘플 ID로 테스트를 시도합니다...\n');

  for (const ordinSeq of sampleIds) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`ordinSeq: ${ordinSeq} 테스트`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const response = await sendMCPRequest('get_ordinance', {
      ordinSeq: ordinSeq
    });

    if (response.error) {
      console.log('❌ 오류:', response.error.message, '\n');
    } else if (response.result && response.result.content) {
      const content = response.result.content[0].text;

      if (content.includes('찾을 수 없습니다')) {
        console.log('⚠️  자치법규를 찾을 수 없음\n');
      } else {
        const preview = content.length > 300 ? content.substring(0, 300) + '...' : content;
        console.log('✅ 성공!');
        console.log('응답 미리보기:');
        console.log('─'.repeat(60));
        console.log(preview);
        console.log('─'.repeat(60));
        console.log('');
        break; // 성공하면 종료
      }
    }
  }
}

// 실행
runTest();
