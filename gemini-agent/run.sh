#!/bin/bash

# 법률 AI 에이전트 실행 스크립트

set -e

# 환경 변수 로드
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# 필수 환경 변수 확인
if [ -z "$GEMINI_API_KEY" ]; then
    echo "❌ GEMINI_API_KEY가 설정되지 않았습니다."
    echo "   .env 파일에 GEMINI_API_KEY를 추가하세요."
    exit 1
fi

if [ -z "$LAW_OC" ]; then
    echo "❌ LAW_OC (법제처 API 키)가 설정되지 않았습니다."
    echo "   .env 파일에 LAW_OC를 추가하세요."
    exit 1
fi

echo "🏛️ 법률 AI 에이전트 시작"
echo "=" | tr ' ' '='

# MCP 서버 상태 확인
MCP_URL=${MCP_SERVER_URL:-http://localhost:3000}
echo "📡 MCP 서버 확인: $MCP_URL"

if ! curl -s "$MCP_URL/health" > /dev/null 2>&1; then
    echo "⚠️ MCP 서버가 실행 중이 아닙니다."
    echo "   다른 터미널에서 MCP 서버를 먼저 시작하세요:"
    echo ""
    echo "   cd ../korean-law-mcp"
    echo "   LAW_OC=$LAW_OC node build/index.js --mode http"
    echo ""
    read -p "MCP 서버 없이 계속하시겠습니까? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo ""
echo "🚀 API 서버 시작 (http://localhost:8000)"
echo "   웹 UI: http://localhost:8000"
echo ""

# FastAPI 서버 실행
python -m uvicorn src.api.server:app --host 0.0.0.0 --port 8000 --reload
