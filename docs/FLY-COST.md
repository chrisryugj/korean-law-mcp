# Fly.io 비용 최적화

2026-07-02 진단. 6월 청구 $16+ — MCP 5개 앱 전부 `auto_stop` 설정인데도 머신이 24/7 가동된 원인 분석과 대책.

## 진단 결과

| 앱 | 스펙 | 상태 | 원인 |
|---|---|---|---|
| korean-law-mcp | 256MB | 24/7 가동 | **실사용 트래픽** (4분간 620건 — claude.ai 커넥터 237, python/Go/node 클라이언트, Claude Code, Cursor). 비용 정당 |
| archhub-mcp | 512MB | 24/7 가동 | **실사용 트래픽** (4분간 137건). 비용 정당 |
| korean-stats-mcp | 512MB | 24/7 가동 | 실트래픽 0인데 **~1분 간격 외부 핑**이 계속 깨움 → 순수 낭비. law 로그에 UptimeRobot UA가 찍히는데 **우리가 설정한 모니터가 아님** — MCP 디렉토리·등록처(조코헌트 등)의 제3자 상태 모니터링 추정 |
| school-mcp | 1GB ×2대 | 중복 | `fly deploy` 기본값이 머신 2대 생성 |
| korean-patent-mcp | 256MB ×2대 | 중복 | 〃 (autostop suspend는 정상 작동) |

**원인이 아니었던 것**: dedicated IPv4(전부 shared=무료), 코드 내 self-ping, fly 호스트 불량(머신을 새 호스트로 옮겨도 재현), SSE 롱커넥션(인바운드 연결 0 실측).

**핵심 메커니즘**: fly proxy의 autostop은 "수 분간 무트래픽"이어야 발동한다. 1분 간격 헬스체크 핑만 있어도 idle 판정이 영영 안 차서 머신이 못 잠든다. 핑 한 방이면 `auto_start`가 무조건 깨우므로 서버 쪽에서 막을 방법이 없다.

## 조치 완료 (2026-07-02)

1. school·patent 중복 머신 각 1대 삭제 (`fly scale count 1`) → **월 ~$7.6 절감**
2. law-mcp 머신 교체 + `ACCESS_LOG=1` 환경변수 게이트 액세스 로그 추가 (`src/server/http-server.ts`, 쿼리스트링 제외로 oc= API 키 유출 방지) — 트래픽 출처 진단용
3. stats 머신 autostop을 suspend → stop으로 전환 (`fly machine update --autostop=stop`)
   - ⚠️ **stats의 fly.toml은 여전히 `suspend`** — 재배포하면 설정이 되돌아간다. 재배포 전 fly.toml의 `auto_stop_machines`를 `'stop'`으로 수정할 것

## 남은 대책 후보

stats를 깨우는 핑은 제3자 소유라 **우리 쪽에서 끌 수 없다**. 어떤 요청이든 도착 즉시 `auto_start`가 머신을 깨우므로 앱 레벨 차단(UA 거부 등)도 과금 방지엔 무효.

| # | 대책 | 절감 | 난이도 / 리스크 |
|---|---|---|---|
| 1 | **5개 MCP를 1머신으로 통합** (단일 앱에 `/law` `/stats` `/patent` `/school` `/archhub` 경로 라우팅) — 근본 해결 | 총액 월 $2~3까지 | 구조 변경. 엔드포인트 URL 변경(구 앱에 리다이렉트 필요). archhub의 "단일 머신 필수" 제약과는 오히려 호환. law+archhub 트래픽 합쳐도 512MB 하나로 충분. 제3자 핑도 이미 깨어 있는 머신에 떨어지므로 무해화됨 |
| 2 | stats에 액세스 로그 추가해 핑 주체 확정 (law의 `ACCESS_LOG` 패턴 이식) | 0 (진단용) | stats 재배포는 pnpm 10.28 고정 함정 주의. 주체가 디렉토리 서비스면 등록 해제로 핑 제거 가능하나 마케팅 노출과 트레이드오프 |
| 3 | school 메모리 1GB → 512MB | 월 ~$2.5 (가동 시간 비례) | PDF/HWP 파싱 OOM 리스크 — 실사용 패턴 보고 판단 |
| 4 | 경량 앱만 Cloudflare Workers 이전 (fetch-only인 law·patent) | 해당 앱 $0 | 네이티브 의존성 앱은 불가 — stats(sharp+onnx), archhub(pandas), school(PDF/HWP 파싱) |
| 5 | 현상 유지 (stats ~$3/월 감수) | 0 | 제3자 모니터링 = 디렉토리 노출의 부산물이라 마케팅 비용으로 볼 수도 있음 |

## 예상 비용 경로

$16 (6월) → **~$8~9** (조치 완료 시점) → **~$2~3** (대책 1 통합 시)

## 진단 시 쓴 명령 메모

```bash
fly machine list -a <app> --json          # 머신 수·상태
fly ips list -a <app>                     # dedicated IPv4 여부 ($2/월)
fly machine status <id> -a <app>          # 이벤트 로그 (suspend가 cancel되는지)
fly machine suspend <id> -a <app>         # 수동 재우기 — 즉시 깨어나면 외부 트래픽 존재
fly ssh console -a <app> -C "cat /proc/net/tcp /proc/net/tcp6"  # 인바운드 연결 실측
fly secrets set ACCESS_LOG=1 -a korean-law-mcp   # 요청 UA 로깅 켜기 (law만 지원)
```
