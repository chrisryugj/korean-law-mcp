# Korean Law MCP

**법제처 41개 API를 15개 도구로.** 법령, 판례, 행정규칙, 자치법규, 조약, 해석례를 AI 어시스턴트나 터미널에서 바로 사용.

[![npm version](https://img.shields.io/npm/v/korean-law-mcp.svg)](https://www.npmjs.com/package/korean-law-mcp)
[![MCP 1.27](https://img.shields.io/badge/MCP-1.27-blue)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> 법제처 Open API 기반 MCP 서버 + CLI. Claude Desktop, Cursor, Windsurf, Zed, Claude.ai 등에서 바로 사용 가능.

[English](./README-EN.md)

![Korean Law MCP 데모](./demo.gif)

---

## v3.2.0 — 이제 이런 것도 됩니다

사용법은 똑같습니다. **그냥 자연어로 물어보세요.** AI가 질문을 알아듣고, 필요한 분석을 자동으로 추가해줍니다.

### 과태료 받았는데, 감경 가능할까?

```
"식품위생법 영업정지 과태료 감경 가능?"
```

→ 위반 유형별 **처분 기준표** (1차·2차·3차 금액) + **벌칙 조항** 원문 + 실제로 **감경된 행정심판 사례** + 해당 조항 **개정 이력**까지 한 번에 나옵니다.

### 이 물건 수입하려는데, 법적으로 뭘 확인해야 하지?

```
"수입 통관 FTA 적용 확인"
```

→ **관세법** + **관세청 유권해석** + **FTA 조약 원문** + **세율 별표** + 관세 분쟁 시 **조세심판원 판결**까지. 예전에는 법제처·관세청·조세심판원·외교부 4곳을 따로 뒤져야 했습니다.

### 건축허가 처리, 어디서부터 시작하지?

```
"건축법 허가 절차"
```

→ **법적 근거** (법률→시행령→시행규칙) + **수수료·서식** + 관련 **훈령·예규·고시** + 우리 지자체 **조례 특칙** + **유권해석**까지 원스톱.

### 법 하나 고치면 뭐가 같이 바뀌어야 하지?

```
"건축법 영향도 분석"
```

→ **하위법령**(시행령·시행규칙) + 전국 **자치법규** 중 영향받는 것 + 관련 **행정규칙** 목록이 나옵니다.

### 이 법의 위임 사항, 다 만들어졌나?

```
"국민건강보험법 위임입법"
```

→ "시행령으로 정한다"고 돼 있는 조항 중 **아직 시행령이 안 만들어진 것**을 찾아줍니다.

### 이 조례, 상위법에 어긋나지 않나?

```
"주차 조례 상위법 적합성"
```

→ **헌법재판소 위헌 결정** + **행정심판 취소 사례** 중 비슷한 조례 관련 건을 검색하고, **상위법 근거**를 대조합니다.

### 이 조문, 언제 바뀌었고 판례는 어떻게 달라졌지?

```
"근로기준법 개정이력 타임라인"
```

→ **신구대조표** + 조문별 **개정 이력** + 해당 법령의 **판례·해석례**를 시간순으로 묶어줍니다.

---

> **사용법 변경 없음.** 기존처럼 자연어로 물어보면 됩니다. 질문에 따라 AI가 알아서 추가 분석을 붙입니다.
>
> 모든 결과 끝에 **"이어서 할 수 있는 조회"**가 제안됩니다. 복사해서 바로 이어가세요.

<details>
<summary>v3.2.1~v3.3.0 변경 이력</summary>

**v3.3.0** — HTTP stateless 모드 전환 + kordoc 2.3.0

원격 서버(`korean-law-mcp.fly.dev`)가 주기적으로 OOM kill로 재시작되면서 기존 세션 ID가 무효화되던 문제를 근본 해결. MCP 공식 stateless 패턴(`sessionIdGenerator: undefined`)으로 전환하여 매 요청마다 fresh `Server + Transport`를 생성, 요청 종료 시 즉시 해제. in-memory 세션 Map·InMemoryEventStore·idle cleanup 전부 제거로 누수 원인 소거. 재시작·스케일아웃·배포 모두 무손실. `GET /mcp`·`DELETE /mcp`는 공식 예제와 동일하게 `405`. API 키는 `AsyncLocalStorage`로 요청 단위 격리 (race condition 방지).

- **HTTP stateless 전환** — [src/server/http-server.ts](src/server/http-server.ts) (참고: `@modelcontextprotocol/sdk/examples/server/simpleStatelessStreamableHttp.js`)
- **kordoc 2.2.5 → 2.3.0** — 별표/서식 파싱 엔진 업데이트
- **세션 관리 코드 완전 제거** — `sessions` Map, `MAX_SESSIONS`, idle cleanup `setInterval`, `InMemoryEventStore`, POST/GET/DELETE 분기 로직 삭제 (v3.2.3의 LRU eviction 접근을 대체)

**v3.2.3** — HTTP 세션 안정성 중간 개선. `MAX_SESSIONS` 100→500 + LRU eviction. _v3.3.0의 stateless 전환으로 대체됨._

**v3.2.2** — 별표/서식 조회 도구(`get_annexes`)를 기본 노출 도구에 추가. **노출 도구 수 14 → 15개**. 환불·감경 키워드 질의 시 별표 자동 조회 로직 추가.

**v3.2.1** — kordoc 2.2.5 업데이트.

</details>

<details>
<summary>개발자용: 시나리오 기술 상세</summary>

기존 8개 체인 도구에 `scenario` 파라미터가 추가되었습니다. (노출 도구 수는 v3.2.2에서 `get_annexes` 노출 추가로 14 → 15개)

| scenario | 호스트 체인 | 추가 조회 |
|---------|-----------|----------|
| `penalty` | chain_action_basis | 별표 처분기준표 + 벌칙 조항 + 감경 행심 + 개정이력 |
| `customs` | chain_full_research | 관세청 해석례 + 조세심판 + FTA 조약 + 세율표 + 3단비교 |
| `manual` | chain_procedure_detail | 법체계(행정규칙) + 해석례 + 연계 자치법규 |
| `delegation` | chain_law_system | 위임법령 현황 + 법체계(행정규칙) + 조문 이력 |
| `impact` | chain_law_system | 법체계 트리 + 연계 조례 + 조문별 연계 + 행정규칙 |
| `timeline` | chain_amendment_track | 판례 + 해석례 시계열 매핑 |
| `compliance` | chain_ordinance_compare | 헌재 위헌 결정 + 행심 위법 취소 + 상위법 근거 |

시나리오는 쿼리 키워드에서 **자동 감지**되거나, `scenario` 파라미터로 **직접 지정**할 수 있습니다.

**기타 개선:**
- 법령체계도(`get_law_system_tree`)에 행정규칙(훈령/예규/고시) 출력 추가
- 법령 검색 3차 fallback — 복합 쿼리에서 법령명 패턴 자동 추출
- `chain_action_basis` 판례/해석례 검색 정확도 향상 (법령명 기반 검색)

</details>

<details>
<summary>v3.1.0~v3.1.5 변경 이력</summary>

**v3.1.5** — kordoc 2.2.4 + 문서 파싱 엔진 강화. README 현행화.

**v3.1.4** — kordoc 2.2.4 업데이트. 병합 셀 HTML `<table>` 출력, markdownToHwpx 서식 강화.

**v3.1.3** — 검색 결과 없음 힌트 통합 (18개 도구). 세션 정리 주기 단축 (30분→10분).

**v3.1.2** — kordoc 2.2.1 업데이트. GFM 테이블 특수문자 이스케이프 및 pipe 충돌 방지.

**v3.1.1** — kordoc 2.1→2.2 업데이트.

## v3.1.0 — Production Hardening

프로덕션 리뷰 기반 20개 파일 수정. 잠재적 버그, 보안, 안정성 일괄 개선.

- **truncateResponse 누락 일괄 수정** — 17개 도구에서 50KB 응답 제한 미적용 수정
- **HTTP 서버 세션 제한** — MAX_SESSIONS=100 추가, 503 응답 (DoS 방어)
- **CORS 와일드카드 경고** — 미설정 시 stderr 경고 로그 추가
- **파라미터 오염 방어** — `search_decisions`/`get_decision_text`의 options에서 핵심 필드 덮어쓰기 차단
- **체인 도구 안정성** — 인증 에러(401/403/429) 즉시 전파, findLaws 안전 래핑
- **API 클라이언트** — throwIfError에서 response body 소비 (stream 리크 방지)
- **CLI 개선** — REPL 모드 Ctrl+C 2회 강제종료 구현
- **SSE 서버 제거** — 사용되지 않는 데드코드 삭제 (HTTP 서버가 SSE 스트리밍 지원)
- **데드 코드/의존성 정리** — `zod-to-json-schema`, ordinance 힌트, `start:sse` script

</details>

<details>
<summary>v3.0.x 변경 이력</summary>

**v3.0.2** — Unified Architecture + Setup Wizard

법제처 41개 API를 89개 MCP 도구로 구조화했던 v2.
v3는 같은 41개 API를 **15개 도구**로 재압축했습니다.

| | 법제처 원본 | v2 | v3 |
|---|:---:|:---:|:---:|
| API/도구 수 | 41 | 89 | **15** |
| AI 컨텍스트 비용 | - | ~110 KB | **~20 KB** |
| 기능 커버리지 | - | 100% | **100%** |
| 프로필 관리 | - | lite/full 분리 | **단일 (불필요)** |

### 왜 89개가 14개가 됐나

v2의 실수: API 하나당 도구 하나. 직관적이지만, AI 입장에서는 89개 스키마를
전부 읽어야 해서 **컨텍스트의 절반을 도구 목록에 소비**했습니다.

v3의 발상 전환: 비슷한 패턴의 도구를 `domain` 파라미터 하나로 통합.
판례·헌재·조세심판·공정위 등 **17개 도메인**이
`search_decisions(domain)` + `get_decision_text(domain)` **2개**로 합쳐졌습니다.

나머지 전문 도구(용어, 별표, 이력 등)는 그대로 작동하되,
`discover_tools` → `execute_tool`로 필요할 때만 접근합니다.

### 사용자 입장에서 뭐가 좋아지나

- **AI가 더 정확함** — 89개 중 고르던 AI가, 14개만 보고 즉시 판단
- **응답 속도 체감 향상** — 컨텍스트 82% 절감
- **설정 단순화** — lite/full 프로필 선택 불필요. 모든 클라이언트에서 동일한 14개
- **17개 결정례 도메인 즉시 접근** — discover 거치지 않고 바로 검색

### 기타 변경

- **kordoc 1.6 → 2.2.5** — 문서 파싱 엔진 업그레이드 (XLSX/DOCX 지원, 보안 강화, 양식 채우기)
- **행정심판 전문 조회 버그 수정** — API 응답 키 fallback 추가
- **영문법령 전문 조회 버그 수정** — 신형 API 응답 구조 지원

### 개발자에게

MCP 도구 설계에서 **도구 수 ≠ 기능 수**입니다.
41개 API를 89개로 펼쳤다가 다시 14개로 접은 이 과정이
"적정 추상화 수준"을 찾는 여정이었습니다.

핵심 패턴: **Dispatch Table + Domain Enum**.
기존 handler 함수는 한 줄도 수정하지 않았습니다.

</details>

<details>
<summary>v2.x 변경 이력</summary>

**v2.3.2** — 프로덕션 코드 품질 개선 (47파일, -179줄). 이모지/장식 축소, 체인 캐시, 에러 처리 통일.

**v2.3.0** — 도구 프로필 (lite/full), URL 쿼리 API 키, kordoc 통합 파서.

**v2.2.0** — 23개 신규 도구 (64→87). 조약, 법령-자치법규 연계, 문서분석 엔진.

**v1.8~1.9** — 체인 도구 8개, 일괄 조문 조회, AI 검색 필터, 구조화 에러 포맷.

</details>

---

## 왜 만들었나

대한민국에는 **1,600개 이상의 현행 법률**, **10,000개 이상의 행정규칙**, 그리고 대법원·헌법재판소·조세심판원·관세청까지 이어지는 방대한 판례 체계가 있습니다. 이 모든 게 [법제처](https://www.law.go.kr)라는 하나의 사이트에 있지만, 개발자 경험은 최악입니다.

이 프로젝트는 그 전체 법령 시스템을 **15개 도구**로 감싸서, AI 어시스턴트나 스크립트에서 바로 호출할 수 있게 만듭니다. 법제처를 백 번째 수동 검색하다 지친 공무원이 만들었습니다.

---

## 설치 및 사용법

### 0단계: API 키 발급 (무료, 1분)

모든 방법에 공통으로 필요한 **법제처 Open API 인증키(OC)**를 먼저 발급받으세요.

1. [법제처 Open API 신청 페이지](https://open.law.go.kr/LSO/openApi/guideList.do)에 접속합니다.
2. 회원가입 후 로그인합니다.
3. **"Open API 사용 신청"** 버튼을 누릅니다.
4. 신청서를 작성하면 **인증키(OC)**가 발급됩니다. (예: `honggildong`)
5. 이 인증키를 아래 설정에서 사용합니다.

---

### 방법 1: Claude.ai 웹에서 바로 사용 (설치 없음, 가장 쉬움)

아무것도 설치하지 않고, 주소 하나만 입력하면 됩니다. Claude Pro/Max/Team/Enterprise 요금제가 필요합니다 (Free는 커넥터 1개만 가능).

**커넥터 추가 방법:**

1. [claude.ai](https://claude.ai)에 로그인합니다.
2. 왼쪽 사이드바 하단의 **본인 이름**을 클릭합니다.
3. **"설정"** (또는 Settings)을 선택합니다.
4. **"커넥터"** (또는 Connectors) 메뉴로 들어갑니다.
5. **"커스텀 커넥터"** 영역에서 **"커스텀 커넥터 추가"** 버튼을 클릭합니다.
6. 아래 내용을 입력합니다:
   - **이름**: `korean-law` (원하는 이름 아무거나 OK)
   - **URL**: 아래 주소를 붙여넣으세요. `honggildong` 부분을 **0단계에서 발급받은 본인 인증키**로 바꾸세요:

```
https://korean-law-mcp.fly.dev/mcp?oc=honggildong
```

7. **추가** 버튼을 누르면 등록 완료!

**도구 활성화 (중요!):**

8. 추가한 커넥터의 **"구성"** (또는 Configure)을 클릭합니다.
9. 도구 목록이 나오면, 모든 도구를 **"항상 사용"** (또는 Always allow)으로 설정합니다.
10. 이렇게 하면 매번 승인할 필요 없이 AI가 바로 법령을 검색할 수 있습니다.

**사용하기:**

11. 채팅 화면으로 돌아가서 "근로기준법 제74조 알려줘"라고 입력하면 끝!

> **참고**: 커넥터 URL을 수정하려면 삭제 후 다시 추가해야 합니다.

> v3부터 프로필 선택이 필요 없습니다. 15개 도구가 41개 API 전체를 커버합니다.
> 기존에 `?profile=lite&oc=...` 주소를 넣으셨다면 **그대로 두셔도 됩니다** — 동일하게 작동합니다.

---

### 방법 2: AI 데스크톱 앱에서 사용 (설치 없음)

Claude Desktop, Cursor, Windsurf 같은 **데스크톱 앱**을 쓰고 있다면, 설정 파일에 아래 내용을 추가하세요.

**설정 파일 위치 찾기:**

| 앱 이름 | Windows | Mac |
|---------|---------|-----|
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Cursor | 프로젝트 폴더 안 `.cursor/mcp.json` | 프로젝트 폴더 안 `.cursor/mcp.json` |
| Windsurf | 프로젝트 폴더 안 `.windsurf/mcp.json` | 프로젝트 폴더 안 `.windsurf/mcp.json` |

**설정 파일에 추가할 내용** (`honggildong`을 본인 인증키로 바꾸세요):

```json
{
  "mcpServers": {
    "korean-law": {
      "url": "https://korean-law-mcp.fly.dev/mcp?oc=honggildong"
    }
  }
}
```

> 이미 다른 MCP 서버가 설정되어 있다면, `"mcpServers": { ... }` 안에 `"korean-law": { ... }` 부분만 추가하면 됩니다.

저장 후 앱을 **재시작**하면 법령 도구가 활성화됩니다.

---

### 방법 3: 내 컴퓨터에 직접 설치 (오프라인 가능)

인터넷 없이 쓰고 싶거나, 원격 서버를 거치지 않으려면 직접 설치할 수 있습니다.

**사전 준비:** [Node.js](https://nodejs.org) 18 이상이 설치되어 있어야 합니다.

**자동 설치 (추천):**

```bash
npx korean-law-mcp setup
```

설치 마법사가 API 키 입력 → AI 클라이언트 선택 → 설정 파일 자동 등록까지 한 번에 처리합니다.
Claude Desktop, Claude Code, Cursor, VS Code, Windsurf, Gemini CLI를 지원합니다.

**수동 설치:**

```bash
npm install -g korean-law-mcp
```

AI 앱 설정 파일에 아래 내용을 추가합니다 (`honggildong`을 본인 인증키로 바꾸세요):

```json
{
  "mcpServers": {
    "korean-law": {
      "command": "korean-law-mcp",
      "env": {
        "LAW_OC": "honggildong"
      }
    }
  }
}
```

앱을 재시작하면 완료!

---

### 방법 4: 터미널(CLI)에서 직접 사용

개발자라면 터미널에서 직접 법령을 검색할 수 있습니다.

```bash
# 설치
npm install -g korean-law-mcp

# 인증키 설정 (honggildong을 본인 키로 바꾸세요)
export LAW_OC=honggildong        # Mac/Linux
set LAW_OC=honggildong           # Windows CMD
$env:LAW_OC="honggildong"       # Windows PowerShell

# 사용 예시
korean-law "민법 제1조"                    # 자연어로 바로 조회
korean-law search_law --query "관세법"     # 도구 직접 호출
korean-law list                            # 전체 도구 목록
korean-law list --category 판례            # 카테고리별 필터
korean-law help search_law                 # 도구별 도움말
```

---

### API 키 전달 방법 정리

여러 방법으로 인증키를 전달할 수 있습니다. 위에서부터 우선 적용됩니다:

| 방법 | 사용법 | 언제 쓰나 |
|------|--------|-----------|
| URL에 포함 | 주소 끝에 `?oc=내키` | 웹 클라이언트에서 가장 간편 |
| HTTP 헤더 | `apikey: 내키` | 프로그래밍으로 연동할 때 |
| 환경변수 | `LAW_OC=내키` | 로컬 설치(방법 3, 4) |
| 도구 파라미터 | `apiKey: "내키"` | 특정 요청만 다른 키 쓸 때 |

---

## 사용 예시

```
"관세법 제38조 알려줘"
→ search_law("관세법") → MST 획득 → get_law_text(mst, jo="003800")

"화관법 최근 개정 비교"
→ "화관법" → "화학물질관리법" 자동 변환 → compare_old_new(mst)

"근로기준법 제74조 해석례"
→ search_interpretations("근로기준법 제74조") → get_interpretation_text(id)

"산업안전보건법 별표1 내용 알려줘"
→ get_annexes(lawName="산업안전보건법 별표1") → HWPX 파일 다운로드 → 표/텍스트 Markdown 변환
```


---

## 도구 구조 (15개)

v3는 15개 도구만 노출합니다. 나머지 전문 도구는 `discover_tools` → `execute_tool`로 접근.

| 구분 | 도구 | 설명 | 시나리오 확장 |
|------|------|------|-------------|
| **체인** (8) | `chain_full_research` | 종합 리서치 (AI검색→법령→판례→해석) | `customs`: 관세·통관 종합 |
| | `chain_law_system` | 법체계 분석 (3단비교, 위임구조) | `delegation`: 위임입법 감시 / `impact`: 영향도 분석 |
| | `chain_action_basis` | 처분 근거 확인 (허가·인가·처분) | `penalty`: 처분·벌칙 기준 종합 |
| | `chain_dispute_prep` | 쟁송 대비 (불복·소송·심판) | — |
| | `chain_amendment_track` | 개정 추적 (신구대조, 연혁) | `timeline`: 시계열 타임라인 |
| | `chain_ordinance_compare` | 조례 비교 (상위법→전국 조례) | `compliance`: 상위법 적합성 검증 |
| | `chain_procedure_detail` | 절차·비용·서식 안내 | `manual`: 공무원 처리 매뉴얼 |
| | `chain_document_review` | 계약서·약관 리스크 분석 | — |
| **법령** (3) | `search_law` | 법령 검색 → lawId, MST 획득 |
| | `get_law_text` | 조문 전문 조회 |
| | `get_annexes` | 별표/서식 조회 (금액표·요율표·별지서식) |
| **통합** (2) | `search_decisions` | **17개 도메인** 통합 검색 (판례·헌재·조세심판·공정위·노동위·관세·해석례·행심·개인정보위·권익위·소청심사·학칙·공사공단·공공기관·조약·영문법령) |
| | `get_decision_text` | **17개 도메인** 전문 조회 |
| **메타** (2) | `discover_tools` | 전문 도구 검색 (용어·별표·이력·비교 등) |
| | `execute_tool` | 전문 도구 프록시 실행 |

전체 도구 상세는 [docs/API.md](docs/API.md) 참조.

---

## 주요 특징

- **41개 API → 15개 도구** — 법령, 판례, 행정규칙, 자치법규, 헌재결정, 조세심판, 관세해석, 조약, 학칙/공단/공공기관 규정, 법령용어
- **MCP + CLI** — Claude Desktop에서도, 터미널에서도 같은 도구 사용
- **법률 도메인 특화** — 약칭 자동 인식(`화관법` → `화학물질관리법`), 조문번호 변환(`제38조` ↔ `003800`), 3단 위임 구조 시각화
- **별표/별지서식 본문 추출** — HWPX·HWP·PDF·XLSX·DOCX 자동 변환 ([kordoc](https://github.com/chrisryugj/kordoc) 엔진)
- **8개 체인 + 7개 시나리오** — 기본 체인에 상황별 확장 분석 자동 추가 (과태료 감경, 관세 통관, 위임입법 감시 등)
- **17개 도메인 통합 검색** — `search_decisions` 하나로 판례·헌재·조세심판·공정위·노동위 등 즉시 접근
- **캐시** — 검색 1시간, 조문 24시간 TTL
- **원격 엔드포인트** — 설치 없이 `https://korean-law-mcp.fly.dev/mcp`로 바로 사용

---

## 문서

- [docs/API.md](docs/API.md) — 도구 레퍼런스
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 시스템 설계
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — 개발 가이드

## Star History

<a href="https://www.star-history.com/?repos=chrisryugj%2Fkorean-law-mcp&type=timeline&legend=bottom-right">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=chrisryugj/korean-law-mcp&type=timeline&theme=dark&legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=chrisryugj/korean-law-mcp&type=timeline&legend=top-left" />
    <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=chrisryugj/korean-law-mcp&type=timeline&legend=top-left" />
  </picture>
</a>

## 라이선스

[MIT](./LICENSE)

---

<sub>Made by 류주임 @ 광진구청 AI동호회 AI.Do</sub>
