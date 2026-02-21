# CLAUDE.md

Korean Law MCP Server - 법제처 API 기반 MCP 서버 (58개 도구)

## Structure

```
src/
├── index.ts              # 엔트리포인트 (55줄, STDIO/SSE 모드)
├── tool-registry.ts      # 58개 도구 등록 (~470줄)
├── tools/                # 도구 구현 (각 파일 200줄 미만)
├── lib/
│   ├── api-client.ts     # API 클라이언트
│   ├── fetch-with-retry.ts  # 타임아웃/재시도
│   ├── session-state.ts  # 세션별 API 키 관리
│   ├── xml-parser.ts     # 공통 XML 파싱
│   ├── errors.ts         # 에러 표준화
│   ├── schemas.ts        # 날짜/응답크기 검증
│   ├── search-normalizer.ts  # 검색어 정규화 (LexDiff)
│   └── law-parser.ts     # JO 코드 변환 (LexDiff)
└── server/               # HTTP/SSE 서버 (Express)
```

## Commands

```bash
npm install           # 의존성 설치
npm run build         # TypeScript 빌드
npm run watch         # 개발 모드
LAW_OC=키 node build/index.js  # 로컬 실행
```

## Environment

`LAW_OC`: 법제처 API 키 (필수) - https://www.law.go.kr/DRF/lawService.do

## Domain Knowledge

**JO Code**: 조문번호 6자리 코드 (AAAABB)
- AAAA: 조번호 (zero-padded)
- BB: 의X 번호 (없으면 00)
- 예: 제38조 → 003800, 제10조의2 → 001002

## AI Usage Patterns

**자치법규 → 상위법령 Fallback**:
자치법규(조례/규칙)에서 원하는 규정을 못 찾으면 상위법령 검색

| 키워드 | 상위법령 | 주요 조문 |
|--------|----------|-----------|
| 휴직, 복무, 징계 | 지방공무원법 | 제63조(휴직), 제48조(복무), 제69조(징계) |
| 인사, 임용 | 지방공무원 임용령 | - |
| 급여, 수당 | 지방공무원 보수규정 | - |

**검색 체인 예시**:
```
search_ordinance("광진구 휴직") → 없음
  ↓
search_law("지방공무원법") → MST 획득
  ↓
get_law_text(mst, jo="006300") → 제63조(휴직) 조회
```

## Critical Rules

1. **LexDiff 코드 수정 금지**: `search-normalizer.ts`, `law-parser.ts`는 LexDiff에서 가져온 코드. 수정 시 원본 확인 필수
2. **파일 크기 200줄 미만**: 초과 시 `src/lib/`로 분리
3. **Zod 스키마**: 모든 도구 입력에 Zod 검증 필수
4. **도구 추가**: `tool-registry.ts`의 `allTools` 배열에 추가

## Key Files

| 파일 | 역할 |
|------|------|
| `tool-registry.ts` | 58개 도구 정의 및 등록 |
| `lib/fetch-with-retry.ts` | 30초 타임아웃, 3회 재시도 |
| `lib/session-state.ts` | 멀티세션 API 키 격리 |
| `lib/xml-parser.ts` | 6개 도메인별 XML 파서 |

## Docs

상세 정보는 별도 문서 참조:
- [docs/API.md](docs/API.md) - 58개 도구 레퍼런스
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - 시스템 설계, 데이터 플로우
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) - 개발 가이드
