/**
 * law.go.kr JS 안티봇 우회 (클라우드 IP 대응)
 *
 * 법제처는 클라우드 IP(GCP/AWS/Fly 등)에서 온 요청에 API 데이터 대신
 * `location.assign(...)` JS 리다이렉트 페이지를 반환할 때가 있다. 이 페이지의
 * 난독화된 URL을 파싱해 토큰 URL로 재요청하면 우회된다.
 * (LexLink-ko-mcp client.py의 `_follow_antibot` 접근을 이식)
 *
 * 로컬/등록 IP에서는 이 페이지가 오지 않으므로 평상시엔 no-op이다. Fly 등
 * 클라우드 배포에서 UA/Referer만으로 뚫리지 않는 경우의 방어층.
 *
 * 한계: Node fetch(undici)는 쿠키 jar가 없어 "안티봇 홉이 심은 세션 쿠키로
 * 원본 재시도 성공" 경로는 제한적이다. 주 경로는 토큰 URL 직접 파싱이다.
 */

import { readBodyPrefix, UpstreamBodyStallError } from "./response-body.js"
import { ExecutionLimitError } from "./execution-limits.js"
import { combineAbortSignals, getRequestSignal, requestContext, throwIfRequestCancelled } from "./session-state.js"

/**
 * 안티봇 판정에 읽는 프리픽스 크기.
 *
 * 챌린지 페이지는 `location.assign` 마커와 난독화 URL이 문서 앞머리에 오는 작은
 * 단독 `<script>` 문서다 — 픽스처 전부(law-antibot.test.ts 6종) 마커가 첫 ~130바이트
 * 안이고, 이식 원본(LexLink-ko-mcp `_follow_antibot`)의 관측도 같다. 4KB면 관측
 * 최대치의 30배 여유다. 종전처럼 clone 전체를 읽으면 law.go.kr의 **모든** 성공 응답
 * 본문이 예산에 이중 청구된다(#115와 같은 뿌리, #150). 마커가 프리픽스 밖에 오는
 * 미관측 변형은 놓치지만, 그 실패 방향은 기존과 같은 "원본 응답 그대로 진행"이다.
 */
const ANTIBOT_PROBE_BYTES = 4096

/**
 * 안티봇 JS의 두 난독화 패턴에서 리다이렉트 경로를 복원한다.
 *
 * - 패턴 A(concat): `x={t:'..',h:'..',o:'..'}; return x.t+x.h+x.o`
 * - 패턴 B(substr): `x={o:'..',c:N},z=M; return o.substr(0,c)+o.substr(c+z)`
 */
export function parseAntibotUrl(html: string): string | null {
  // 패턴 A: 3분할 concat (t + h + o)
  const a = html.match(/t:'([^']*)',h:'([^']*)'/)
  if (a) {
    const o = html.match(/o:'([^']*)'/)
    if (o) return a[1] + a[2] + o[1]
  }

  // 패턴 B: substring 슬라이싱
  const b = html.match(/o:'([^']*)',c:(\d+)},z=(\d+)/)
  if (b) {
    const o = b[1]
    const c = Number(b[2])
    const z = Number(b[3])
    return o.slice(0, c) + o.slice(c + z)
  }

  return null
}

/** timeout이 걸린 단발 fetch */
async function fetchOnce(url: string, headers: Headers, timeout: number): Promise<Response> {
  throwIfRequestCancelled()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)
  try {
    requestContext.getStore()?.budget?.consumeUpstreamRequest()
    return await fetch(url, { headers, signal: combineAbortSignals(controller.signal, getRequestSignal()) })
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * 응답이 JS 안티봇 페이지면 우회한 새 Response를, 아니면 null(원본 유지)을 반환.
 * 최대 maxHops까지 location.assign 리다이렉트를 추적한다.
 */
export async function followLawAntibot(
  response: Response,
  originalUrl: string,
  headers: Headers,
  timeout: number,
  maxHops = 3
): Promise<Response | null> {
  const root = response
  let current = response
  let hopped = false

  const finishWith = async (replacement: Response): Promise<Response> => {
    if (replacement !== root) await root.body?.cancel().catch(() => {})
    return replacement
  }

  for (let hop = 0; hop < maxHops; hop++) {
    let text: string
    const inspection = current.clone()
    try {
      // 판정에 필요한 앞부분만 훔쳐본다 — 예산에 청구하지 않는다(진짜 읽기가 다시
      // 청구하므로 여기서 세면 이중 계상). 마커가 잘려 못 읽으면 원본 진행이다.
      ;({ text } = await readBodyPrefix(inspection, ANTIBOT_PROBE_BYTES))
    } catch (error) {
      // 본문 정지(UpstreamBodyStallError)도 여기서 끝낸다. "안티봇 아님, 계속"으로 넘기면 뒤의
      // classifyOkBody 가 같은 정지를 20초 더 기다려 시도당 40초를 썼다(2026-09-23 독립 리뷰, 재현 80초).
      if (error instanceof ExecutionLimitError || error instanceof UpstreamBodyStallError || getRequestSignal()?.aborted) {
        // `clone()` tees the body; cancelling one branch can wait for the
        // other. Release both concurrently on terminal request errors.
        await Promise.allSettled([
          inspection.body?.cancel(),
          current.body?.cancel(),
        ])
        throw error
      }
      // Keep `current` readable for the caller. Cancellation of the discarded
      // inspection branch is initiated but must not block on the live tee.
      void inspection.body?.cancel().catch(() => {})
      return hopped ? await finishWith(current) : null
    }
    // 프리픽스만 읽었다 — 남은 가지는 버린다. await 금지: tee 한쪽만 취소하면
    // 다른 가지가 끝날 때까지 settle되지 않는다(#115).
    void inspection.body?.cancel().catch(() => {})

    // 안티봇 페이지가 아니면 종료 (첫 홉이면 변경 없음 = null)
    if (!text.includes("location.assign")) {
      return hopped ? await finishWith(current) : null
    }

    const path = parseAntibotUrl(text)
    if (!path) return hopped ? await finishWith(current) : null

    // path는 보통 절대경로(/DRF/...). 원본 URL의 origin에 붙인다.
    // path가 절대 URL이면 base가 무시되므로, 홉 대상이 원본과 같은 호스트인지
    // 반드시 확인한다 — 아니면 응답 하나로 임의 호스트 요청을 유도할 수 있다.
    let nextUrl: string
    try {
      const parsed = new URL(path, originalUrl)
      if (parsed.hostname !== new URL(originalUrl).hostname) {
        return hopped ? await finishWith(current) : null
      }
      nextUrl = parsed.toString()
    } catch {
      return hopped ? await finishWith(current) : null
    }

    let next: Response
    try {
      next = await fetchOnce(nextUrl, headers, timeout)
    } catch (error) {
      // An intermediate token response is no longer useful after its next
      // hop fails. Keep only `root` intact for fetchWithRetry's fallback.
      if (current !== root) await current.body?.cancel().catch(() => {})
      throw error
    }
    hopped = true

    // 토큰 URL이 404면 원본을 한 번 더 시도 (홉이 세션을 세팅했을 수 있음)
    if (next.status === 404) {
      try {
        const fallback = await fetchOnce(originalUrl, headers, timeout)
        await next.body?.cancel().catch(() => {})
        if (current !== root) await current.body?.cancel().catch(() => {})
        return await finishWith(fallback)
      } catch (error) {
        await next.body?.cancel().catch(() => {})
        if (current !== root) await current.body?.cancel().catch(() => {})
        throw error
      }
    }

    // A successful hop replaces only the previous intermediate. The root is
    // retained until a final usable response exists, so outer fallback never
    // receives a cancelled body.
    if (current !== root) await current.body?.cancel().catch(() => {})
    current = next
  }

  return await finishWith(current)
}
