"""
MCP (Model Context Protocol) 클라이언트
korean-law-mcp 서버와 SSE로 통신
"""

import json
import asyncio
from typing import Any
import httpx
from httpx_sse import aconnect_sse


class MCPClient:
    """MCP 서버 클라이언트 - SSE 프로토콜"""

    def __init__(self, server_url: str = "http://localhost:3000"):
        self.server_url = server_url.rstrip("/")
        self.session_id = None
        self.tools_cache = None

    async def connect(self) -> str:
        """SSE 연결 및 세션 ID 획득"""
        async with httpx.AsyncClient() as client:
            async with aconnect_sse(
                client, "GET", f"{self.server_url}/sse"
            ) as event_source:
                async for event in event_source.aiter_sse():
                    if event.event == "endpoint":
                        # 세션 엔드포인트 수신
                        self.session_id = event.data.split("/")[-1]
                        return self.session_id
                    break
        return None

    async def list_tools(self) -> list[dict]:
        """사용 가능한 도구 목록 조회"""
        if self.tools_cache:
            return self.tools_cache

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{self.server_url}/message",
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/list",
                    "params": {}
                }
            )
            result = response.json()
            self.tools_cache = result.get("result", {}).get("tools", [])
            return self.tools_cache

    async def call_tool(self, tool_name: str, arguments: dict) -> dict:
        """도구 실행"""
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{self.server_url}/message",
                json={
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "tools/call",
                    "params": {
                        "name": tool_name,
                        "arguments": arguments
                    }
                }
            )
            result = response.json()

            if "error" in result:
                return {"error": result["error"]}

            # content 배열에서 텍스트 추출
            content = result.get("result", {}).get("content", [])
            if content and len(content) > 0:
                return {"result": content[0].get("text", "")}

            return {"result": str(result.get("result", {}))}

    def get_tools_description(self) -> str:
        """Gemini에게 전달할 도구 설명 생성"""
        if not self.tools_cache:
            return "도구 목록을 먼저 로드하세요."

        descriptions = []
        for tool in self.tools_cache:
            name = tool.get("name", "unknown")
            desc = tool.get("description", "").split("\n")[0]  # 첫 줄만

            # 파라미터 정보
            schema = tool.get("inputSchema", {})
            props = schema.get("properties", {})
            required = schema.get("required", [])

            params = []
            for prop_name, prop_info in props.items():
                req = "(필수)" if prop_name in required else "(선택)"
                params.append(f"    - {prop_name}: {prop_info.get('description', '')} {req}")

            param_str = "\n".join(params) if params else "    파라미터 없음"
            descriptions.append(f"- {name}: {desc}\n{param_str}")

        return "\n\n".join(descriptions)


# 간편 사용을 위한 싱글톤
_client = None

async def get_mcp_client(server_url: str = "http://localhost:3000") -> MCPClient:
    global _client
    if _client is None:
        _client = MCPClient(server_url)
        await _client.list_tools()
    return _client
