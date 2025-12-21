# 한국 법령 챗봇 웹 UI 개발 계획

## 목표

**MCP 서버는 이미 배포됨** → 웹 UI만 Vercel로 새로 만들기

**사용자**: 와이프 + 지인들 (법령 조회가 필요한 일반인)
**배포**: Vercel (무료 Hobby 플랜)
**LLM**: Gemini 2.0 Flash (무료 tier)
**백엔드**: 기존 korean-law-mcp HTTP 엔드포인트 활용

---

## 전제 조건

- ✅ korean-law-mcp 서버는 이미 배포돼 있음 (HTTP 모드)
- ✅ MCP 엔드포인트: `https://your-deployed-mcp.com/mcp`
- ✅ Bearer Token 인증 이미 적용됨
- ⚠️ MCP 서버 수정 불필요 - 웹 UI만 개발

---

## 프로젝트 구조
**새 저장소**: `korean-law-chatbot`

```
korean-law-chatbot/
├── app/
│   ├── api/
│   │   └── chat/
│   │       └── route.ts        # Vercel AI SDK 엔드포인트
│   ├── page.tsx                # 메인 채팅 UI
│   └── layout.tsx
├── lib/
│   ├── mcp-client.ts           # korean-law-mcp HTTP 클라이언트
│   └── gemini.ts               # Gemini API 설정
├── components/
│   ├── chat-interface.tsx      # 카카오톡 스타일 채팅
│   ├── law-card.tsx            # 법령 조회 결과 카드
│   └── message-bubble.tsx      # 메시지 말풍선
└── package.json
```

## 기술 스택
- **Frontend**: Next.js 15 App Router + Tailwind CSS
- **LLM**: Gemini 2.0 Flash (무료 tier, Vercel AI SDK)
- **MCP 연결**: 기존 korean-law-mcp HTTP 엔드포인트
- **배포**: Vercel (무료 Hobby 플랜)
- **디자인**: 카카오톡 스타일 채팅 UI

---

## 구현 단계별 작업

### 1단계: 프로젝트 초기 설정 (1시간)
```bash
npx create-next-app@latest korean-law-chatbot --typescript --tailwind --app
cd korean-law-chatbot
npm install ai @ai-sdk/google
```

**package.json 의존성**:
- `next`: ^15.0.0
- `react`: ^19.0.0
- `ai`: ^4.0.0
- `@ai-sdk/google`: ^1.0.0
- `tailwindcss`: ^3.4.0

### 2단계: MCP 클라이언트 구현 (2시간)
**파일**: `lib/mcp-client.ts`
- MCP HTTP 엔드포인트 연결
- Bearer Token 인증 헤더
- 33개 도구 → Vercel AI SDK 형식 변환
- JSON-RPC 2.0 호출 로직

### 3단계: 채팅 UI 컴포넌트 (3시간)
**파일**:
- `app/page.tsx` - 메인 레이아웃
- `components/chat-interface.tsx` - 메시지 리스트 + 입력창
- `components/message-bubble.tsx` - 카카오톡 스타일 말풍선
- `components/example-query.tsx` - 예제 질문 버튼

### 4단계: 법령 카드 렌더링 (1시간)
**파일**: `components/law-card.tsx`
- MCP tool 결과를 카드 UI로 표시
- 법령명, 조문 번호, 시행일, 내용
- 법제처 외부 링크

### 5단계: 스타일링 (2시간)
**Tailwind 설정**:
- 카카오톡 노란색 (#FFE812)
- 그라데이션 배경
- 모바일 반응형

### 6단계: Vercel 배포 (1시간)
1. GitHub Push
2. Vercel Import
3. 환경변수 설정
4. 테스트 및 검증

---

## 예상 소요 시간

**총합**: 약 10시간 (1-2일)

---

## 성공 기준

- [ ] Vercel 배포 성공 (HTTPS 도메인 생성)
- [ ] Gemini API 연동 정상 동작
- [ ] MCP 33개 도구 모두 호출 가능
- [ ] 카카오톡 스타일 UI 구현
- [ ] 모바일/데스크톱 반응형
- [ ] 와이프 + 지인 1명 이상 테스트 완료
