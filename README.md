# Korean Law MCP

**대한민국 법령 검색·조회·분석 89개 도구** — 법령, 판례, 행정규칙, 자치법규, 조약, 해석례를 AI 어시스턴트나 터미널에서 바로 사용.

[![npm version](https://img.shields.io/npm/v/korean-law-mcp.svg)](https://www.npmjs.com/package/korean-law-mcp)
[![MCP 1.27](https://img.shields.io/badge/MCP-1.27-blue)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> 법제처 Open API 기반 MCP 서버 + CLI. Claude Desktop, Cursor, Windsurf, Zed, Claude.ai 등에서 바로 사용 가능.

[English](./README-EN.md)

![Korean Law MCP 데모](./demo.gif)

---

## v2.3 변경사항

**원격 MCP 주소** (`your-key` 부분에 [법제처 Open API](https://open.law.go.kr/LSO/openApi/guideResult.do)에서 발급받은 본인 인증키(OC)를 넣으세요):

| 프로필 | URL | 도구 수 | 용도 |
|--------|-----|---------|------|
| lite | `https://korean-law-mcp.fly.dev/mcp?profile=lite&oc=your-key` | 14개 | Claude.ai 등 웹 클라이언트 (컨텍스트 87% 절감) |
| full | `https://korean-law-mcp.fly.dev/mcp?oc=your-key` | 89개 | Claude Desktop, Cursor 등 네이티브 클라이언트 |

예시: 발급받은 인증키가 `honggildong`이면 → `https://korean-law-mcp.fly.dev/mcp?profile=lite&oc=honggildong`

> lite는 체인 8개 + 핵심 4개 + 메타 2개로 동일 기능 커버. 특수 도구는 `discover_tools` → `execute_tool`로 접근.

- **도구 프로필 (lite/full)** — 89개 → 14개 자동 축소. 체인 도구가 내부에서 하위 도구를 직접 호출하므로 기능 손실 없음.
- **URL 쿼리 API 키** — `?oc=your-key`로 세션 전체에 API 키 자동 적용. 커스텀 헤더 설정이 어려운 웹 클라이언트에서 필수.
- **체인 자동 전문 조회** — `chain_ordinance_compare`가 자치법규 검색 후 상위 1건 전문을 자동 조회. 별도 `get_ordinance` 호출 불필요.
- **lite 도구 라우팅 개선** — 체인/메타 도구 description을 사용자 질문 의도 기반으로 재작성 + 예시 포함. Claude 웹이 "광진구 복무 조례" 같은 자치법규 질문에도 정확한 도구 선택.
- **도구 힌트 통일** — 비lite 도구 안내를 `execute_tool()` 호출 예시로 변경. 존재하지 않는 도구 직접 호출 문제 방지.
- **kordoc 통합 파서** — 자체 HWP5/HWPX/PDF 파서 5개를 [kordoc](https://github.com/chrisryugj/kordoc) 통합 파서로 교체. 의존성 경량화.

<details>
<summary>v2.2.0 변경사항</summary>

- **23개 신규 도구 (64 → 87)** — 조약, 법령-자치법규 연계, 학칙/공단/공공기관 규정, 특별행정심판, 감사원 결정, 조항상세, 문서분석, 행정규칙 신구대조 등 대폭 확장.
- **문서분석 엔진** — 8종 문서유형 분류, 17개 리스크규칙, 금액/기간 추출, 조항 충돌 탐지.
- **법령-자치법규 연계 (4개 도구)** — 법률↔조례 위임 체인을 양방향 추적.
- **조약 지원 (2개 도구)** — 대한민국이 체결한 양자/다자 조약 검색 및 전문 조회.
- **보안 강화** — CORS 오리진 제어, API 키 헤더 전용, 보안 헤더, 세션 ID 마스킹.

</details>

<details>
<summary>v1.8.0 – v1.9.0 기능</summary>

- **체인 도구 8개** — 복합 리서치를 한 번의 호출로: `chain_full_research`(AI검색→법령→판례→해석), `chain_law_system`, `chain_action_basis`, `chain_dispute_prep`, `chain_amendment_track`, `chain_ordinance_compare`, `chain_procedure_detail`.
- **일괄 조문 조회** — `get_batch_articles`가 `laws` 배열로 복수 법령 한 번에 조회.
- **AI 검색 법령종류 필터** — `search_ai_law`에 `lawTypes` 필터 추가.
- **구조화 에러 포맷** — `[에러코드] + 도구명 + 제안` 형식으로 64개 도구 통일.
- **HWP 테이블 수정** — 구형 HWP 파서에서 `paragraph.controls[].content` 경로의 테이블 추출 지원.

</details>

---

## 왜 만들었나

대한민국에는 **1,600개 이상의 현행 법률**, **10,000개 이상의 행정규칙**, 그리고 대법원·헌법재판소·조세심판원·관세청까지 이어지는 방대한 판례 체계가 있습니다. 이 모든 게 [법제처](https://www.law.go.kr)라는 하나의 사이트에 있지만, 개발자 경험은 최악입니다.

이 프로젝트는 그 전체 법령 시스템을 **89개 구조화된 도구**로 감싸서, AI 어시스턴트나 스크립트에서 바로 호출할 수 있게 만듭니다. 법제처를 백 번째 수동 검색하다 지친 공무원이 만들었습니다.

---

## 빠른 시작

### MCP 서버 (Claude Desktop / Cursor / Windsurf)

```bash
npm install -g korean-law-mcp
```

MCP 클라이언트 설정에 추가:

```json
{
  "mcpServers": {
    "korean-law": {
      "command": "korean-law-mcp",
      "env": {
        "LAW_OC": "your-api-key"
      }
    }
  }
}
```

API 키는 [법제처 Open API](https://open.law.go.kr/LSO/openApi/guideResult.do)에서 무료 발급.

| 클라이언트 | 설정 파일 |
|-----------|----------|
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` (Win) / `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac) |
| Cursor | `.cursor/mcp.json` |
| Windsurf | `.windsurf/mcp.json` |
| Continue | `~/.continue/config.json` |
| Zed | `~/.config/zed/settings.json` |

### 원격 MCP (설치 없이 바로)

API 키를 URL에 포함하여 바로 사용:

```json
{
  "mcpServers": {
    "korean-law": {
      "url": "https://korean-law-mcp.fly.dev/mcp?oc=your-api-key"
    }
  }
}
```

**Claude.ai 등 웹 클라이언트** — 컨텍스트 절약을 위해 lite 프로필 권장:

```
https://korean-law-mcp.fly.dev/mcp?profile=lite&oc=your-api-key
```

> lite 프로필은 체인 8개 + 핵심 4개 + 메타 2개 = **14개 도구**로 동일 기능 커버. 특수 도구가 필요하면 `discover_tools` → `execute_tool`로 접근.

**API 키 전달 방법** (우선순위순):

| 방법 | 예시 | 설명 |
|------|------|------|
| URL 쿼리 | `?oc=your-key` | 웹 클라이언트에서 가장 간편. 세션 전체에 자동 적용 |
| HTTP 헤더 | `apikey: your-key` | `law-oc`, `x-api-key`, `Authorization: Bearer` 등도 지원 |
| 도구 파라미터 | `apiKey: "your-key"` | 개별 도구 호출 시 직접 전달 |

> API 키는 [법제처 Open API](https://open.law.go.kr/LSO/openApi/guideResult.do)에서 무료 발급.

### CLI

```bash
npm install -g korean-law-mcp
export LAW_OC=your-api-key

echo 'export PATH=$PATH:~/.npm-global/bin' >> ~/.bashrc
source ~/.bashrc
which korean-law

korean-law search_law --query "관세법"
korean-law get_law_text --mst 160001 --jo "제38조"
korean-law search_precedents --query "부당해고"
korean-law list                          # 89개 전체 도구 목록
korean-law list --category 판례          # 카테고리별 필터
korean-law help search_law               # 도구 도움말
```

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

## 도구 목록 (89개)

| 카테고리 | 개수 | 주요 도구 |
|----------|------|----------|
| **검색** | 11 | `search_law`, `search_precedents`, `search_all`, `get_annexes` |
| **조회** | 9 | `get_law_text`, `get_batch_articles`, `compare_old_new`, `get_three_tier` |
| **분석** | 10 | `compare_articles`, `get_law_tree`, `summarize_precedent`, `analyze_document` |
| **전문: 조세/관세** | 4 | `search_tax_tribunal_decisions`, `search_customs_interpretations` |
| **전문: 헌재/행심** | 4 | `search_constitutional_decisions`, `search_admin_appeals` |
| **전문: 위원회 결정** | 8 | 공정위, 개보위, 노동위, 감사원 |
| **특별행정심판** | 4 | `search_acr_special_appeals`, `search_appeal_review_decisions` |
| **법령-자치법규 연계** | 4 | `get_linked_ordinances`, `get_delegated_laws` |
| **조약** | 2 | `search_treaties`, `get_treaty_text` |
| **학칙/공단/공공기관** | 6 | `search_school_rules`, `search_public_corp_rules`, `search_public_institution_rules` |
| **지식베이스** | 7 | `get_legal_term_kb`, `get_daily_to_legal`, `get_related_laws` |
| **체인** | 8 | `chain_full_research`, `chain_law_system`, `chain_document_review` |
| **메타** | 2 | `discover_tools`, `execute_tool` (lite 프로필용) |
| **기타** | 10 | AI 검색, 영문법령, 연혁법령, 법령용어, 약칭, 법체계도, 행정규칙비교 |

전체 도구 상세는 [영문 README](./README-EN.md#tool-categories-89-total) 참조.

---

## 주요 특징

- **89개 법률 도구** — 법령, 판례, 행정규칙, 자치법규, 헌재결정, 조세심판, 관세해석, 조약, 학칙/공단/공공기관 규정, 법령용어
- **MCP + CLI** — Claude Desktop에서도, 터미널에서도 같은 89개 도구 사용
- **법률 도메인 특화** — 약칭 자동 인식(`화관법` → `화학물질관리법`), 조문번호 변환(`제38조` ↔ `003800`), 3단 위임 구조 시각화
- **별표/별지서식 본문 추출** — HWPX·HWP 파일 자동 다운로드 → 표/텍스트를 Markdown 변환
- **8개 체인 도구** — 복합 리서치를 한 번의 호출로 (예: `chain_full_research`: AI검색→법령→판례→해석)
- **도구 프로필** — 웹 클라이언트용 lite(14개), 파워유저용 full(89개) 자동 선택
- **캐시** — 검색 1시간, 조문 24시간 TTL
- **원격 엔드포인트** — 설치 없이 `https://korean-law-mcp.fly.dev/mcp`로 바로 사용

---

## 문서

- [docs/API.md](docs/API.md) — 89개 도구 레퍼런스 (프로필 포함)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 시스템 설계
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — 개발 가이드

## 라이선스

[MIT](./LICENSE)

---

<sub>Made by 류주임 @ 광진구청 AI동호회 AI.Do</sub>
