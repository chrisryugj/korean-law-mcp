# Korean Law MCP Server

국가법령정보센터 API 기반 MCP 서버 - 한국 법령 조회·비교 도구

## 🎯 특징

- **법령 검색**: 법령명 약칭 자동 인식 (화관법 → 화학물질관리법)
- **조문 조회**: 한글 조문 번호 자동 변환 (제38조 → 003800)
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

## 🛠️ Tools (총 5개)

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
git remote add origin https://github.com/yourusername/korean-law-mcp.git
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

- GitHub: https://github.com/yourusername/korean-law-mcp
- 법제처 API: https://www.law.go.kr/DRF/lawService.do
- MCP 문서: https://modelcontextprotocol.io
