# Korean Law MCP Server

국가법령정보센터 API 기반 MCP 서버 - 한국 법령 조회·비교 도구

## 🎯 특징

- **법령 검색**: 법령명 약칭 자동 인식 (화관법 → 화학물질관리법)
- **조문 조회**: 한글 조문 번호 자동 변환 (제38조 → 003800)
- **신구법 대조**: 개정 전후 비교
- **3단비교**: 법률→시행령→시행규칙 위임 관계 추적
- **행정규칙**: 훈령, 예규, 고시 검색 및 조회
- **별표/서식**: 법령 첨부 문서 조회
- **자치법규**: 조례, 규칙 조회
- **판례**: 대법원 등 각급 법원 판례 검색 및 전문 조회
- **법령해석례**: 법제처 법령해석 검색 및 전문 조회
- **안정성**: LexDiff 프로젝트에서 검증된 코드 재사용

## 📦 설치

```bash
npm install -g korean-law-mcp
```

## 🔧 Claude Desktop 설정

### Windows
파일 경로: `%APPDATA%\Claude\claude_desktop_config.json`

### macOS
파일 경로: `~/Library/Application Support/Claude/claude_desktop_config.json`

### 설정 내용

```json
{
  "mcpServers": {
    "korean-law": {
      "command": "node",
      "args": ["C:\\github_project\\korean-law-mcp\\build\\index.js"],
      "env": {
        "LAW_OC": "your-api-key-here"
      }
    }
  }
}
```

## 🔑 API 키 발급

1. 법제처 국가법령정보센터 오픈API 신청
2. https://www.law.go.kr/DRF/lawService.do
3. 신청 후 발급된 인증키를 `LAW_OC` 환경변수로 설정

## 🛠️ Tools (총 13개)

### 핵심 Tools

### 1. search_law 🔍
법령을 검색합니다. 약칭 자동 인식 (화관법→화학물질관리법)

**입력**:
- `query` (필수): 검색할 법령명
- `maxResults` (선택): 최대 결과 개수 (기본값: 20)

**예시**:
```json
{
  "query": "화관법"
}
```

### 2. get_law_text 📜
법령 조문을 조회합니다. 한글 조문 번호 자동 변환

**입력**:
- `mst` 또는 `lawId` (필수): search_law에서 획득
- `jo` (선택): 조문 번호 (예: "제38조" 또는 "003800")
- `efYd` (선택): 시행일자 (YYYYMMDD)

**예시**:
```json
{
  "mst": "000013",
  "jo": "제38조"
}
```

### 3. parse_jo_code 🔄
조문 번호를 JO 코드와 한글 간 양방향 변환

**입력**:
- `joText` (필수): 변환할 조문 번호
- `direction` (선택): "to_code" 또는 "to_text"

**예시**:
```json
{
  "joText": "제38조",
  "direction": "to_code"
}
```

### 4. compare_old_new ⚖️
신구법 대조 (개정 전후 비교)

**입력**:
- `mst` 또는 `lawId` (필수)
- `ld` (선택): 공포일자
- `ln` (선택): 공포번호

**예시**:
```json
{
  "mst": "000013"
}
```

### 5. get_three_tier 🏛️
3단비교 (법률→시행령→시행규칙 위임 관계)

**입력**:
- `mst` 또는 `lawId` (필수)
- `knd` (선택): "1" (인용조문) 또는 "2" (위임조문, 기본값)

**예시**:
```json
{
  "mst": "000013",
  "knd": "2"
}
```

### 추가 Tools

### 6. search_admin_rule 📋
행정규칙(훈령, 예규, 고시 등)을 검색합니다.

**입력**:
- `query` (필수): 검색할 행정규칙명
- `knd` (선택): 행정규칙 종류 (1=훈령, 2=예규, 3=고시, 4=공고, 5=일반)
- `maxResults` (선택): 최대 결과 개수 (기본값: 20)

**예시**:
```json
{
  "query": "개인정보보호",
  "knd": "2"
}
```

### 7. get_admin_rule 📄
행정규칙의 상세 내용을 조회합니다.

**입력**:
- `id` (필수): 행정규칙ID (search_admin_rule에서 획득)

**예시**:
```json
{
  "id": "ADM000123"
}
```

### 8. get_annexes 📎
법령의 별표 및 서식을 조회합니다.

**입력**:
- `lawName` (필수): 법령명
- `knd` (선택): 1=별표, 2=서식, 3=부칙별표, 4=부칙서식, 5=전체

**예시**:
```json
{
  "lawName": "관세법",
  "knd": "1"
}
```

### 9. get_ordinance 🏛️
자치법규(조례, 규칙)를 조회합니다.

**입력**:
- `ordinSeq` (필수): 자치법규 일련번호

**예시**:
```json
{
  "ordinSeq": "ORD000456"
}
```

### 10. search_precedents ⚖️
판례를 검색합니다. 키워드, 법원명, 사건번호로 검색 가능합니다.

**입력**:
- `query` (선택): 검색 키워드 (예: "자동차", "담보권")
- `court` (선택): 법원명 필터 (예: "대법원", "서울고등법원")
- `caseNumber` (선택): 사건번호 (예: "2009느합133")
- `display` (선택): 페이지당 결과 개수 (기본값: 20, 최대: 100)
- `page` (선택): 페이지 번호 (기본값: 1)
- `sort` (선택): 정렬 옵션

**예시**:
```json
{
  "query": "담보권",
  "court": "대법원",
  "display": 10
}
```

### 11. get_precedent_text 📖
판례의 전문(판시사항, 판결요지, 참조조문 등)을 조회합니다.

**입력**:
- `id` (필수): 판례일련번호 (search_precedents에서 획득)
- `caseName` (선택): 판례명 (검증용)

**예시**:
```json
{
  "id": "228541"
}
```

### 12. search_interpretations 💬
법령해석례를 검색합니다.

**입력**:
- `query` (필수): 검색 키워드 (예: "자동차", "근로기준법")
- `display` (선택): 페이지당 결과 개수 (기본값: 20, 최대: 100)
- `page` (선택): 페이지 번호 (기본값: 1)
- `sort` (선택): 정렬 옵션

**예시**:
```json
{
  "query": "근로기준법",
  "display": 10
}
```

### 13. get_interpretation_text 📝
법령해석례의 전문(질의요지, 회신내용, 이유)을 조회합니다.

**입력**:
- `id` (필수): 법령해석례일련번호 (search_interpretations에서 획득)
- `caseName` (선택): 안건명 (검증용)

**예시**:
```json
{
  "id": "123456"
}
```

## 🔨 개발

```bash
# 의존성 설치
npm install

# 빌드
npm run build

# 로컬 실행 (STDIO 모드)
LAW_OC=your-api-key node build/index.js

# 로컬 실행 (SSE 모드 - 리모트 테스트용)
LAW_OC=your-api-key node build/index.js --mode sse --port 3000

# MCP Inspector로 테스트
npx @modelcontextprotocol/inspector build/index.js
```

## 🚀 리모트 배포 (Railway)

### 1. GitHub에 코드 푸시
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/chrisryugj/korean-law-mcp.git
git push -u origin main
```

### 2. Railway 배포
1. https://railway.app 접속 및 로그인
2. "New Project" → "Deploy from GitHub repo" 선택
3. `korean-law-mcp` 레포지토리 선택
4. 환경변수 설정:
   - `LAW_OC`: 법제처 API 키 입력
5. 자동 배포 시작! (Dockerfile 인식)

### 3. PlayMCP 등록
배포 완료 후 Railway가 제공하는 URL을 복사:
- 예: `https://korean-law-mcp-production.up.railway.app`
- PlayMCP에 등록할 SSE 엔드포인트: `https://your-app.railway.app/sse`

## 🌐 대체 배포 옵션

### Render
1. https://render.com 접속
2. "New Web Service" → GitHub 연동
3. 환경변수 `LAW_OC` 설정
4. 자동 배포

### Docker 로컬 테스트
```bash
# 이미지 빌드
docker build -t korean-law-mcp .

# 컨테이너 실행
docker run -p 3000:3000 -e LAW_OC=your-api-key korean-law-mcp

# 테스트
curl http://localhost:3000/health
```

## 📝 라이선스

MIT

## 🔗 링크

- GitHub: https://github.com/chrisryugj/korean-law-mcp
- 법제처 API: https://www.law.go.kr/DRF/lawService.do
- MCP 문서: https://modelcontextprotocol.io
