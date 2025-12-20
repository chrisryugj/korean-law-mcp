#!/usr/bin/env node

/**
 * get_admin_rule 툴 상세 테스트
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

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
      if (output.includes('[DEBUG]')) {
        console.log(output);
      }
      if (output.includes('running on stdio') && !initialized) {
        initialized = true;
        console.log('✅ Server started\n');
        setTimeout(resolve, 500);
      }
    });

    serverProcess.on('error', reject);
    serverProcess.on('exit', (code) => {
      if (!initialized) {
        reject(new Error(`Server exited with code ${code}`));
      }
    });
  });
}

function sendMCPRequest(toolName, args) {
  return new Promise((resolve, reject) => {
    const request = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args }
    };

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
      } catch (e) {}
    };

    serverProcess.stdout.on('data', dataHandler);
    serverProcess.stdin.write(JSON.stringify(request) + '\n');

    setTimeout(() => {
      serverProcess.stdout.removeListener('data', dataHandler);
      reject(new Error('Timeout'));
    }, 10000);
  });
}

async function runTest() {
  console.log('========================================');
  console.log('get_admin_rule 상세 테스트');
  console.log('========================================\n');

  if (!process.env.LAW_OC) {
    console.error('❌ LAW_OC 환경변수 없음');
    process.exit(1);
  }

  try {
    await startServer();

    // 1. 행정규칙 검색
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Step 1: search_admin_rule');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const searchResp = await sendMCPRequest('search_admin_rule', {
      query: '관세',
      maxResults: 5
    });

    const searchContent = searchResp.result.content[0].text;
    console.log(searchContent);
    console.log('\n');

    // ID 추출 (행정규칙일련번호 사용)
    const seqMatches = searchContent.matchAll(/행정규칙일련번호: (\d+)/g);
    const ids = [...seqMatches].map(m => m[1]);

    console.log(`📎 추출된 행정규칙일련번호 목록: ${ids.join(', ')}\n`);

    // 2. 각 일련번호로 get_admin_rule 테스트
    for (const id of ids.slice(0, 3)) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`Step 2: get_admin_rule(id="${id}")`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      const getResp = await sendMCPRequest('get_admin_rule', { id });

      if (getResp.error) {
        console.log('❌ 오류:', getResp.error.message);
      } else if (getResp.result && getResp.result.content) {
        const content = getResp.result.content[0].text;

        if (content.includes('찾을 수 없습니다')) {
          console.log('⚠️  데이터 없음:', content);
        } else {
          const preview = content.substring(0, 400);
          console.log('✅ 성공!');
          console.log('─'.repeat(60));
          console.log(preview + '...');
          console.log('─'.repeat(60));
        }
      }
      console.log('\n');

      await new Promise(r => setTimeout(r, 1000));
    }

  } catch (error) {
    console.error('\n❌ 오류:', error.message);
  } finally {
    if (serverProcess) {
      serverProcess.kill();
      console.log('\n🛑 Server stopped');
    }
  }
}

runTest();
