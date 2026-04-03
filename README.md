# Korean Law MCP

**대한민국 법령 검색·조회·분석 87개 도구** — 법령, 판례, 행정규칙, 자치법규, 조약, 해석례를 AI 어시스턴트나 터미널에서 바로 사용.

[![npm version](https://img.shields.io/npm/v/korean-law-mcp.svg)](https://www.npmjs.com/package/korean-law-mcp)
[![MCP 1.27](https://img.shields.io/badge/MCP-1.27-blue)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> 법제처 Open API 기반 MCP 서버 + CLI. Claude Desktop, Cursor, Windsurf, Zed 등에서 바로 사용 가능.

[English](./README-EN.md)

![Korean Law MCP 데모](./demo.gif)

---

## v2.2.0 변경사항

- **23개 신규 도구 (64 → 87)** — 조약, 법령-자치법규 연계, 학칙/공단/공공기관 규정, 특별행정심판, 감사원 결정, 조항상세, 문서분석, 행정규칙 신구대조 등 대폭 확장.
- **문서분석 엔진** — 8종 문서유형 분류, 17개 리스크규칙, 금액/기간 추출, 조항 충돌 탐지. 계약서나 MOU를 넣으면 법적 리스크를 구조화해서 돌려준다.
- **법령-자치법규 연계 (4개 도구)** — 법률↔조례 위임 체인을 양방향 추적. 어떤 법률을 어느 조례가 구현하는지, 또는 조례의 근거 법령이 뭔지 한 번에.
- **조약 지원 (2개 도구)** — 대한민국이 체결한 양자/다자 조약 검색 및 전문 조회.
- **학칙/공단/공공기관 규정 (6개 도구)** — 학교 규칙, 공기업 규정, 공공기관 규정 각각 검색 + 전문 조회.
- **특별행정심판 (4개 도구)** — 감사원 특별행정심판과 이의신청 재결문 검색·조회.
- **판례/해석례 날짜 필터** — `fromDate`/`toDate` 파라미터로 기간 지정 검색 가능.
- **자연어 날짜 파서** — CLI에서 `"최근 3개월"`, `"작년"`, `"2024년 이후"` 등 자연어 시간 표현을 YYYYMMDD로 자동 변환.
- **보안 강화** — CORS 오리진 제어, API 키 헤더 전용(쿼리스트링 제거), 보안 헤더, 세션 ID 마스킹.

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

이 프로젝트는 그 전체 법령 시스템을 **87개 구조화된 도구**로 감싸서, AI 어시스턴트나 스크립트에서 바로 호출할 수 있게 만듭니다. 법제처를 백 번째 수동 검색하다 지친 공무원이 만들었습니다.

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

> **Claude Desktop 버전 요구사항**: 원격 MCP(Streamable HTTP)는 **Claude Desktop 0.9.0 이상**에서 지원됩니다. 이전 버전에서는 `url` 필드를 인식하지 못해 설정이 초기화될 수 있습니다. [Claude Desktop 최신 버전](https://claude.ai/download)을 설치해 주세요.

```json
{
  "mcpServers": {
    "korean-law": {
      "url": "https://korean-law-mcp.fly.dev/mcp"
    }
  }
}
```

원격 서버에는 기본 API 키가 설정되어 있어 **별도 API 키 없이 바로 사용 가능**합니다. 다만 공용 키이므로 사용량 제한(분당 60회)이 있습니다. 안정적인 사용을 위해서는 [법제처 Open API](https://open.law.go.kr/LSO/openApi/guideResult.do)에서 개인 키를 발급받아 로컬 설치 방식을 사용하는 것을 권장합니다.

<details>
<summary>원격 연결 문제 해결 (트러블슈팅)</summary>

#### 설정 파일이 초기화되는 경우

1. **Claude Desktop 버전 확인**: `0.9.0` 미만 버전은 원격 MCP를 지원하지 않습니다. 최신 버전으로 업데이트해 주세요.
2. **JSON 문법 확인**: 설정 파일에 쉼표(`,`)가 빠지거나 중복된 키가 있으면 Claude Desktop이 파일을 리셋합니다. JSON 유효성 검사기([jsonlint.com](https://jsonlint.com))로 검증해 보세요.
3. **기존 설정과 병합**: 이미 다른 MCP 서버가 설정되어 있다면, `mcpServers` 객체 안에 `korean-law`를 **추가**해야 합니다 (전체 교체 X).

```json
{
  "mcpServers": {
    "existing-server": { "command": "..." },
    "korean-law": {
      "url": "https://korean-law-mcp.fly.dev/mcp"
    }
  }
}
```

#### 연결은 되지만 도구 호출이 실패하는 경우

- 서버 상태 확인: 브라우저에서 `https://korean-law-mcp.fly.dev/health`를 열어 `{"status":"ok"}`가 반환되는지 확인하세요.
- Fly.io 서버가 자동 절전 상태(`suspend`)일 수 있습니다. 첫 요청 시 수 초간 대기가 발생할 수 있으며, 이후 정상 응답합니다.

#### 그래도 안 되면: npx로 로컬 실행

원격 연결이 계속 실패하면, 설치 없이 npx로 로컬 실행할 수 있습니다:

```json
{
  "mcpServers": {
    "korean-law": {
      "command": "npx",
      "args": ["-y", "korean-law-mcp"],
      "env": {
        "LAW_OC": "your-api-key"
      }
    }
  }
}
```

이 방식은 모든 Claude Desktop 버전에서 작동합니다. API 키는 [법제처 Open API](https://open.law.go.kr/LSO/openApi/guideResult.do)에서 무료 발급받을 수 있습니다.

</details>

### CLI

```bash
npm install -g korean-law-mcp
export LAW_OC=your-api-key

korean-law search_law --query "관세법"
korean-law get_law_text --mst 160001 --jo "제38조"
korean-law search_precedents --query "부당해고"
korean-law list                          # 87개 전체 도구 목록
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

## 도구 목록 (87개)

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
| **기타** | 10 | AI 검색, 영문법령, 연혁법령, 법령용어, 약칭, 법체계도, 행정규칙비교 |

전체 도구 상세는 [영문 README](./README-EN.md#tool-categories-87-total) 참조.

---

## 주요 특징

- **87개 법률 도구** — 법령, 판례, 행정규칙, 자치법규, 헌재결정, 조세심판, 관세해석, 조약, 학칙/공단/공공기관 규정, 법령용어
- **MCP + CLI** — Claude Desktop에서도, 터미널에서도 같은 87개 도구 사용
- **법률 도메인 특화** — 약칭 자동 인식(`화관법` → `화학물질관리법`), 조문번호 변환(`제38조` ↔ `003800`), 3단 위임 구조 시각화
- **별표/별지서식 본문 추출** — HWPX·HWP 파일 자동 다운로드 → 표/텍스트를 Markdown 변환
- **8개 체인 도구** — 복합 리서치를 한 번의 호출로 (예: `chain_full_research`: AI검색→법령→판례→해석)
- **캐시** — 검색 1시간, 조문 24시간 TTL
- **원격 엔드포인트** — 설치 없이 `https://korean-law-mcp.fly.dev/mcp`로 바로 사용

---

## 문서

- [docs/API.md](docs/API.md) — 87개 도구 레퍼런스
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 시스템 설계
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — 개발 가이드

## 라이선스

[MIT](./LICENSE)

---

<sub>Made by 류주임 @ 광진구청 AI동호회 AI.Do</sub>
