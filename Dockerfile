# Korean Law MCP Server - Docker 배포용

FROM node:20-alpine

# 작업 디렉토리 설정
WORKDIR /app

# package.json 복사 및 의존성 설치
COPY package*.json ./
RUN npm ci --only=production

# TypeScript 빌드를 위해 devDependencies도 임시 설치
RUN npm install --save-dev typescript @types/node @types/express

# 소스 코드 복사
COPY src ./src
COPY tsconfig.json ./

# TypeScript 빌드
RUN npm run build

# devDependencies 제거 (프로덕션 경량화)
RUN npm prune --production

# 포트 노출
EXPOSE 3000

# 환경변수 (Railway에서 주입됨)
ENV NODE_ENV=production
ENV PORT=3000

# SSE 모드로 서버 시작
CMD ["node", "build/index.js", "--mode", "sse", "--port", "3000"]
