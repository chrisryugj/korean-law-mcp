"""
Gemini 기반 법률 AI 에이전트
33개 MCP 도구를 자율적으로 선택하여 법률 질문에 답변
"""

import os
import json
import asyncio
from typing import AsyncGenerator
from dataclasses import dataclass
import google.generativeai as genai
from ..utils.mcp_client import MCPClient, get_mcp_client


@dataclass
class AgentEvent:
    """에이전트 이벤트"""
    type: str  # "thinking", "tool_call", "tool_result", "answer", "error"
    content: str
    tool_name: str = None
    tool_params: dict = None


class LegalAgent:
    """Gemini 기반 법률 전문 AI 에이전트"""

    MAX_ITERATIONS = 10  # 최대 루프 횟수

    SYSTEM_PROMPT = """당신은 한국 법률 전문 AI 에이전트입니다.

## 역할
사용자의 법률 질문에 대해 MCP 도구를 활용하여 법령, 판례, 해석례를 조사하고
정확한 답변을 제공합니다.

## 작업 방식
1. 질문을 분석하여 필요한 정보 파악
2. 적절한 도구를 선택하여 정보 수집
3. 수집된 정보가 충분한지 판단
4. 부족하면 추가 도구 호출, 충분하면 답변 생성

## 응답 형식
반드시 다음 JSON 형식으로 응답하세요:

정보 수집이 더 필요한 경우:
```json
{
  "action": "CALL_TOOL",
  "thinking": "현재 상황 분석 및 다음 도구 선택 이유",
  "tool": "도구명",
  "params": {"param1": "value1"}
}
```

충분한 정보가 수집된 경우:
```json
{
  "action": "ANSWER",
  "thinking": "수집된 정보 종합 분석",
  "answer": "사용자에게 전달할 최종 답변 (마크다운 형식)"
}
```

## 주의사항
- 반드시 JSON 형식으로만 응답
- 도구 호출 시 필수 파라미터 확인
- 법령 검색(search_law) 후 조문 조회(get_law_text) 순서 준수
- 출처(법령명, 조문, 판례번호) 항상 명시
"""

    def __init__(
        self,
        gemini_api_key: str = None,
        mcp_server_url: str = "http://localhost:3000"
    ):
        # Gemini 설정
        api_key = gemini_api_key or os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY가 필요합니다")

        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel(
            model_name="gemini-1.5-flash",  # 빠른 응답용
            generation_config={
                "temperature": 0.2,  # 정확도 우선
                "top_p": 0.95,
                "max_output_tokens": 4096,
            }
        )

        self.mcp_server_url = mcp_server_url
        self.mcp_client: MCPClient = None
        self.conversation_history = []

    async def initialize(self):
        """MCP 클라이언트 초기화"""
        self.mcp_client = await get_mcp_client(self.mcp_server_url)
        await self.mcp_client.list_tools()

    async def research(self, question: str) -> AsyncGenerator[AgentEvent, None]:
        """
        법률 연구 수행 (스트리밍)
        도구를 자율적으로 선택하며 루프 실행
        """
        if not self.mcp_client:
            await self.initialize()

        # 도구 설명 생성
        tools_desc = self.mcp_client.get_tools_description()

        # 컨텍스트 초기화
        context = {
            "question": question,
            "tool_results": [],
            "iteration": 0
        }

        yield AgentEvent(
            type="thinking",
            content=f"질문 분석 중: {question}"
        )

        while context["iteration"] < self.MAX_ITERATIONS:
            context["iteration"] += 1

            # Gemini에게 다음 행동 결정 요청
            prompt = self._build_prompt(question, tools_desc, context["tool_results"])

            try:
                response = self.model.generate_content(prompt)
                response_text = response.text.strip()

                # JSON 파싱
                decision = self._parse_response(response_text)

                if decision is None:
                    yield AgentEvent(
                        type="error",
                        content=f"응답 파싱 실패: {response_text[:200]}"
                    )
                    break

                # 사고 과정 전달
                if decision.get("thinking"):
                    yield AgentEvent(
                        type="thinking",
                        content=decision["thinking"]
                    )

                # 행동 결정
                if decision["action"] == "ANSWER":
                    # 최종 답변
                    answer = decision.get("answer", "답변을 생성할 수 없습니다.")
                    yield AgentEvent(
                        type="answer",
                        content=answer
                    )

                    # 대화 기록 저장
                    self.conversation_history.append({
                        "role": "user",
                        "content": question
                    })
                    self.conversation_history.append({
                        "role": "assistant",
                        "content": answer
                    })
                    return

                elif decision["action"] == "CALL_TOOL":
                    tool_name = decision.get("tool")
                    tool_params = decision.get("params", {})

                    yield AgentEvent(
                        type="tool_call",
                        content=f"도구 호출: {tool_name}",
                        tool_name=tool_name,
                        tool_params=tool_params
                    )

                    # 도구 실행
                    result = await self.mcp_client.call_tool(tool_name, tool_params)

                    # 결과 저장
                    result_text = result.get("result", result.get("error", "결과 없음"))
                    context["tool_results"].append({
                        "tool": tool_name,
                        "params": tool_params,
                        "result": result_text[:2000]  # 토큰 제한
                    })

                    yield AgentEvent(
                        type="tool_result",
                        content=result_text[:500] + ("..." if len(result_text) > 500 else ""),
                        tool_name=tool_name
                    )

                else:
                    yield AgentEvent(
                        type="error",
                        content=f"알 수 없는 action: {decision['action']}"
                    )
                    break

            except Exception as e:
                yield AgentEvent(
                    type="error",
                    content=f"오류 발생: {str(e)}"
                )
                break

        # 최대 반복 도달 시
        if context["iteration"] >= self.MAX_ITERATIONS:
            yield AgentEvent(
                type="answer",
                content=self._generate_fallback_answer(context)
            )

    def _build_prompt(self, question: str, tools_desc: str, tool_results: list) -> str:
        """Gemini 프롬프트 생성"""

        results_text = ""
        if tool_results:
            results_text = "\n\n## 수집된 정보\n"
            for i, r in enumerate(tool_results, 1):
                results_text += f"\n### [{i}] {r['tool']}({r['params']})\n"
                results_text += f"```\n{r['result']}\n```\n"

        return f"""
{self.SYSTEM_PROMPT}

## 사용 가능한 도구
{tools_desc}

## 사용자 질문
{question}
{results_text}

## 지시사항
위 정보를 바탕으로 다음 행동을 결정하세요.
- 추가 정보가 필요하면 적절한 도구를 선택하세요
- 충분한 정보가 있으면 답변을 작성하세요
- 반드시 JSON 형식으로 응답하세요
"""

    def _parse_response(self, response_text: str) -> dict | None:
        """Gemini 응답에서 JSON 추출"""
        try:
            # JSON 블록 추출
            if "```json" in response_text:
                start = response_text.find("```json") + 7
                end = response_text.find("```", start)
                json_str = response_text[start:end].strip()
            elif "```" in response_text:
                start = response_text.find("```") + 3
                end = response_text.find("```", start)
                json_str = response_text[start:end].strip()
            else:
                # JSON 직접 시도
                json_str = response_text

            return json.loads(json_str)
        except json.JSONDecodeError:
            return None

    def _generate_fallback_answer(self, context: dict) -> str:
        """최대 반복 도달 시 폴백 답변 생성"""
        if not context["tool_results"]:
            return "죄송합니다. 정보를 수집하는 데 문제가 발생했습니다."

        answer = f"## 질문: {context['question']}\n\n"
        answer += "## 수집된 정보\n\n"

        for r in context["tool_results"]:
            answer += f"**{r['tool']}**: {r['result'][:300]}...\n\n"

        answer += "\n> ⚠️ 추가 분석이 필요할 수 있습니다."
        return answer

    async def ask(self, question: str) -> str:
        """단순 질문-응답 (스트리밍 없이)"""
        answer = ""
        async for event in self.research(question):
            if event.type == "answer":
                answer = event.content
        return answer

    def clear_history(self):
        """대화 기록 초기화"""
        self.conversation_history = []


# CLI 테스트용
async def main():
    import sys

    agent = LegalAgent()
    await agent.initialize()

    print("=" * 50)
    print("🏛️ 법률 AI 에이전트 (Gemini)")
    print("=" * 50)
    print("질문을 입력하세요 (종료: quit)\n")

    while True:
        try:
            question = input("👤 질문: ").strip()
            if question.lower() in ["quit", "exit", "q"]:
                break
            if not question:
                continue

            print("\n🤖 연구 중...\n")

            async for event in agent.research(question):
                if event.type == "thinking":
                    print(f"💭 {event.content}")
                elif event.type == "tool_call":
                    print(f"🔧 {event.tool_name}({event.tool_params})")
                elif event.type == "tool_result":
                    print(f"   → {event.content[:100]}...")
                elif event.type == "answer":
                    print(f"\n📋 답변:\n{event.content}")
                elif event.type == "error":
                    print(f"❌ 오류: {event.content}")

            print("\n" + "-" * 50 + "\n")

        except KeyboardInterrupt:
            break

    print("\n👋 종료합니다.")


if __name__ == "__main__":
    asyncio.run(main())
