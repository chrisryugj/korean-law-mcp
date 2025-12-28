# CLAUDE.md

Korean Law MCP Server - 법제처 API 기반 MCP 서버 (58개 도구)

## Structure

```
src/
├── index.ts          # 엔트리포인트 (STDIO/SSE 모드)
├── tools/            # 58개 도구 (각 파일 200줄 미만)
├── lib/              # API 클라이언트, 파서, 정규화
└── server/           # HTTP/SSE 서버 (Express)
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

## Critical Rules

1. **LexDiff 코드 수정 금지**: `search-normalizer.ts`, `law-parser.ts`는 LexDiff에서 가져온 코드. 수정 시 원본 확인 필수
2. **파일 크기 200줄 미만**: 초과 시 `src/lib/`로 분리
3. **Zod 스키마**: 모든 도구 입력에 Zod 검증 필수

## Docs

상세 정보는 별도 문서 참조:
- [docs/API.md](docs/API.md) - 58개 도구 레퍼런스
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - 시스템 설계, 데이터 플로우
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) - 개발 가이드
