# Fly.io 비용 최적화

2026-07-02 진단. 6월 청구 $16+ — MCP 5개 앱 전부 `auto_stop` 설정인데도 머신이 24/7 가동된 원인 분석과 대책.

## 진단 결과

| 앱 | 스펙 | 상태 | 원인 |
|---|---|---|---|
| korean-law-mcp | 256MB | 24/7 가동 | **실사용 트래픽** (4분간 620건 — claude.ai 커넥터 237, python/Go/node 클라이언트, Claude Code, Cursor). 비용 정당 |
| archhub-mcp | 512MB | 24/7 가동 | **실사용 트래픽** (4분간 137건). 비용 정당 |
| korean-stats-mcp | 512MB | 24/7 가동 | **실사용 트래픽** (22:38 KST 7분간 139건 — node 66·python-httpx 36·Claude-User 26·copilot·Go). 낮 한산 시간대엔 4분간 0건도 관찰될 만큼 bursty. 초기에 "제3자 핑 낭비"로 오판했으나 ACCESS_LOG 실측으로 정정(2026-07-02) |
| school-mcp | 1GB ×2대 | 중복 | `fly deploy` 기본값이 머신 2대 생성 |
| korean-patent-mcp | 256MB ×2대 | 중복 | 〃 (autostop suspend는 정상 작동) |

**원인이 아니었던 것**: dedicated IPv4(전부 shared=무료), 코드 내 self-ping, fly 호스트 불량(머신을 새 호스트로 옮겨도 재현), SSE 롱커넥션(인바운드 연결 0 실측).

**핵심 메커니즘**: fly proxy의 autostop은 "수 분간 무트래픽"이어야 발동한다. 1분 간격 헬스체크 핑만 있어도 idle 판정이 영영 안 차서 머신이 못 잠든다. 핑 한 방이면 `auto_start`가 무조건 깨우므로 서버 쪽에서 막을 방법이 없다.

## 조치 완료 (2026-07-02)

1. school·patent 중복 머신 각 1대 삭제 (`fly scale count 1`) → **월 ~$7.6 절감**
2. law-mcp 머신 교체 + `ACCESS_LOG=1` 환경변수 게이트 액세스 로그 추가 (`src/server/http-server.ts`, 쿼리스트링 제외로 oc= API 키 유출 방지) — 트래픽 출처 진단용
3. stats 머신 autostop을 suspend → stop으로 전환 + fly.toml에도 반영·재배포 완료 ('suspend'는 proxy가 재우기를 실행 못 하는 증상 실측 — 'stop'인 school만 정상 사이클)
4. stats에도 `ACCESS_LOG=1` 액세스 로그 이식·배포 (`src/server-http.ts`) — 이 로그로 실사용 트래픽 확인
5. **school-mcp 당분간 서비스 중단** (`fly scale count 0`, 2026-07-02) — 앱·이름·주소는 유지, 복구는 `fly scale count 1 -a school-mcp`. 참고: 계정에 $5 미만 청구 면제가 있어 월 총액을 $5 아래로 낮추는 게 목표
6. **대책 1(1머신 통합) 실행 완료** (2026-07-02) — [gomdori-mcp](https://github.com/chrisryugj/gomdori-mcp) 통합 호스트를 **korean-law-mcp 앱에 배포** (512MB+swap, law 앱을 호스트로 쓴 이유: 최대 사용자군의 fly.dev 주소 무단절 유지). 신규 공식 주소는 `mcp.gomdori.app/law` `/stats` `/patent` `/archhub` `/school` **5종** (Vercel DNS CNAME + fly certs). 기존 `korean-law-mcp.fly.dev/mcp`는 하위호환 유지. 시크릿 6종(LAW_OC·KOSIS·KIPRIS·ARCHHUB·SCHOOLINFO·NEIS) korean-law-mcp 앱으로 이관
   - 각 레포 CLAUDE.md에 배포 규칙 심음(law는 fly.toml.disabled로 자체 deploy 차단 + deploy.md 개정). 맥미니 클론들도 동기화 완료
   - **남은 정리**: 구 stats·patent·archhub fly 앱은 기존 사용자 이전 기간 동안 병행 운영 중 (이 기간엔 비용 절감 없음). README·조코헌트 주소를 mcp.gomdori.app으로 갱신하고, 이전이 충분히 진행되면 구 앱 `fly scale count 0` → 그때 월 ~$3~4(=$5 면제로 실질 $0) 달성
   - stats 재배포 시 주의: 워킹트리에 pnpm 11 잔여물로 pnpm-lock.yaml이 변조돼 있으면 `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` — `git checkout -- pnpm-lock.yaml`로 복원 후 배포

## 남은 대책 후보

**결론: 5개 앱 모두 실사용 트래픽이 상당하다.** 6월 $16의 실체는 "쓰이는 서비스의 인프라 비용"이고, 순수 낭비는 중복 머신(~$7.6/월, 제거 완료)뿐이었다. law 로그에 UptimeRobot UA(제3자 등록 모니터, 우리 것 아님)가 1분 간격으로 찍히지만 실트래픽 대비 미미해 비용 기여는 무시 수준.

어떤 요청이든 fly 엣지 도착 즉시 `auto_start`가 머신을 깨우고 과금이 시작되므로, 앱 레벨 차단(UA 403 등)은 과금 방지에 무효라는 점은 유효한 교훈.

| # | 대책 | 절감 | 난이도 / 리스크 |
|---|---|---|---|
| 1 | **5개 MCP를 1머신으로 통합** (단일 앱에 `/law` `/stats` `/patent` `/school` `/archhub` 경로 라우팅) — 유일하게 큰 레버 | 총액 월 $2~3까지 | 구조 변경. 엔드포인트 URL 변경(구 앱에 리다이렉트 필요). archhub의 "단일 머신 필수" 제약과는 오히려 호환. 트래픽이 전부 I/O 바운드 API 프록시라 512MB~1GB 하나로 충분 |
| 2 | school 메모리 1GB → 512MB | 월 ~$2.5 (가동 시간 비례) | PDF/HWP 파싱 OOM 리스크 — 실사용 패턴 보고 판단 |
| 3 | 경량 앱만 Cloudflare Workers 이전 (fetch-only인 law·patent) | 해당 앱 $0 | 네이티브 의존성 앱은 불가 — stats(sharp+onnx), archhub(pandas), school(PDF/HWP 파싱) |
| 4 | 현상 유지 (~$8~9/월 감수) | 0 | 실사용자가 내는 트래픽이라 서비스 운영비로 보는 게 타당. 사용량 성장 시 통합(#1)만이 스케일 가능한 답 |

## 예상 비용 경로

$16 (6월) → **~$8~9** (중복 머신 제거 후) → **~$2~3** (대책 1 통합 시)

## 진단 시 쓴 명령 메모

```bash
fly machine list -a <app> --json          # 머신 수·상태
fly ips list -a <app>                     # dedicated IPv4 여부 ($2/월)
fly machine status <id> -a <app>          # 이벤트 로그 (suspend가 cancel되는지)
fly machine suspend <id> -a <app>         # 수동 재우기 — 즉시 깨어나면 외부 트래픽 존재
fly ssh console -a <app> -C "cat /proc/net/tcp /proc/net/tcp6"  # 인바운드 연결 실측
fly secrets set ACCESS_LOG=1 -a <app>     # 요청 UA 로깅 켜기 (law·stats 지원, 현재 둘 다 켜져 있음)
```
