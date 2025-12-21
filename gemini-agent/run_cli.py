#!/usr/bin/env python3
"""
CLI 모드로 법률 AI 에이전트 실행
웹 서버 없이 터미널에서 직접 테스트
"""

import asyncio
import os
import sys

# 패키지 경로 추가
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv()

from src.agent.legal_agent import LegalAgent


async def main():
    print("=" * 60)
    print("🏛️  법률 AI 에이전트 (Gemini) - CLI 모드")
    print("=" * 60)

    # 환경 변수 확인
    if not os.getenv("GEMINI_API_KEY"):
        print("\n❌ GEMINI_API_KEY가 설정되지 않았습니다.")
        print("   .env 파일을 생성하고 API 키를 추가하세요.")
        return

    mcp_url = os.getenv("MCP_SERVER_URL", "http://localhost:3000")
    print(f"\n📡 MCP 서버: {mcp_url}")

    # 에이전트 초기화
    print("🔄 에이전트 초기화 중...")
    try:
        agent = LegalAgent(mcp_server_url=mcp_url)
        await agent.initialize()
        print("✅ 초기화 완료\n")
    except Exception as e:
        print(f"❌ 초기화 실패: {e}")
        print("\n💡 MCP 서버가 실행 중인지 확인하세요:")
        print("   cd ../  &&  LAW_OC=your-key node build/index.js --mode http")
        return

    print("질문을 입력하세요 (종료: quit 또는 Ctrl+C)\n")
    print("-" * 60)

    while True:
        try:
            question = input("\n👤 질문: ").strip()

            if question.lower() in ["quit", "exit", "q", "종료"]:
                break

            if not question:
                continue

            print("\n🤖 연구 중...\n")

            async for event in agent.research(question):
                if event.type == "thinking":
                    print(f"💭 {event.content}")
                elif event.type == "tool_call":
                    params_str = str(event.tool_params) if event.tool_params else "{}"
                    print(f"🔧 {event.tool_name}({params_str})")
                elif event.type == "tool_result":
                    preview = event.content[:150] + "..." if len(event.content) > 150 else event.content
                    print(f"   → {preview}")
                elif event.type == "answer":
                    print(f"\n{'=' * 60}")
                    print("📋 답변:")
                    print("-" * 60)
                    print(event.content)
                    print("=" * 60)
                elif event.type == "error":
                    print(f"❌ 오류: {event.content}")

        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f"❌ 오류 발생: {e}")

    print("\n👋 종료합니다.")


if __name__ == "__main__":
    asyncio.run(main())
