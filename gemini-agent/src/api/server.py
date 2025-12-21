"""
법률 AI 에이전트 API 서버
FastAPI + WebSocket 실시간 스트리밍
"""

import os
import json
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from ..agent.legal_agent import LegalAgent


# 세션별 에이전트 관리
agents: dict[str, LegalAgent] = {}


def get_agent(session_id: str) -> LegalAgent:
    """세션별 에이전트 생성/조회"""
    if session_id not in agents:
        mcp_url = os.getenv("MCP_SERVER_URL", "http://localhost:3000")
        agents[session_id] = LegalAgent(mcp_server_url=mcp_url)
    return agents[session_id]


@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 시작/종료 시 실행"""
    print("🚀 법률 AI 에이전트 서버 시작")
    yield
    print("👋 서버 종료")
    agents.clear()


app = FastAPI(
    title="법률 AI 에이전트 API",
    description="Gemini 기반 한국 법률 전문 AI 에이전트",
    version="1.0.0",
    lifespan=lifespan
)

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- 요청/응답 모델 ---

class QuestionRequest(BaseModel):
    question: str
    session_id: Optional[str] = "default"


class AnswerResponse(BaseModel):
    answer: str
    tools_used: list[str]
    session_id: str


# --- API 엔드포인트 ---

@app.get("/health")
async def health_check():
    """헬스 체크"""
    return {"status": "healthy", "service": "legal-ai-agent"}


@app.post("/api/ask", response_model=AnswerResponse)
async def ask_question(request: QuestionRequest):
    """
    법률 질문 API (비스트리밍)
    질문을 받아 최종 답변 반환
    """
    agent = get_agent(request.session_id)

    try:
        await agent.initialize()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"에이전트 초기화 실패: {str(e)}")

    tools_used = []
    answer = ""

    try:
        async for event in agent.research(request.question):
            if event.type == "tool_call":
                tools_used.append(event.tool_name)
            elif event.type == "answer":
                answer = event.content
            elif event.type == "error":
                raise HTTPException(status_code=500, detail=event.content)

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return AnswerResponse(
        answer=answer,
        tools_used=list(set(tools_used)),
        session_id=request.session_id
    )


@app.websocket("/ws/chat/{session_id}")
async def websocket_chat(websocket: WebSocket, session_id: str):
    """
    WebSocket 실시간 채팅
    도구 호출 과정을 실시간으로 스트리밍
    """
    await websocket.accept()

    agent = get_agent(session_id)

    try:
        await agent.initialize()
    except Exception as e:
        await websocket.send_json({
            "type": "error",
            "content": f"에이전트 초기화 실패: {str(e)}"
        })
        await websocket.close()
        return

    try:
        while True:
            # 질문 수신
            data = await websocket.receive_text()

            try:
                message = json.loads(data)
                question = message.get("question", data)
            except json.JSONDecodeError:
                question = data

            # 연구 시작
            await websocket.send_json({
                "type": "start",
                "content": f"질문 수신: {question}"
            })

            # 에이전트 실행 (스트리밍)
            async for event in agent.research(question):
                await websocket.send_json({
                    "type": event.type,
                    "content": event.content,
                    "tool_name": event.tool_name,
                    "tool_params": event.tool_params
                })

            await websocket.send_json({
                "type": "end",
                "content": "연구 완료"
            })

    except WebSocketDisconnect:
        print(f"WebSocket 연결 해제: {session_id}")
    except Exception as e:
        await websocket.send_json({
            "type": "error",
            "content": str(e)
        })


@app.delete("/api/session/{session_id}")
async def clear_session(session_id: str):
    """세션 초기화"""
    if session_id in agents:
        agents[session_id].clear_history()
        del agents[session_id]
    return {"status": "cleared", "session_id": session_id}


# --- 웹 UI ---

@app.get("/", response_class=HTMLResponse)
async def web_ui():
    """간단한 웹 채팅 UI"""
    return """
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>법률 AI 에이전트</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #1a1a2e;
            color: #eee;
            min-height: 100vh;
        }
        .container {
            max-width: 900px;
            margin: 0 auto;
            padding: 20px;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        header {
            text-align: center;
            padding: 20px 0;
            border-bottom: 1px solid #333;
        }
        header h1 { font-size: 1.8em; color: #4fc3f7; }
        header p { color: #888; margin-top: 5px; }

        .chat-area {
            flex: 1;
            overflow-y: auto;
            padding: 20px 0;
        }
        .message {
            margin-bottom: 15px;
            padding: 12px 16px;
            border-radius: 12px;
            max-width: 85%;
        }
        .user-message {
            background: #0d47a1;
            margin-left: auto;
            border-bottom-right-radius: 4px;
        }
        .agent-message {
            background: #2d2d44;
            border-bottom-left-radius: 4px;
        }
        .tool-message {
            background: #1b5e20;
            font-size: 0.85em;
            padding: 8px 12px;
            max-width: 70%;
        }
        .thinking-message {
            background: #4a148c;
            font-size: 0.85em;
            font-style: italic;
            padding: 8px 12px;
            max-width: 70%;
        }
        .error-message {
            background: #b71c1c;
        }

        .input-area {
            display: flex;
            gap: 10px;
            padding: 15px 0;
            border-top: 1px solid #333;
        }
        .input-area input {
            flex: 1;
            padding: 14px 18px;
            border: none;
            border-radius: 25px;
            background: #2d2d44;
            color: #fff;
            font-size: 1em;
        }
        .input-area input:focus {
            outline: 2px solid #4fc3f7;
        }
        .input-area button {
            padding: 14px 28px;
            border: none;
            border-radius: 25px;
            background: #4fc3f7;
            color: #1a1a2e;
            font-weight: bold;
            cursor: pointer;
            transition: background 0.2s;
        }
        .input-area button:hover {
            background: #81d4fa;
        }
        .input-area button:disabled {
            background: #555;
            cursor: not-allowed;
        }

        .status {
            text-align: center;
            padding: 5px;
            color: #888;
            font-size: 0.85em;
        }
        .status.connected { color: #4caf50; }
        .status.disconnected { color: #f44336; }

        pre {
            background: #1a1a2e;
            padding: 10px;
            border-radius: 6px;
            overflow-x: auto;
            margin-top: 10px;
        }
        code { color: #4fc3f7; }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>⚖️ 법률 AI 에이전트</h1>
            <p>Gemini 기반 한국 법률 전문 AI</p>
        </header>

        <div id="status" class="status disconnected">연결 중...</div>

        <div id="chat" class="chat-area"></div>

        <div class="input-area">
            <input type="text" id="input" placeholder="법률 질문을 입력하세요..." autofocus>
            <button id="send" onclick="sendMessage()">전송</button>
        </div>
    </div>

    <script>
        const sessionId = 'session-' + Math.random().toString(36).substr(2, 9);
        let ws;
        let isProcessing = false;

        function connect() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            ws = new WebSocket(`${protocol}//${window.location.host}/ws/chat/${sessionId}`);

            ws.onopen = () => {
                document.getElementById('status').textContent = '연결됨';
                document.getElementById('status').className = 'status connected';
            };

            ws.onclose = () => {
                document.getElementById('status').textContent = '연결 끊김 - 재연결 중...';
                document.getElementById('status').className = 'status disconnected';
                setTimeout(connect, 3000);
            };

            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                handleMessage(data);
            };
        }

        function handleMessage(data) {
            const chat = document.getElementById('chat');

            if (data.type === 'thinking') {
                addMessage(data.content, 'thinking-message');
            } else if (data.type === 'tool_call') {
                addMessage(`🔧 ${data.tool_name}(${JSON.stringify(data.tool_params || {})})`, 'tool-message');
            } else if (data.type === 'tool_result') {
                addMessage(`→ ${data.content}`, 'tool-message');
            } else if (data.type === 'answer') {
                addMessage(data.content, 'agent-message', true);
            } else if (data.type === 'error') {
                addMessage(`❌ ${data.content}`, 'error-message');
            } else if (data.type === 'end') {
                isProcessing = false;
                document.getElementById('send').disabled = false;
                document.getElementById('input').disabled = false;
            }

            chat.scrollTop = chat.scrollHeight;
        }

        function addMessage(content, className, isMarkdown = false) {
            const chat = document.getElementById('chat');
            const div = document.createElement('div');
            div.className = `message ${className}`;

            if (isMarkdown) {
                // 간단한 마크다운 처리
                content = content
                    .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
                    .replace(/\\n/g, '<br>')
                    .replace(/`([^`]+)`/g, '<code>$1</code>')
                    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
                    .replace(/^- (.+)$/gm, '• $1<br>');
                div.innerHTML = content;
            } else {
                div.textContent = content;
            }

            chat.appendChild(div);
        }

        function sendMessage() {
            const input = document.getElementById('input');
            const question = input.value.trim();

            if (!question || isProcessing) return;

            addMessage(question, 'user-message');
            input.value = '';

            isProcessing = true;
            document.getElementById('send').disabled = true;
            document.getElementById('input').disabled = true;

            ws.send(JSON.stringify({ question }));
        }

        document.getElementById('input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendMessage();
        });

        connect();
    </script>
</body>
</html>
"""


# 실행
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
