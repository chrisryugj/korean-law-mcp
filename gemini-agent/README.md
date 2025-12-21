# 법률 AI 에이전트 (Gemini)

Gemini API와 korean-law-mcp를 활용한 한국 법률 전문 AI 에이전트입니다.

## 특징

- **자율적 도구 선택**: Gemini가 33개 MCP 도구 중 필요한 것을 자동 선택
- **도구 루핑**: 충분한 정보를 수집할 때까지 반복적으로 도구 호출
- **실시간 스트리밍**: WebSocket으로 도구 실행 과정 실시간 전송
- **웹 UI 포함**: 브라우저에서 바로 사용 가능한 채팅 인터페이스

## 아키텍처

```
사용자 → 웹 UI/API → Gemini 에이전트 → MCP 클라이언트 → korean-law-mcp → 법제처 API
           ↑                                    ↓
           └──────── 도구 결과 스트리밍 ────────┘
```

## 시작하기

### 1. 환경 설정

```bash
cd gemini-agent

# 가상환경 생성 (권장)
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 의존성 설치
pip install -r requirements.txt

# 환경 변수 설정
cp .env.example .env
# .env 파일 편집하여 API 키 입력
```

### 2. API 키 발급

1. **Gemini API 키**: https://aistudio.google.com/app/apikey
2. **법제처 API 키**: https://www.law.go.kr/DRF/lawService.do

### 3. MCP 서버 실행

```bash
# 터미널 1: MCP 서버
cd ../  # korean-law-mcp 디렉토리로 이동
npm run build
LAW_OC=your-law-api-key node build/index.js --mode http
```

### 4. 에이전트 실행

```bash
# 터미널 2: 에이전트 서버
cd gemini-agent

# 방법 1: 웹 서버 모드
./run.sh
# 또는
python -m uvicorn src.api.server:app --reload

# 방법 2: CLI 모드 (테스트용)
python run_cli.py
```

### 5. 접속

- **웹 UI**: http://localhost:8000
- **API**: http://localhost:8000/docs (Swagger)
- **WebSocket**: ws://localhost:8000/ws/chat/{session_id}

## 사용 예시

### 웹 UI
브라우저에서 http://localhost:8000 접속 후 질문 입력

### API 호출

```python
import requests

response = requests.post(
    "http://localhost:8000/api/ask",
    json={
        "question": "관세법 제38조 수정신고 기한은?",
        "session_id": "user-123"
    }
)
print(response.json())
```

### WebSocket (실시간)

```javascript
const ws = new WebSocket("ws://localhost:8000/ws/chat/session-123");

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log(data.type, data.content);
};

ws.send(JSON.stringify({ question: "화관법 위반 시 벌칙은?" }));
```

## 파일 구조

```
gemini-agent/
├── src/
│   ├── agent/
│   │   └── legal_agent.py   # Gemini 에이전트 핵심 로직
│   ├── api/
│   │   └── server.py        # FastAPI 서버 + 웹 UI
│   └── utils/
│       └── mcp_client.py    # MCP 클라이언트
├── requirements.txt
├── run.sh                   # 실행 스크립트
├── run_cli.py               # CLI 테스트
└── .env.example             # 환경 변수 예제
```

## 에이전트 동작 방식

```
1. 질문 수신
   ↓
2. Gemini에게 다음 행동 결정 요청
   ↓
3. CALL_TOOL인 경우:
   - MCP 도구 호출
   - 결과 저장
   - 2번으로 돌아가기
   ↓
4. ANSWER인 경우:
   - 최종 답변 생성
   - 사용자에게 반환
```

## 설정 옵션

### 에이전트 설정 (legal_agent.py)

```python
class LegalAgent:
    MAX_ITERATIONS = 10  # 최대 루프 횟수

    # Gemini 모델 설정
    model = genai.GenerativeModel(
        model_name="gemini-1.5-flash",  # 또는 "gemini-1.5-pro"
        generation_config={
            "temperature": 0.2,  # 낮을수록 정확
            "max_output_tokens": 4096,
        }
    )
```

### 환경 변수

| 변수 | 설명 | 필수 |
|------|------|------|
| `GEMINI_API_KEY` | Gemini API 키 | ✅ |
| `LAW_OC` | 법제처 API 키 | ✅ |
| `MCP_SERVER_URL` | MCP 서버 URL | ❌ (기본: http://localhost:3000) |

## 문제 해결

### MCP 서버 연결 실패

```
에이전트 초기화 실패: ...
```

→ MCP 서버가 실행 중인지 확인:
```bash
curl http://localhost:3000/health
```

### Gemini API 오류

```
GEMINI_API_KEY가 필요합니다
```

→ .env 파일에 GEMINI_API_KEY 설정 확인

### 도구 호출 실패

→ 법제처 API 키(LAW_OC)가 유효한지 확인

## 라이선스

MIT License
