# Korean Law MCP

**대한민국 법령 검색·조회·분석 64개 도구** — 법령, 판례, 행정규칙, 자치법규, 해석례를 AI 어시스턴트나 터미널에서 바로 사용.

[![npm version](https://img.shields.io/npm/v/korean-law-mcp.svg)](https://www.npmjs.com/package/korean-law-mcp)
[![MCP 1.27](https://img.shields.io/badge/MCP-1.27-blue)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> 법제처 Open API 기반 MCP 서버 + CLI. Claude Desktop, Cursor, Windsurf, Zed 등에서 바로 사용 가능.

[English](./README.md)

---

## 왜 만들었나

대한민국에는 **1,600개 이상의 현행 법률**, **10,000개 이상의 행정규칙**, 그리고 대법원·헌법재판소·조세심판원·관세청까지 이어지는 방대한 판례 체계가 있습니다. 이 모든 게 [법제처](https://www.law.go.kr)라는 하나의 사이트에 있지만, 개발자 경험은 최악입니다.

이 프로젝트는 그 전체 법령 시스템을 **64개 구조화된 도구**로 감싸서, AI 어시스턴트나 스크립트에서 바로 호출할 수 있게 만듭니다. 법제처를 백 번째 수동 검색하다 지친 공무원이 만들었습니다.

---

## 주요 특징

- **64개 법률 도구** — 법령, 판례, 행정규칙, 자치법규, 헌재결정, 조세심판, 관세해석, 법령용어
- **MCP + CLI** — Claude Desktop에서도, 터미널에서도 같은 64개 도구 사용
- **법률 도메인 특화** — 약칭 자동 인식(`화관법` → `화학물질관리법`), 조문번호 변환(`제38조` ↔ `003800`), 3단 위임 구조 시각화
- **별표/별지서식 본문 추출** — HWPX·HWP 파일 자동 다운로드 → 표/텍스트를 Markdown 변환
- **7개 체인 도구** — 복합 리서치를 한 번의 호출로 (예: `chain_full_research`: AI검색→법령→판례→해석)
- **캐시** — 검색 1시간, 조문 24시간 TTL
- **원격 엔드포인트** — 설치 없이 `https://korean-law-mcp.fly.dev/mcp`로 바로 사용

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

```json
{
  "mcpServers": {
    "korean-law": {
      "url": "https://korean-law-mcp.fly.dev/mcp"
    }
  }
}
```

### CLI

```bash
npm install -g korean-law-mcp
export LAW_OC=your-api-key

korean-law search_law --query "관세법"
korean-law get_law_text --mst 160001 --jo "제38조"
korean-law search_precedents --query "부당해고"
korean-law list                          # 64개 전체 도구 목록
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

## 도구 목록 (64개)

| 카테고리 | 개수 | 주요 도구 |
|----------|------|----------|
| **검색** | 11 | `search_law`, `search_precedents`, `search_all`, `get_annexes` |
| **조회** | 9 | `get_law_text`, `get_batch_articles`, `compare_old_new`, `get_three_tier` |
| **분석** | 9 | `compare_articles`, `get_law_tree`, `summarize_precedent`, `find_similar_precedents` |
| **전문분야** | 10 | 조세심판, 관세해석, 헌재결정, 행정심판, 공정위/노동위/개보위 |
| **지식베이스** | 7 | `get_legal_term_kb`, `get_daily_to_legal`, `get_related_laws` |
| **체인** | 7 | `chain_full_research`, `chain_law_system`, `chain_dispute_prep` |
| **기타** | 4 | AI 검색, 영문법령, 연혁법령, 법령용어사전 |

전체 도구 목록은 [영문 README](./README.md#tool-categories-64-total) 참조.

---

## 문서

- [docs/API.md](docs/API.md) — 64개 도구 레퍼런스
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 시스템 설계
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — 개발 가이드

## 라이선스

[MIT](./LICENSE)

---

<sub>Made by 류주임 @ 광진구청 AI동호회 AI.Do</sub>
