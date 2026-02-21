# Korean Law MCP Server

법제처 Open API 기반 한국 법령 MCP 서버. 58개 도구로 법령, 판례, 행정규칙, 자치법규, 법령해석례 등을 검색·조회·분석할 수 있다.

[![MCP Compatible](https://img.shields.io/badge/MCP-1.26-blue)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)

## 주요 특징

- **법률 도메인 특화**: 약칭 자동 인식(`화관법` → `화학물질관리법`), 조문번호 변환(`제38조` ↔ `003800`), 3단 위임 구조 시각화
- **별표/별지서식 본문 추출**: HWPX·HWP 파일을 자동 다운로드 → 텍스트/표를 Markdown으로 변환. PDF는 링크 반환
- **58개 도구**: 법령·판례·행정규칙·자치법규·헌재결정·행정심판·조세심판·관세해석·법령용어 등 포괄
- **STDIO + SSE**: 로컬(Claude Desktop 등) 및 원격 배포 모두 지원
- **캐시**: 검색 1시간, 조문 24시간 TTL

## 설치

### 사전 준비

- Node.js 18+
- [법제처 API 키](https://open.law.go.kr/LSO/openApi/guideResult.do) (무료)

### npm 글로벌 설치

```bash
npm install -g korean-law-mcp
```

### MCP 클라이언트 설정

아래 JSON을 각 클라이언트 설정 파일에 추가한다.

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

| 클라이언트 | 설정 파일 |
|-----------|----------|
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` (Win) / `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac) |
| Cursor | `.cursor/mcp.json` |
| Windsurf | `.windsurf/mcp.json` |
| Continue | `~/.continue/config.json` (배열 형식: `"mcpServers": [...]`) |
| Zed | `~/.config/zed/settings.json` (`"context_servers"` 키 사용) |

설정 후 클라이언트를 재시작하면 바로 사용 가능.

### 원격 MCP (설치 없이 바로 사용)

공개 엔드포인트를 MCP 클라이언트에 등록하면 설치 없이 사용 가능하다.

```json
{
  "mcpServers": {
    "korean-law": {
      "url": "https://korean-law-mcp.fly.dev/mcp"
    }
  }
}
```

> API 키를 헤더로 전달하려면 `x-law-oc` 헤더를 사용한다.

### Docker / 자체 배포

```bash
docker build -t korean-law-mcp .
docker run -e LAW_OC=your-api-key -p 3000:3000 korean-law-mcp
```

MCP 엔드포인트: `https://your-host:3000/mcp`

## 도구 목록 (58개)

### 검색 (11개)

| 도구 | 설명 |
|------|------|
| `search_law` | 법령 검색 (약칭 자동 인식) |
| `search_admin_rule` | 행정규칙 검색 (훈령/예규/고시) |
| `search_ordinance` | 자치법규 검색 |
| `search_precedents` | 판례 검색 |
| `search_interpretations` | 법령해석례 검색 |
| `search_all` | 통합 검색 |
| `suggest_law_names` | 법령명 자동완성 |
| `advanced_search` | 고급 검색 (기간/키워드 필터) |
| `get_law_history` | 날짜별 법령 변경이력 |
| `get_annexes` | 별표/별지서식 조회 + HWPX/HWP 본문 추출 |
| `parse_jo_code` | 조문번호 ↔ JO 코드 변환 |

### 조회 (9개)

| 도구 | 설명 |
|------|------|
| `get_law_text` | 법령 조문 전문 |
| `get_admin_rule` | 행정규칙 전문 |
| `get_ordinance` | 자치법규 전문 |
| `get_precedent_text` | 판례 전문 |
| `get_interpretation_text` | 법령해석례 전문 |
| `get_batch_articles` | 여러 조문 일괄 조회 |
| `get_article_with_precedents` | 조문 + 관련 판례 |
| `compare_old_new` | 신구법 대조 |
| `get_three_tier` | 법률→시행령→시행규칙 3단 비교 |

### 분석 (9개)

| 도구 | 설명 |
|------|------|
| `compare_articles` | 법령 간 조문 비교 |
| `get_law_tree` | 위임 구조 트리 |
| `get_article_history` | 조문 개정 연혁 |
| `summarize_precedent` | 판례 요약 |
| `extract_precedent_keywords` | 판례 키워드 추출 |
| `find_similar_precedents` | 유사 판례 검색 |
| `get_law_statistics` | 법령 통계 |
| `parse_article_links` | 조문 내 참조 파싱 |
| `get_external_links` | 외부 링크 생성 |

### 전문 분야 (4개)

| 도구 | 설명 |
|------|------|
| `search_tax_tribunal_decisions` | 조세심판원 재결례 검색 |
| `get_tax_tribunal_decision_text` | 재결례 전문 |
| `search_customs_interpretations` | 관세청 법령해석 검색 |
| `get_customs_interpretation_text` | 관세 해석 전문 |

### 헌재·행심·위원회 결정 (6개)

| 도구 | 설명 |
|------|------|
| `search_constitutional_decisions` | 헌법재판소 결정례 검색 |
| `get_constitutional_decision_text` | 헌재 결정 전문 |
| `search_admin_appeals` | 행정심판례 검색 |
| `get_admin_appeal_text` | 행정심판 전문 |
| `search_ftc_decisions` / `search_nlrc_decisions` / `search_pipc_decisions` | 공정위/노동위/개보위 결정 검색 |
| `get_ftc_decision_text` / `get_nlrc_decision_text` / `get_pipc_decision_text` | 결정 전문 |

### 지식베이스 (7개)

| 도구 | 설명 |
|------|------|
| `get_legal_term_kb` | 법령용어 지식베이스 검색 |
| `get_legal_term_detail` | 용어 상세 정의 |
| `get_daily_term` | 일상용어 검색 |
| `get_daily_to_legal` | 일상용어 → 법령용어 |
| `get_legal_to_daily` | 법령용어 → 일상용어 |
| `get_term_articles` | 용어 사용 조문 |
| `get_related_laws` | 관련법령 조회 |

### 기타 (2개)

| 도구 | 설명 |
|------|------|
| `search_ai_law` | 자연어 지능형 검색 |
| `search_english_law` / `get_english_law_text` | 영문법령 검색/조회 |
| `search_historical_law` / `get_historical_law` | 연혁법령 검색/조회 |
| `search_legal_terms` | 법령용어 사전 검색 |

## 사용 예시

```
사용자: "관세법 제38조 알려줘"
→ search_law("관세법") → MST 획득 → get_law_text(mst, jo="003800")

사용자: "화관법 최근 개정 비교"
→ "화관법" → "화학물질관리법" 자동 변환 → compare_old_new(mst)

사용자: "근로기준법 제74조 해석례"
→ search_interpretations("근로기준법 제74조") → get_interpretation_text(id)

사용자: "산업안전보건법 별표1 내용 알려줘"
→ get_annexes(lawName="산업안전보건법 별표1") → HWPX 파일 다운로드 → 표/텍스트 Markdown 변환
```

## 환경변수

| 변수 | 필수 | 기본값 | 설명 |
|------|------|--------|------|
| `LAW_OC` | O | - | 법제처 API 키 ([발급](https://open.law.go.kr/LSO/openApi/guideResult.do)) |
| `PORT` | X | 3000 | HTTP 서버 포트 |
| `CORS_ORIGIN` | X | `*` | CORS 허용 오리진 (프로덕션 배포 시 반드시 설정 권장) |
| `RATE_LIMIT_RPM` | X | 60 | IP당 분당 요청 제한 (0=비활성화) |

## 문서

- [docs/API.md](docs/API.md) - 58개 도구 레퍼런스
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - 시스템 설계
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) - 개발 가이드

## 라이선스

MIT - [LICENSE](LICENSE) 참조

## 감사

- [법제처](https://www.law.go.kr) Open API
- [LexDiff](https://github.com/chrisryugj/lexdiff) 검색어 정규화 코드
- [Anthropic](https://anthropic.com) MCP 프로토콜

---

<sub>Made by 류주임 @ 광진구청 AI동호회 AI.Do</sub>
