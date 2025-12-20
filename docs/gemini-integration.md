# Gemini API + Korean Law MCP 통합 가이드

Korean Law MCP 서버를 Gemini API와 통합할 때 발생하는 주요 문제와 해결 방법을 정리한 가이드입니다.

## 목차

1. [주요 문제점](#주요-문제점)
2. [시스템 프롬프트 작성](#시스템-프롬프트-작성)
3. [도구 체이닝 강제 패턴](#도구-체이닝-강제-패턴)
4. [Few-shot 예시](#few-shot-예시)
5. [API 설정](#api-설정)
6. [디버깅](#디버깅)

---

## 주요 문제점

### 1. 검색 결과 없음 에러

**증상**:
```
사용자: "화관법 38조 알려줘"
Gemini: "검색 결과가 없습니다"
```

**원인**:
- 약칭 변환 필요성 인지 못함 (화관법 → 화학물질관리법)
- `search_law` 실행 안 하고 바로 `get_law_text` 호출
- `lawId`, `mst` 값을 임의로 생성

**해결**: 시스템 프롬프트에 워크플로우 명시 (아래 참조)

### 2. 도구 체이닝 실패 (가장 심각)

**증상**:
```
사용자: "관세법 38조 내용 알려줘"
Gemini: search_law 실행 → 결과 반환 → 답변 종료 (get_law_text 실행 안 함)
```

**원인**:
- Gemini API는 기본적으로 **단일 턴(turn) 도구 호출** 후 답변 생성
- 도구 결과를 받으면 "작업 완료"로 간주하고 종료
- Claude와 달리 **자동 체이닝 없음**

**해결**: 3가지 방법 (우선순위 순)

---

## 도구 체이닝 강제 패턴

### 방법 1: 응답 검증 + 재호출 (가장 확실)

```python
import google.generativeai as genai

def chat_with_law_mcp(user_query):
    """도구 체이닝 강제 구현"""

    conversation_history = [
        {"role": "user", "parts": [{"text": user_query}]}
    ]

    MAX_TURNS = 5  # 무한 루프 방지
    turn_count = 0

    while turn_count < MAX_TURNS:
        turn_count += 1

        # Gemini API 호출
        response = model.generate_content(
            conversation_history,
            tools=mcp_tools,
            tool_config={"function_calling_config": {"mode": "AUTO"}}
        )

        # 도구 호출 확인
        if response.candidates[0].content.parts:
            parts = response.candidates[0].content.parts

            # 도구 호출이 있는지 확인
            has_function_call = any(hasattr(p, 'function_call') for p in parts)

            if has_function_call:
                # 도구 실행
                for part in parts:
                    if hasattr(part, 'function_call'):
                        tool_name = part.function_call.name
                        tool_args = dict(part.function_call.args)

                        print(f"[도구 호출] {tool_name}({tool_args})")

                        # MCP 서버로 도구 실행
                        result = execute_mcp_tool(tool_name, tool_args)

                        # 결과를 대화 히스토리에 추가
                        conversation_history.append({
                            "role": "model",
                            "parts": [{"function_call": part.function_call}]
                        })
                        conversation_history.append({
                            "role": "user",
                            "parts": [{
                                "function_response": {
                                    "name": tool_name,
                                    "response": {"result": result}
                                }
                            }]
                        })

                # 다음 턴 계속 (도구 체이닝)
                continue

            # 텍스트 응답이면 종료
            else:
                final_answer = parts[0].text
                print(f"[최종 답변] {final_answer}")
                return final_answer

        # 더 이상 진행 불가
        break

    return "답변 생성 실패 (최대 턴 초과)"
```

**핵심**:
1. 도구 호출 결과를 `function_response`로 대화 히스토리에 추가
2. **텍스트 응답 나올 때까지 반복**
3. 최대 턴 수 제한으로 무한 루프 방지

### 방법 2: 시스템 프롬프트에 체이닝 강제 지시

```python
SYSTEM_PROMPT = """
한국 법령 검색 전문 AI입니다.

**CRITICAL 규칙**:
1. 법령 조문 조회 시 MUST follow this sequence:
   Step 1: search_law → lawId, mst 획득
   Step 2: get_law_text(lawId="...", mst="...", jo="...")

2. search_law 결과만 보고 답변 종료 절대 금지
3. lawId, mst 없이 get_law_text 호출 절대 금지
4. 각 단계 완료 후 MUST proceed to next step

도구 실행 후 사용자에게 결과 요약하기 전에:
- "다음 단계 필요한가?" 자문
- 필요하면 즉시 다음 도구 호출
- 모든 단계 완료 후에만 최종 답변

예시:
사용자: "관세법 38조"
Step 1: search_law(query="관세법") → lawId=001, mst=002 획득
Step 2: get_law_text(lawId="001", mst="002", jo="제38조") → 조문 내용 획득
Step 3: 사용자에게 조문 내용 제시
"""
```

**효과**: 70-80% 성공률 (완벽하진 않음)

### 방법 3: `tool_choice` 강제 (추천하지 않음)

```python
# 특정 도구 강제 호출
tool_config = {
    "function_calling_config": {
        "mode": "ANY",  # 도구 반드시 호출
        "allowed_function_names": ["search_law"]  # 특정 도구만
    }
}
```

**문제점**:
- 매 턴마다 `tool_choice` 수동 변경 필요
- 유연성 없음
- **방법 1 권장**

---

## 시스템 프롬프트 작성

### 완전판 템플릿

```markdown
# 한국 법령 검색 전문 AI

당신은 한국 법령정보를 검색하고 분석하는 AI입니다. 다음 원칙을 **반드시** 따르세요.

## 검색 전략

### 1단계: 법령 검색
- 사용자가 법령명이나 약칭을 언급하면 **무조건** `search_law` 도구 사용
- 검색어 예시:
  - "관세법" → `search_law(query="관세법")`
  - "화관법" → `search_law(query="화관법")` (자동으로 "화학물질관리법"으로 변환됨)
  - "근로기준법 38조" → 먼저 `search_law(query="근로기준법")`
- **검색 결과가 없으면**: 유사한 키워드로 2-3번 더 시도
  - 예: "자동차" → "자동차관리법", "자동차손해배상보장법"

### 2단계: 조문 조회
- `search_law`로 얻은 `lawId`, `mst` 값을 **정확히** 사용
- 조문 번호는 한글 형식으로: "제38조", "제10조의2"
- 예시: `get_law_text(lawId="001234", mst="56789", jo="제38조")`

### 3단계: 추가 분석
- 판례 필요 시: `search_precedents` + `get_precedent_text`
- 해석례 필요 시: `search_interpretations` + `get_interpretation_text`
- 신구법 대조: `compare_old_new`

## 절대 금지사항

❌ **도구 없이 법령 내용 추측/암기로 답변**
❌ **검색 결과 없을 때 "없다"고 바로 포기**
❌ **`lawId`, `mst` 값을 임의로 생성**
❌ **조문 번호를 영문/숫자로 변환** (한글 그대로 사용)
❌ **search_law만 실행하고 답변 종료** (조문 필요 시 get_law_text까지 실행)

## 오류 처리

- 검색 결과 0건 → 키워드 변경해서 재시도
- API 오류 → 사용자에게 명확히 설명 + 대안 제시
- 조문 없음 → 법령명만이라도 제공

## 응답 형식

1. **검색 과정 간략 설명** (어떤 도구 사용했는지)
2. **핵심 내용 요약**
3. **출처 명시** (법령명, 조문 번호, 시행일)

## 도구 체이닝 필수

**법령 조문 조회 시 MUST follow**:
1. search_law → lawId, mst 획득
2. get_law_text(lawId="...", mst="...", jo="...")
3. 사용자에게 조문 내용 제시

**중간에 답변 종료 금지**: 모든 단계 완료 후에만 최종 답변
```

### 최소판 (짧게 적용 시)

```markdown
# 한국 법령 검색 AI

## 워크플로우
1. search_law(query="법령명") → lawId, mst 획득
2. get_law_text(lawId="...", mst="...", jo="제X조")
3. 조문 내용 사용자에게 제시

## 금지사항
- lawId/mst 추측 금지
- search_law만 실행 후 종료 금지
- 약칭은 search_law가 자동 변환 (화관법 → 화학물질관리법)

## 검색 실패 시
1. 키워드 단순화 ("관세법 시행령" → "관세법")
2. suggest_law_names로 자동완성
3. search_all로 확장 검색
```

---

## Few-shot 예시

시스템 프롬프트에 성공 사례 추가하면 학습 효과 큼:

```markdown
## 성공 사례

**Case 1**: 약칭 검색
입력: "화관법 38조 알려줘"
단계:
1. search_law(query="화관법") → "화학물질관리법" 발견 (lawId=001234, mst=56789)
2. get_law_text(lawId="001234", mst="56789", jo="제38조") → 조문 내용 획득
3. 답변: "화학물질관리법 제38조 내용은 다음과 같습니다..."

**Case 2**: 신구법 대조
입력: "관세법 최근 개정 내용"
단계:
1. search_law(query="관세법") → lawId, mst 획득
2. get_law_history(regDt="20240101") → 최근 개정일 확인
3. compare_old_new(lawId=..., mst=..., ld="20240101") → 변경사항 획득
4. 답변: "관세법은 2024년 1월 1일 개정되었으며, 주요 변경사항은..."

**Case 3**: 판례 검색
입력: "자동차 사고 관련 판례"
단계:
1. search_precedents(query="자동차 사고") → 판례 목록 획득
2. get_precedent_text(id="12345") → 첫 번째 판례 상세 조회
3. 답변: "자동차 사고 관련 주요 판례는 다음과 같습니다..."
```

---

## API 설정

### Generation Config (중요!)

```python
generation_config = {
    "temperature": 0.1,  # 낮게 설정 (환각 방지)
    "top_p": 0.95,
    "top_k": 40,
    "max_output_tokens": 8192,
}

# 도구 설정
tool_config = {
    "function_calling_config": {
        "mode": "AUTO"  # 자동 도구 선택
        # "mode": "ANY"  # 강제 도구 호출 (체이닝 실패 시)
    }
}

model = genai.GenerativeModel(
    model_name="gemini-1.5-pro",  # 또는 gemini-1.5-flash
    generation_config=generation_config,
    system_instruction=SYSTEM_PROMPT,  # 위의 프롬프트
)
```

### MCP 도구 등록

```python
# MCP 서버 연결
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

# 서버 시작
server_params = StdioServerParameters(
    command="node",
    args=["path/to/korean-law-mcp/build/index.js"],
    env={"LAW_OC": "your-api-key"}
)

async with stdio_client(server_params) as (read, write):
    async with ClientSession(read, write) as session:
        await session.initialize()

        # 도구 목록 가져오기
        tools_list = await session.list_tools()

        # Gemini 형식으로 변환
        gemini_tools = convert_mcp_to_gemini_tools(tools_list)

        # 모델에 등록
        model = genai.GenerativeModel(
            model_name="gemini-1.5-pro",
            tools=gemini_tools
        )
```

---

## 디버깅

### 로깅 활성화

```python
import logging

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# 도구 호출 로깅
for part in response.parts:
    if hasattr(part, 'function_call'):
        logger.info(f"Tool: {part.function_call.name}")
        logger.info(f"Args: {dict(part.function_call.args)}")
    if hasattr(part, 'function_response'):
        logger.info(f"Result: {part.function_response.response}")
```

### 체크리스트

- [ ] 시스템 프롬프트에 워크플로우 명시
- [ ] 금지사항 명확히 작성
- [ ] Few-shot 예시 2개 이상
- [ ] Temperature 0.2 이하
- [ ] 도구 체이닝 루프 구현 (방법 1)
- [ ] 로깅 활성화

### 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| "검색 결과 없음" | 약칭 변환 실패 | 시스템 프롬프트에 약칭 예시 추가 |
| search_law만 실행 | 체이닝 실패 | 방법 1 (재호출 루프) 구현 |
| lawId 임의 생성 | 파라미터 추측 | 프롬프트에 "추측 금지" 명시 |
| 무한 루프 | 체이닝 로직 오류 | MAX_TURNS 제한 추가 |

---

## 추가 리소스

- [MCP 공식 문서](https://modelcontextprotocol.io/)
- [Gemini Function Calling 가이드](https://ai.google.dev/gemini-api/docs/function-calling)
- [Korean Law MCP GitHub](https://github.com/yourusername/korean-law-mcp)

---

**버전**: 1.0
**최종 업데이트**: 2025-12-20
