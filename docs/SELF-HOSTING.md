# 직접 운영·사내망 설정

[English](SELF-HOSTING-EN.md) · [README](../README.md)

공개 서버(`https://mcp.gomdori.app/law`)를 쓰지 않고 내 컴퓨터나 기관 서버에서 korean-law-mcp를 돌릴 때 필요한 설정입니다. 사내망·폐쇄망의 인증서·프록시 문제, Docker 실행, HTTP로 공개할 때의 기본값과 환경 변수를 모았습니다.

## 법제처 API 프로토콜

법제처 API 호출은 기본 HTTPS입니다. 사내망·폐쇄망 등 인증서 검증이 어려운 환경에서는 `LAW_API_PROTOCOL=http`로 HTTP 호출을 씁니다. 허용값은 `http`, `https`이며 설정하지 않거나 다른 값이면 `https`입니다. MCP 클라이언트 설정의 `env` 블록에 넣는 방식이 가장 명확합니다.

```json
{
  "mcpServers": {
    "korean-law": {
      "command": "korean-law-mcp",
      "env": {
        "LAW_OC": "honggildong",
        "LAW_API_PROTOCOL": "http"
      }
    }
  }
}
```

터미널 환경 변수나 `.env` 파일(`LAW_OC=honggildong` 다음 줄에 `LAW_API_PROTOCOL=http`)도 됩니다.

```bash
export LAW_API_PROTOCOL=http        # Mac/Linux
set LAW_API_PROTOCOL=http           # Windows CMD
$env:LAW_API_PROTOCOL="http"       # Windows PowerShell
```

## 국세청 판례 서버 TLS·프록시

국세청 출처 판례 본문은 법제처 JSON 응답에 없을 때, 국세청 법령해석(`nts`) 본문은 항상 `taxlaw.nts.go.kr`을 조회합니다. 이 서버는 HTTP로 접근해도 HTTPS로 리다이렉트하므로, `LAW_API_PROTOCOL=http`와 별개로 Node.js 런타임이 `https://taxlaw.nts.go.kr` 인증서를 신뢰해야 합니다. 사내망·폐쇄망·SSL inspection 프록시 뒤에서는 브라우저로는 열려도 Node.js `fetch()`만 `[EXTERNAL_API_ERROR] fetch failed`로 실패할 수 있습니다(인증서 저장소·프록시 설정이 다름). 먼저 Node.js 기준으로 연결을 확인하세요.

```bash
node -e "fetch('https://taxlaw.nts.go.kr/qt/USEQTA002P.do?ntstDcmId=200000000000019303').then(r=>console.log(r.status,r.url)).catch(e=>console.error(e.name,e.message,e.cause))"
```

별도 웹 프록시를 거쳐야 한다면 프록시 주소를 설정합니다(국세청 판례 본문 fallback·국세청 법령해석 본문의 외부 HTTPS 연결에 적용). Windows 시스템 환경 변수는 관리자 권한 터미널에서 `setx`로 등록하고, 적용 뒤 Windows 또는 Node.js 프로세스를 다시 시작하세요.

```env
LAW_EXTERNAL_HTTPS_PROXY=http://proxy-host:8080
```

```cmd
setx LAW_EXTERNAL_HTTPS_PROXY http://proxy-host:8080 /M
```

프록시 경로에서도 사내 인증서 검증 문제가 남으면, 원인 확인용으로만 이 프로젝트의 외부 HTTPS 프록시 경로에 한해 TLS 인증서 검증을 잠시 끌 수 있습니다. 운영 상시 설정으로 쓰지 마세요. 두 번째 줄은 진단 뒤 지우는 명령입니다.

```cmd
setx LAW_EXTERNAL_TLS_REJECT_UNAUTHORIZED 0 /M
reg delete "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v LAW_EXTERNAL_TLS_REJECT_UNAUTHORIZED /f
```

## Docker로 실행

```bash
docker build -t korean-law-mcp .
docker run -e LAW_OC=your-api-key -e MCP_HTTP_HOST=0.0.0.0 \
  -e MCP_AUTH_TOKEN=replace-with-a-secret -p 3000:3000 korean-law-mcp
```

## HTTP로 공개할 때의 기본값

HTTP 모드는 기본이 로컬 전용입니다. `127.0.0.1`에만 바인딩하고, `X-Forwarded-For`를 믿지 않으며, 이 로컬 전용 사용에서는 토큰 인증이 선택입니다. 리버스 프록시 뒤에 두려면 공개 바인딩과 정확한 프록시 hop 수를 함께 명시합니다.

```bash
MCP_HTTP_HOST=0.0.0.0 TRUST_PROXY=1 MCP_AUTH_TOKEN=replace-with-a-secret \
  korean-law-mcp --mode http --port 8000
```

- 외부 바인딩에는 `MCP_AUTH_TOKEN`이 필요합니다. 의도적으로 인증 없이 공개할 때만 `MCP_ALLOW_UNAUTHENTICATED_REMOTE=1`을 명시하며, 이때 시작 경고가 나옵니다. 다른 접근 경계가 있는 곳에서만 쓰세요.
- **브라우저(웹) 클라이언트를 쓸 때는 `ALLOWED_ORIGINS`를 설정하세요.** MCP 명세가 요구하는 Origin 검증(DNS rebinding 방어) 때문에, `Origin` 헤더가 붙은 요청은 `ALLOWED_ORIGINS` 허용 목록(쉼표 구분)에 있는 출처만 통과합니다. 비워 두면 `CORS_ORIGIN`이 대신 기준이 됩니다(`*`면 모든 출처, 아니면 그 출처 하나). 둘 다 없으면 브라우저 요청은 모두 막히고 시작할 때 안내가 나옵니다. `ALLOWED_ORIGINS`를 설정하면 `CORS_ORIGIN`은 출처 판정에 쓰지 않습니다.
- `ALLOW_QUERY_API_KEY=0`이면 URL 쿼리(`?oc=키`)로는 API 키를 받지 않습니다. 쿼리 키는 프록시·엣지 접근 로그에 평문으로 남으므로 폐쇄망이나 로그 수집 환경에서 권장합니다. 헤더(`apikey`·`law_oc` 등) 전달은 계속 됩니다.
- `ACCESS_LOG=1`이면 요청을 기록합니다. 쿼리 문자열의 `oc=` 키가 새지 않도록 경로만 적습니다.
- `RATE_LIMIT_RPM=0`은 IP별 제한만 끕니다. `MCP_MAX_BATCH_CALLS`(기본 20), 요청 본문, upstream 시도·응답 본문, 도구 응답 제한은 계속 적용됩니다.
- 숫자 한도는 모두 시작할 때 정수로 검증하며, 잘못된 값은 한도를 약하게 두는 대신 시작을 실패시킵니다. 기존 `MCP_BODY_LIMIT=100kb`도 호환됩니다.
- `legal_research` 등 체인 도구는 요청 하나의 upstream 시도 예산 48회를 함께 씁니다. JSON-RPC 배치 항목은 예산만 공유하고 MCP 취소 신호는 따로 둡니다. `get_batch_articles`는 최대 20개 법령·총 100개 조문으로 제한됩니다. HTTP 연결 종료나 MCP 취소는 fetch, 재시도 대기, 응답 본문 읽기까지 전달됩니다.

## 환경 변수

| 변수 | 필수 | 기본값 | 설명 |
|------|------|--------|------|
| `LAW_OC` | 예 | 없음 | 법제처 API 키([무료 발급](https://open.law.go.kr/LSO/openApi/guideResult.do)) |
| `LAW_API_PROTOCOL` | 아니요 | `https` | HTTPS 인증서 검증이 안 되는 망에서 `http` |
| `LAW_EXTERNAL_HTTPS_PROXY` | 아니요 | 없음 | 국세청 판례 fallback·법령해석 본문용 웹 프록시(위 절) |
| `LAW_USER_AGENT` / `LAW_REFERER` | 아니요 | 없음 | 법제처 호출에 붙는 User-Agent·Referer 기본값을 바꿀 때 |
| `PORT` | 아니요 | 8000 | HTTP 서버 포트 |
| `CORS_ORIGIN` | 아니요 | `*` | CORS 허용 출처. 명시하면 그 출처가 Origin 검증도 통과합니다 |
| `ALLOWED_ORIGINS` | 아니요 | 없음 | 쉼표로 구분한 Origin 허용 목록. `Origin` 헤더가 붙은 요청은 목록에 없으면 거절(DNS rebinding 방어). 이것도 `CORS_ORIGIN`도 없으면 브라우저 요청은 모두 막힘 |
| `MCP_AUTH_TOKEN` | 아니요 | 없음 | 설정하면 `/mcp`에 `x-mcp-token` 또는 `Authorization: Bearer`를 요구. 외부 바인딩에는 필수(아래 override 제외) |
| `MCP_HTTP_HOST` | 아니요 | `127.0.0.1` | 바인드 주소. 외부 주소는 `MCP_AUTH_TOKEN`이 필요 |
| `MCP_ALLOW_UNAUTHENTICATED_REMOTE` | 아니요 | `0` | 인증 없는 외부 공개를 의도할 때만 `1` |
| `TRUST_PROXY` | 아니요 | `false` | 프록시 hop 수(예: 프록시 하나 뒤면 `1`). `true`·`all`은 쓰지 않음 |
| `ALLOW_QUERY_API_KEY` | 아니요 | `1` | `0`이면 `?oc=` 쿼리 키를 거절(프록시 접근 로그 유출 차단) |
| `ACCESS_LOG` | 아니요 | `0` | `1`이면 요청마다 기록. `req.path`만 남기고 쿼리 문자열은 남기지 않음 |
| `RATE_LIMIT_RPM` | 아니요 | 60 | IP당 분당 요청 한도. `0`은 IP별 제한만 끄고 배치·실행 한도는 유지 |
| `FALLBACK_RATE_LIMIT_RPM` | 아니요 | 120 | 자체 키 없는 요청이 서버 키를 쓰는 전역 상한(토큰버킷, 429에 `Retry-After`). `0`이면 서버 키 대체 사용을 끔 |
| `FALLBACK_RATE_LIMIT_BURST` | 아니요 | `FALLBACK_RATE_LIMIT_RPM`과 같음 | 위 토큰버킷 용량 |
| `FALLBACK_DAILY_CAP` | 아니요 | `0` | 서버 키 대체 사용의 최근 24시간 총량 상한. `0`이면 끔 |
| `MCP_MAX_BATCH_CALLS` | 아니요 | 20 | JSON-RPC HTTP 요청 하나에 담을 수 있는 `tools/call` 최대 개수 |
| `MCP_MAX_BODY_BYTES` | 아니요 | 102400 | 받는 JSON 요청 최대 크기. 옛 `MCP_BODY_LIMIT`(`100kb` 등)도 받음 |
| `MCP_MAX_UPSTREAM_REQUESTS` | 아니요 | 48 | 요청 하나의 upstream 시도 예산(재시도·안티봇 hop 포함) |
| `MCP_MAX_UPSTREAM_BODY_BYTES` | 아니요 | 2097152 | upstream 응답 본문 하나에서 읽는 최대 바이트 |
| `MCP_MAX_TOTAL_UPSTREAM_BODY_BYTES` | 아니요 | 8388608 | 바깥 요청 하나가 읽는 upstream 본문 총 바이트 |
| `MCP_MAX_TOOL_RESPONSE_CHARS` | 아니요 | 50000 | MCP 도구 응답 최대 글자 수 |
| `MCP_CHAIN_DEADLINE_MS` | 아니요 | 45000 | 체인 한 건의 시간 한도. 끝나면 받은 부분까지 돌려주고 못 받은 자리는 표시 |

## 의존성과 설치 경계

`kordoc`은 별표 PDF·HWP 파싱에 실제로 쓰므로 유지하고, 동작이 확인된 pure-JS `pdfjs-dist@4.10.38`만 일반 의존성으로 고정합니다. OCR·ML·네이티브 선택 의존성은 이 서버에 필요 없어서, 플러그인·문서·Docker 설치는 `--omit=optional --ignore-scripts`로 뺍니다. CI·게시 workflow는 개발 도구의 optional binding을 설치하되 script는 끈 상태로 검증한 뒤, production graph로 줄이고 PDF 별표 smoke test를 돌립니다. publish 전에는 `build/`를 지우고 실제 pack 파일과 exports를 검증합니다. 하위 HTTP 프레임워크 패키지에 대한 스캐너 경고는 실제 도달 가능한 서버 경로와 구분해 판단합니다.
