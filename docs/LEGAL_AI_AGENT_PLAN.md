# 법률 전문 AI 에이전트 개발 계획서

## 1. 프로젝트 개요

### 1.1 목표
한국 법률 전문 AI 에이전트 개발 - 33개 MCP 도구를 자율적으로 선택하여 법률 질문에 종합적인 답변 제공

### 1.2 핵심 기능
- **자율적 도구 선택**: 질문 분석 후 필요한 도구 자동 결정
- **다단계 추론**: 검색 → 분석 → 비교 → 종합의 체계적 연구
- **출처 명시**: 모든 답변에 법령/판례 근거 제공
- **대화 맥락 유지**: 후속 질문 처리

---

## 2. 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────────────────┐
│                         사용자 인터페이스                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │
│  │  웹 UI      │  │  API        │  │  CLI        │                 │
│  │  (React)    │  │  (REST)     │  │  (터미널)    │                 │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                 │
└─────────┼────────────────┼────────────────┼─────────────────────────┘
          │                │                │
          └────────────────┼────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      에이전트 오케스트레이터                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Legal Agent Core                         │   │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐               │   │
│  │  │ 질문분석기 │  │ 계획수립기 │  │ 답변생성기 │               │   │
│  │  │ Analyzer  │→ │ Planner   │→ │ Synthesizer│               │   │
│  │  └───────────┘  └───────────┘  └───────────┘               │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                   도구 실행 엔진                              │   │
│  │           Tool Executor (33개 도구 관리)                     │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      korean-law-mcp 서버                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │
│  │ 법령 검색   │  │ 판례 분석   │  │ 해석례/재결 │                 │
│  │ (10 tools)  │  │ (8 tools)   │  │ (6 tools)   │                 │
│  └─────────────┘  └─────────────┘  └─────────────┘                 │
│  ┌─────────────┐  ┌─────────────┐                                  │
│  │ 비교/분석   │  │ 유틸리티    │                                  │
│  │ (5 tools)   │  │ (4 tools)   │                                  │
│  └─────────────┘  └─────────────┘                                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. 33개 도구 분류 및 선택 전략

### 3.1 도구 카테고리

```python
TOOL_CATEGORIES = {
    "법령_검색": {
        "tools": ["search_law", "suggest_law_names", "search_all", "advanced_search"],
        "trigger_keywords": ["법", "법률", "규정", "조항", "시행령", "시행규칙"],
        "priority": 1  # 가장 먼저 시도
    },

    "조문_조회": {
        "tools": ["get_law_text", "get_batch_articles", "parse_jo_code"],
        "trigger_keywords": ["제X조", "조문", "내용", "규정 내용"],
        "priority": 2  # 법령 검색 후 실행
    },

    "판례_검색": {
        "tools": ["search_precedents", "get_precedent_text", "find_similar_precedents"],
        "trigger_keywords": ["판례", "판결", "대법원", "법원", "사례"],
        "priority": 3
    },

    "판례_분석": {
        "tools": ["summarize_precedent", "extract_precedent_keywords"],
        "trigger_keywords": ["요약", "핵심", "판시사항", "키워드"],
        "priority": 4
    },

    "법령_비교분석": {
        "tools": ["compare_old_new", "compare_articles", "get_article_history", "get_law_history"],
        "trigger_keywords": ["개정", "변경", "비교", "신구", "이전", "과거"],
        "priority": 3
    },

    "위임_관계": {
        "tools": ["get_three_tier", "get_law_tree"],
        "trigger_keywords": ["시행령", "시행규칙", "위임", "하위법령", "상위법령"],
        "priority": 3
    },

    "행정규칙": {
        "tools": ["search_admin_rule", "get_admin_rule"],
        "trigger_keywords": ["고시", "훈령", "예규", "지침"],
        "priority": 2
    },

    "자치법규": {
        "tools": ["search_ordinance", "get_ordinance"],
        "trigger_keywords": ["조례", "지방", "시", "도", "군", "구"],
        "priority": 2
    },

    "법령해석": {
        "tools": ["search_interpretations", "get_interpretation_text"],
        "trigger_keywords": ["해석", "유권해석", "질의", "회신"],
        "priority": 3
    },

    "조세_심판": {
        "tools": ["search_tax_tribunal_decisions", "get_tax_tribunal_decision_text"],
        "trigger_keywords": ["세금", "조세", "국세", "지방세", "심판", "재결"],
        "priority": 3
    },

    "관세_해석": {
        "tools": ["search_customs_interpretations", "get_customs_interpretation_text"],
        "trigger_keywords": ["관세", "수입", "수출", "통관", "FTA", "원산지"],
        "priority": 3
    },

    "통합_조회": {
        "tools": ["get_article_with_precedents"],
        "trigger_keywords": ["조문과 판례", "함께", "관련"],
        "priority": 4
    },

    "부가_정보": {
        "tools": ["get_annexes", "get_external_links", "parse_article_links", "get_law_statistics"],
        "trigger_keywords": ["별표", "서식", "링크", "통계", "참조"],
        "priority": 5
    }
}
```

### 3.2 자율적 도구 선택 알고리즘

```python
class ToolSelector:
    """질문 분석 후 최적의 도구 조합 선택"""

    def analyze_question(self, question: str) -> dict:
        """질문 유형 및 필요 정보 분석"""
        return {
            "question_type": self._classify_question(question),
            "entities": self._extract_entities(question),
            "required_info": self._identify_required_info(question),
            "depth": self._determine_research_depth(question)
        }

    def _classify_question(self, question: str) -> str:
        """질문 유형 분류"""
        patterns = {
            "법령_내용": r"(무엇|어떤|규정|내용|조항)",
            "판례_검색": r"(판례|판결|사례|선례)",
            "법령_비교": r"(개정|변경|바뀐|달라진|비교)",
            "적용_해석": r"(적용|해석|해당|경우|때)",
            "절차_안내": r"(절차|방법|어떻게|신고|신청)",
            "벌칙_확인": r"(벌칙|처벌|과태료|벌금|위반)",
        }
        # 패턴 매칭 후 유형 반환
        for q_type, pattern in patterns.items():
            if re.search(pattern, question):
                return q_type
        return "일반_질문"

    def select_tools(self, analysis: dict) -> list:
        """분석 결과 기반 도구 선택"""
        tools = []

        # 1단계: 필수 도구 (항상 포함)
        tools.append({
            "tool": "search_law",
            "reason": "관련 법령 식별",
            "phase": 1
        })

        # 2단계: 질문 유형별 도구
        if analysis["question_type"] == "판례_검색":
            tools.extend([
                {"tool": "search_precedents", "reason": "판례 검색", "phase": 2},
                {"tool": "get_precedent_text", "reason": "판례 상세", "phase": 3},
                {"tool": "summarize_precedent", "reason": "판례 요약", "phase": 4}
            ])

        elif analysis["question_type"] == "법령_비교":
            tools.extend([
                {"tool": "get_law_history", "reason": "개정 이력", "phase": 2},
                {"tool": "compare_old_new", "reason": "신구 대조", "phase": 3}
            ])

        # 3단계: 깊이에 따른 추가 도구
        if analysis["depth"] == "comprehensive":
            tools.extend([
                {"tool": "search_interpretations", "reason": "해석례 확인", "phase": 4},
                {"tool": "get_article_with_precedents", "reason": "통합 조회", "phase": 4}
            ])

        return tools
```

---

## 4. 에이전트 핵심 로직

### 4.1 메인 에이전트 클래스

```python
# src/agent/legal_agent.py

import asyncio
from dataclasses import dataclass
from typing import AsyncGenerator
from claude_agent_sdk import ClaudeSDKClient, query

@dataclass
class ResearchResult:
    """연구 결과 데이터 클래스"""
    laws: list           # 관련 법령
    articles: list       # 조문 내용
    precedents: list     # 관련 판례
    interpretations: list # 해석례
    sources: list        # 출처 목록

class LegalAgent:
    """법률 전문 AI 에이전트"""

    SYSTEM_PROMPT = """
당신은 한국 법률 전문 AI 에이전트입니다.

## 역할
사용자의 법률 질문에 대해 관련 법령, 판례, 해석례를 종합적으로 조사하여
정확하고 신뢰할 수 있는 답변을 제공합니다.

## 사용 가능한 도구 (33개)

### 1단계: 법령 검색
- search_law: 법령명으로 검색 (약칭 자동 변환)
- suggest_law_names: 법령명 자동완성
- search_all: 법령/행정규칙/자치법규 통합 검색
- advanced_search: 고급 필터 검색

### 2단계: 조문 조회
- get_law_text: 특정 조문 조회 (search_law 후 사용)
- get_batch_articles: 여러 조문 일괄 조회
- parse_jo_code: 조문번호 변환 (제38조 ↔ 003800)

### 3단계: 판례 검색/분석
- search_precedents: 판례 검색
- get_precedent_text: 판례 전문 조회
- summarize_precedent: 판례 요약
- extract_precedent_keywords: 핵심 키워드 추출
- find_similar_precedents: 유사 판례 검색

### 4단계: 법령 분석
- compare_old_new: 신구법 대조 (개정 전후 비교)
- compare_articles: 두 법령 조문 비교
- get_three_tier: 법률→시행령→시행규칙 위임관계
- get_law_tree: 법령 체계 트리 시각화
- get_article_history: 조문 개정 이력
- get_law_history: 법령 변경 이력

### 5단계: 특수 자료
- search_admin_rule / get_admin_rule: 행정규칙 (고시, 훈령)
- search_ordinance / get_ordinance: 자치법규 (조례)
- search_interpretations / get_interpretation_text: 법령해석례
- search_tax_tribunal_decisions / get_tax_tribunal_decision_text: 조세심판 재결례
- search_customs_interpretations / get_customs_interpretation_text: 관세청 해석

### 유틸리티
- get_annexes: 별표/서식 조회
- get_external_links: 공식 사이트 링크 생성
- parse_article_links: 조문 내 참조 분석
- get_law_statistics: 법령 통계
- get_article_with_precedents: 조문+판례 통합 조회

## 작업 원칙

1. **단계적 조사**: 검색 → 조회 → 분석 → 종합 순서 준수
2. **출처 명시**: 모든 정보에 법령명, 조문, 판례번호 표기
3. **정확성 우선**: 불확실한 정보는 명시적으로 표현
4. **사용자 맥락**: 질문의 의도와 배경 고려

## 응답 형식

### 법령 관련 질문
```
📋 관련 법령
- [법령명] 제X조 (조문 제목)
  - 내용 요약

⚖️ 관련 판례 (있는 경우)
- [판례번호] 요지

💡 해석/적용
- 질문에 대한 답변

📎 출처
- 법령: [법령명] 제X조
- 판례: [판례번호]
```

## 주의사항
- 법률 자문이 아닌 정보 제공임을 명시
- 최신 법령 확인 권고
- 복잡한 사안은 전문가 상담 권유
"""

    def __init__(self, api_key: str = None, mcp_url: str = None):
        self.client = ClaudeSDKClient(
            mcp_servers={
                "korean_law": {
                    "url": mcp_url or "http://localhost:3000/sse",
                    "type": "sse"
                } if mcp_url else {
                    "command": "node",
                    "args": ["build/index.js"],
                    "env": {"LAW_OC": api_key}
                }
            },
            # 모든 33개 도구 허용
            allowed_tools=[
                # 법령 검색
                "search_law", "suggest_law_names", "search_all", "advanced_search",
                # 조문 조회
                "get_law_text", "get_batch_articles", "parse_jo_code",
                # 판례
                "search_precedents", "get_precedent_text", "summarize_precedent",
                "extract_precedent_keywords", "find_similar_precedents",
                # 법령 분석
                "compare_old_new", "compare_articles", "get_three_tier",
                "get_law_tree", "get_article_history", "get_law_history",
                # 행정규칙/자치법규
                "search_admin_rule", "get_admin_rule",
                "search_ordinance", "get_ordinance",
                # 해석례
                "search_interpretations", "get_interpretation_text",
                "search_tax_tribunal_decisions", "get_tax_tribunal_decision_text",
                "search_customs_interpretations", "get_customs_interpretation_text",
                # 유틸리티
                "get_annexes", "get_external_links", "parse_article_links",
                "get_law_statistics", "get_article_with_precedents"
            ]
        )
        self.conversation_history = []

    async def research(self, question: str) -> AsyncGenerator[dict, None]:
        """법률 연구 수행 - 스트리밍 응답"""

        # 대화 기록에 추가
        self.conversation_history.append({
            "role": "user",
            "content": question
        })

        # 시스템 프롬프트 + 대화 기록으로 쿼리
        full_prompt = f"""
{self.SYSTEM_PROMPT}

## 현재 질문
{question}

## 지시사항
1. 질문을 분석하여 필요한 도구를 파악하세요
2. 단계별로 도구를 실행하여 정보를 수집하세요
3. 수집된 정보를 종합하여 답변을 작성하세요
4. 모든 출처를 명시하세요
"""

        async for event in query(
            prompt=full_prompt,
            client=self.client,
            stream=True
        ):
            if event.type == "tool_use":
                yield {
                    "type": "tool_call",
                    "tool": event.name,
                    "input": event.input,
                    "status": "executing"
                }

            elif event.type == "tool_result":
                yield {
                    "type": "tool_result",
                    "tool": event.name,
                    "result": event.content[:500] + "..." if len(event.content) > 500 else event.content
                }

            elif event.type == "text":
                yield {
                    "type": "response",
                    "content": event.text
                }

            elif event.type == "end":
                # 대화 기록에 응답 추가
                self.conversation_history.append({
                    "role": "assistant",
                    "content": event.final_text
                })
                yield {
                    "type": "complete",
                    "content": event.final_text
                }

    async def ask(self, question: str) -> str:
        """단순 질문-응답 (스트리밍 없이)"""
        result = ""
        async for event in self.research(question):
            if event["type"] == "complete":
                result = event["content"]
        return result

    def clear_history(self):
        """대화 기록 초기화"""
        self.conversation_history = []
```

### 4.2 도구 실행 흐름 예시

```python
# 질문: "관세법 제38조 수정신고와 관련된 판례를 알려줘"

# 에이전트가 자율적으로 선택하는 도구 시퀀스:

Step 1: search_law(query="관세법")
        → lawId: "001234", mst: "100001" 획득

Step 2: get_law_text(mst="100001", jo="제38조")
        → 제38조 수정신고 조문 내용 획득

Step 3: search_precedents(query="관세법 제38조 수정신고")
        → 관련 판례 목록 획득

Step 4: get_precedent_text(id="판례ID")
        → 주요 판례 전문 조회

Step 5: summarize_precedent(id="판례ID")
        → 판례 핵심 요약

Step 6: 종합 답변 생성
        → 조문 내용 + 판례 요지 + 실무 적용 안내
```

---

## 5. API 서버 구현

### 5.1 FastAPI 서버

```python
# src/api/server.py

from fastapi import FastAPI, WebSocket, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import asyncio

from agent.legal_agent import LegalAgent

app = FastAPI(
    title="법률 AI 에이전트 API",
    description="한국 법률 전문 AI 에이전트",
    version="1.0.0"
)

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 에이전트 인스턴스 (세션별 관리 필요)
agents = {}

class QuestionRequest(BaseModel):
    question: str
    session_id: Optional[str] = "default"

class ResearchResponse(BaseModel):
    answer: str
    sources: list
    tools_used: list

@app.post("/api/ask", response_model=ResearchResponse)
async def ask_question(request: QuestionRequest):
    """법률 질문에 대한 답변"""

    # 세션별 에이전트 생성/조회
    if request.session_id not in agents:
        agents[request.session_id] = LegalAgent()

    agent = agents[request.session_id]

    tools_used = []
    sources = []

    async for event in agent.research(request.question):
        if event["type"] == "tool_call":
            tools_used.append(event["tool"])
        elif event["type"] == "complete":
            return ResearchResponse(
                answer=event["content"],
                sources=sources,
                tools_used=list(set(tools_used))
            )

    raise HTTPException(status_code=500, detail="연구 실패")

@app.websocket("/ws/chat/{session_id}")
async def websocket_chat(websocket: WebSocket, session_id: str):
    """실시간 스트리밍 채팅"""
    await websocket.accept()

    if session_id not in agents:
        agents[session_id] = LegalAgent()

    agent = agents[session_id]

    try:
        while True:
            question = await websocket.receive_text()

            async for event in agent.research(question):
                await websocket.send_json(event)

    except Exception as e:
        await websocket.close(code=1000)

@app.delete("/api/session/{session_id}")
async def clear_session(session_id: str):
    """세션 초기화"""
    if session_id in agents:
        agents[session_id].clear_history()
        del agents[session_id]
    return {"status": "cleared"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}
```

### 5.2 웹소켓 클라이언트 예시

```javascript
// 프론트엔드 연동 예시
class LegalAgentClient {
    constructor(sessionId) {
        this.sessionId = sessionId;
        this.ws = new WebSocket(`wss://api.example.com/ws/chat/${sessionId}`);
        this.callbacks = {};
    }

    onToolCall(callback) {
        this.callbacks.tool_call = callback;
    }

    onResponse(callback) {
        this.callbacks.response = callback;
    }

    onComplete(callback) {
        this.callbacks.complete = callback;
    }

    ask(question) {
        this.ws.send(question);

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (data.type === 'tool_call' && this.callbacks.tool_call) {
                this.callbacks.tool_call(data);
            } else if (data.type === 'response' && this.callbacks.response) {
                this.callbacks.response(data);
            } else if (data.type === 'complete' && this.callbacks.complete) {
                this.callbacks.complete(data);
            }
        };
    }
}

// 사용 예시
const agent = new LegalAgentClient('user-123');

agent.onToolCall((data) => {
    console.log(`🔧 도구 실행 중: ${data.tool}`);
});

agent.onResponse((data) => {
    document.getElementById('answer').innerHTML += data.content;
});

agent.onComplete((data) => {
    console.log('✅ 연구 완료');
});

agent.ask('관세법 제38조 수정신고 기한은?');
```

---

## 6. 프로젝트 구조

```
legal-ai-agent/
├── src/
│   ├── agent/
│   │   ├── __init__.py
│   │   ├── legal_agent.py      # 메인 에이전트
│   │   ├── tool_selector.py    # 도구 선택 로직
│   │   └── prompts.py          # 시스템 프롬프트
│   │
│   ├── api/
│   │   ├── __init__.py
│   │   ├── server.py           # FastAPI 서버
│   │   └── models.py           # Pydantic 모델
│   │
│   └── utils/
│       ├── __init__.py
│       └── logger.py           # 로깅
│
├── korean-law-mcp/             # MCP 서버 (기존)
│   ├── src/
│   ├── build/
│   └── package.json
│
├── tests/
│   ├── test_agent.py
│   └── test_api.py
│
├── docker/
│   ├── Dockerfile.agent
│   ├── Dockerfile.mcp
│   └── docker-compose.yml
│
├── docs/
│   ├── API.md
│   └── DEPLOYMENT.md
│
├── requirements.txt
├── pyproject.toml
└── README.md
```

---

## 7. 배포 구성

### 7.1 Docker Compose

```yaml
# docker-compose.yml
version: '3.8'

services:
  # MCP 서버
  mcp-server:
    build:
      context: ./korean-law-mcp
      dockerfile: ../docker/Dockerfile.mcp
    environment:
      - LAW_OC=${LAW_OC}
    ports:
      - "3000:3000"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  # 에이전트 API 서버
  agent-api:
    build:
      context: .
      dockerfile: docker/Dockerfile.agent
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - MCP_SERVER_URL=http://mcp-server:3000/sse
    ports:
      - "8000:8000"
    depends_on:
      mcp-server:
        condition: service_healthy

  # 웹 프론트엔드 (선택)
  web-ui:
    build:
      context: ./web
      dockerfile: Dockerfile
    ports:
      - "80:80"
    depends_on:
      - agent-api
```

### 7.2 Railway/Render 배포

```toml
# railway.toml
[build]
  builder = "dockerfile"
  dockerfilePath = "docker/Dockerfile.agent"

[deploy]
  healthcheckPath = "/health"
  restartPolicyType = "on-failure"

[[services]]
  name = "legal-agent-api"

[[services]]
  name = "korean-law-mcp"
```

---

## 8. 개발 로드맵

### Phase 1: 기본 에이전트 (2주)
- [ ] Python 프로젝트 설정
- [ ] LegalAgent 클래스 구현
- [ ] 시스템 프롬프트 최적화
- [ ] 기본 도구 선택 로직
- [ ] 단위 테스트

### Phase 2: API 서버 (1주)
- [ ] FastAPI 서버 구현
- [ ] WebSocket 스트리밍
- [ ] 세션 관리
- [ ] 에러 핸들링

### Phase 3: 도구 선택 고도화 (2주)
- [ ] 질문 분류 모델 개선
- [ ] 도구 체이닝 최적화
- [ ] 실패 복구 로직
- [ ] 캐싱 구현

### Phase 4: 배포 및 모니터링 (1주)
- [ ] Docker 컨테이너화
- [ ] CI/CD 파이프라인
- [ ] 로깅/모니터링
- [ ] 문서화

### Phase 5: 웹 UI (2주) - 선택
- [ ] React 프론트엔드
- [ ] 실시간 채팅 UI
- [ ] 도구 실행 시각화
- [ ] 출처 링크 연동

---

## 9. 테스트 시나리오

```python
# tests/test_scenarios.py

TEST_CASES = [
    {
        "question": "관세법 제38조 수정신고 기한은?",
        "expected_tools": ["search_law", "get_law_text"],
        "expected_keywords": ["수정신고", "기한", "제38조"]
    },
    {
        "question": "화관법 위반 시 벌칙은?",
        "expected_tools": ["search_law", "get_law_text"],
        "expected_keywords": ["화학물질관리법", "벌칙", "위반"]
    },
    {
        "question": "관세법 제38조 관련 대법원 판례를 찾아줘",
        "expected_tools": ["search_law", "search_precedents", "get_precedent_text"],
        "expected_keywords": ["판례", "대법원"]
    },
    {
        "question": "관세법이 최근 어떻게 개정되었나?",
        "expected_tools": ["search_law", "get_law_history", "compare_old_new"],
        "expected_keywords": ["개정", "변경"]
    },
    {
        "question": "FTA 원산지 증명 관련 관세청 해석은?",
        "expected_tools": ["search_customs_interpretations", "get_customs_interpretation_text"],
        "expected_keywords": ["원산지", "FTA", "관세청"]
    }
]
```

---

## 10. 향후 확장 계획

1. **멀티모달 지원**: 법령 별표 이미지 분석
2. **다국어**: 영문 법령 병행 제공
3. **알림 서비스**: 관심 법령 개정 알림
4. **전문가 연결**: 복잡한 사안 변호사 연결
5. **기업 맞춤형**: 특정 산업 규제 모니터링

---

## 부록: 시작하기

```bash
# 1. 저장소 클론
git clone https://github.com/your/legal-ai-agent.git
cd legal-ai-agent

# 2. 환경 설정
cp .env.example .env
# .env 파일에 API 키 설정

# 3. 의존성 설치
pip install -r requirements.txt
cd korean-law-mcp && npm install && npm run build && cd ..

# 4. 개발 서버 실행
uvicorn src.api.server:app --reload

# 5. 테스트
pytest tests/
```
