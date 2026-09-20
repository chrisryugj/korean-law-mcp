/**
 * Fetch with retry and timeout
 * - Exponential backoff for 429, 503, 504
 * - AbortController for timeout
 */

import { followLawAntibot } from "./law-antibot.js"
import { ExecutionLimitError } from "./execution-limits.js"
import { classifyOkBody, MISS_CONFIRM_DELAY_MS, UpstreamRecordMissingError } from "./upstream-miss.js"
import { combineAbortSignals, getRequestSignal, requestCancelledError, requestContext, throwIfRequestCancelled } from "./session-state.js"

/**
 * URL에서 민감 정보(API 키) 마스킹 — 에러 메시지/로그 노출 방지.
 * 법제처 API는 ?OC=KEY 쿼리 파라미터로 키를 받으므로 해당 값만 *** 처리.
 * 추가 방어로 일반적인 키 파라미터 이름들도 마스킹.
 */
export function maskSensitiveUrl(url: string): string {
  if (!url) return url
  return url.replace(/([?&](?:oc|apikey|api_key|authkey|auth_key|key)=)[^&]+/gi, "$1***")
}

export interface FetchWithRetryOptions extends RequestInit {
  /** Request timeout in ms (default: 30000) */
  timeout?: number
  /** Max retry attempts (default: 3) */
  retries?: number
  /** Base delay for exponential backoff in ms (default: 300 — DEFAULT_RETRY_DELAY 참조) */
  retryDelay?: number
  /** HTTP status codes to retry on (default: [429, 503, 504]) */
  retryOn?: number[]
  /**
   * 정상 응답이 HTML인 요청(예: DRF type=HTML — lsHistory 연혁 목록)에 true.
   * 기본(false)은 "200인데 HTML = 점검 페이지"로 보고 재시도하는데, HTML이
   * 정상인 엔드포인트에선 매 호출이 재시도 소진 + 지연(요청 4배 증폭)이 된다.
   * true여도 빈 본문은 여전히 일시 장애로 재시도한다.
   */
  allowHtmlBody?: boolean
  /**
   * DRF `lawService.do` 단건 조회처럼 **미스가 빈 본문/안내 페이지로 오는** 경로에 true.
   * 이런 곳에서 사다리를 끝까지 태워봐야 같은 답이 돌아온다(실측: prec/JSON 미스는
   * 0바이트 5/5 상시). 확인 재시도 1회 후에도 같으면 `UpstreamRecordMissingError`로
   * 표면화한다. 미스가 정상 봉투로 오는 검색(`lawSearch.do`) 계열에는 켜지 말 것 —
   * 거기서의 빈 본문은 진짜 일시 장애이므로 기존 사다리가 방어 역할을 한다.
   */
  singleRecordLookup?: boolean
}

const DEFAULT_TIMEOUT = 30000
const DEFAULT_RETRIES = 3
/**
 * 지수 백오프 base. 업스트림 왕복은 검색 ~0.45초 / 단건 조회 ~0.9초인데(04_qa_verification.md
 * §2.1·§3.2), 기존 1,000ms base는 1·2·4초 대기로 왕복의 6~8배를 태웠다. 300ms면 마지막
 * 시도까지의 벽시계가 ~4.6초로 레포가 기록한 버스트 404의 "수초 내 자연 회복"(api-client.ts)
 * 구간을 여전히 덮으면서, 대기가 왕복을 압도하지 않는다. 재시도 횟수·retryOn은 그대로다.
 */
const DEFAULT_RETRY_DELAY = 300
const DEFAULT_RETRY_ON = [429, 503, 504]

// 법제처 OPEN API가 Node 기본 UA(undici)를 봇으로 분류해 거부하므로
// 일반 브라우저 UA로 호출. LAW_USER_AGENT 환경변수로 override 가능.
const DEFAULT_USER_AGENT =
  process.env.LAW_USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

// 법제처 OPEN API는 Referer 헤더가 없으면 OC 키가 유효해도
// "사용자 정보 검증에 실패하였습니다 (정확한 서버장비의 IP주소 및 도메인주소를 등록해 주세요)"
// XML을 반환한다. 메시지는 IP/도메인 등록 문제로 오인되기 쉬우나 실제 원인은 Referer 누락이다.
// (브라우저 UA만으로는 통과하지 못하고 Referer가 결정적). LAW_REFERER 환경변수로 override 가능.
const DEFAULT_REFERER = process.env.LAW_REFERER || "https://www.law.go.kr/"

// Referer를 붙일 법제처 계열 호스트 판별 (그 외 호스트엔 주입하지 않음).
function isLawGoKrHost(targetUrl: string): boolean {
  try {
    return /(^|\.)law\.go\.kr$/i.test(new URL(targetUrl).hostname)
  } catch {
    return false
  }
}

/**
 * undici 의 `fetch failed` 는 원인(cause)을 감춘 채 온다 — DNS 실패·TCP 리셋·연결 타임아웃·
 * TLS 검증 실패가 전부 같은 다섯 글자다. #78·#161 처럼 사용자에게 "fetch failed" 만 남으면
 * 리전 egress 드롭인지 법제처 점검인지 사후에 가를 수 없다(머신이 갈리면 서버 로그도 같이
 * 사라진다). cause 의 code·메시지와 대상 호스트를 붙여 표면화한다. 원본 메시지도 URL 을
 * 품을 수 있으므로 마스킹은 그대로 거친다.
 */
export function describeFetchError(error: Error, url: string): string {
  const cause = (error as { cause?: unknown }).cause
  if (error.message !== "fetch failed" || !(cause instanceof Error)) return maskSensitiveUrl(error.message)
  const code = (cause as { code?: unknown }).code
  const detail = [typeof code === "string" ? code : "", cause.message && cause.message !== code ? cause.message : ""]
    .filter(Boolean)
    .join(": ")
  let host = ""
  try {
    host = new URL(url).host
  } catch {
    // URL 파싱 실패 시 호스트 생략
  }
  return `fetch failed (${maskSensitiveUrl(detail || cause.name)})${host ? ` - ${host}` : ""}`
}

/**
 * Fetch with automatic retry and timeout
 */
export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {}
): Promise<Response> {
  const {
    timeout = DEFAULT_TIMEOUT,
    retries = DEFAULT_RETRIES,
    retryDelay = DEFAULT_RETRY_DELAY,
    retryOn = DEFAULT_RETRY_ON,
    allowHtmlBody = false,
    singleRecordLookup = false,
    signal: callerSignal,
    ...fetchOptions
  } = options
  const externalSignal = callerSignal ?? undefined

  let lastError: Error | null = null
  // 단건 조회의 미스 확정용: 빈 본문/HTML 관측 이력 (시도 순번과 무관)
  let sawBadBody = false

  for (let attempt = 0; attempt <= retries; attempt++) {
    throwIfRequestCancelled()
    const controller = new AbortController()
    let timedOut = false
    const timeoutId = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeout)
    const signal = combineAbortSignals(controller.signal, externalSignal, getRequestSignal())

    const headers = new Headers(fetchOptions.headers)
    if (!headers.has("user-agent")) headers.set("user-agent", DEFAULT_USER_AGENT)
    if (!headers.has("referer") && isLawGoKrHost(url)) headers.set("referer", DEFAULT_REFERER)

    try {
      // This is intentionally charged per *attempt*: retry and anti-bot work
      // must not turn one tool call into unbounded upstream activity.
      requestContext.getStore()?.budget?.consumeUpstreamRequest()
      let response = await fetch(url, {
        ...fetchOptions,
        headers,
        signal,
      })

      clearTimeout(timeoutId)

      // Success or non-retryable error
      if (response.ok || !retryOn.includes(response.status)) {
        // law.go.kr JS 안티봇 페이지(클라우드 IP에서 location.assign 리다이렉트) 우회.
        // 로컬/등록 IP에서는 no-op. Fly 등 클라우드 배포에서 UA/Referer로 안 뚫릴 때의 방어층.
        if (response.ok && isLawGoKrHost(url)) {
          try {
            const bypassed = await followLawAntibot(response, url, headers, timeout)
            if (bypassed) response = bypassed
          } catch (error) {
            // Cancellation and budget exhaustion must stop the request rather
            // than silently falling through to more work.
            if (error instanceof ExecutionLimitError || getRequestSignal()?.aborted || externalSignal?.aborted) {
              await response.body?.cancel().catch(() => {})
              throw error
            }
            // 우회 실패 시 원본 응답으로 진행
          }
        }
        // 200인데 빈 본문/HTML이면 그대로 흘려보내지 않는다 — 파서가 "missing root element"로
        // 터지기 때문이다. 검색 계열에선 점검·과부하로 보고 재시도하고, 단건 조회에선
        // 아래 `singleRecordLookup` 분기가 확인 1회 뒤 미스로 확정한다.
        if (response.ok && attempt < retries) {
          const bad = await classifyOkBody(response, externalSignal)
          if (bad === "empty" || (bad === "html" && !allowHtmlBody)) {
            await response.body?.cancel().catch(() => {})
            // 단건 조회에서 이 본문은 대개 "그 레코드 없음"이다. 본문만으로는 미스와
            // 일시 장애를 가를 수 없으므로 짧게 한 번 더 확인하고, 같은 답이면 사다리를
            // 마저 태우지 않고 미스로 표면화한다(빈 결과를 성공으로 반환하지 않는다).
            // 판정 기준은 시도 순번이 아니라 "비정상 본문을 이미 봤는가"다 — 503·네트워크
            // 오류 뒤의 첫 빈 본문(관측 1회)이 미스로 확정되면 안 된다.
            if (singleRecordLookup && sawBadBody) {
              throw new UpstreamRecordMissingError(maskSensitiveUrl(url), bad)
            }
            sawBadBody = true
            lastError = new Error(
              `법제처 API 비정상 응답(${bad === "empty" ? "빈 본문" : "HTML 페이지"}) - ${maskSensitiveUrl(url)}`
            )
            await sleep(
              singleRecordLookup ? MISS_CONFIRM_DELAY_MS : getRetryDelay(response, retryDelay, attempt),
              combineAbortSignals(externalSignal, getRequestSignal()),
            )
            continue
          }
        }
        return response
      }

      // Retryable error - check if we have retries left
      if (attempt < retries) {
        const delay = getRetryDelay(response, retryDelay, attempt)
        // This response will never be returned to a caller. Dispose its body
        // before backoff so the connection can be reused, and let either MCP
        // item cancellation or HTTP disconnect interrupt the wait.
        await response.body?.cancel().catch(() => {})
        await sleep(delay, combineAbortSignals(externalSignal, getRequestSignal()))
        continue
      }

      // No retries left
      return response
    } catch (error) {
      clearTimeout(timeoutId)

      if (getRequestSignal()?.aborted || externalSignal?.aborted) {
        throw requestCancelledError(getRequestSignal()?.reason ?? externalSignal?.reason)
      }
      if (error instanceof ExecutionLimitError) throw error
      // 확인 재시도까지 마친 미스 판정 — 네트워크 오류로 오인해 사다리를 다시 열면 안 된다.
      if (error instanceof UpstreamRecordMissingError) throw error

      // Timeout or network error — URL에서 API 키 제거 후 에러 생성
      if (error instanceof Error) {
        if (error.name === "AbortError" && timedOut) {
          lastError = new Error(`Request timeout after ${timeout}ms for ${maskSensitiveUrl(url)}`)
        } else {
          // fetch 네이티브 에러 메시지에도 URL이 포함될 수 있음. `fetch failed` 는 cause 를 풀어 쓴다
          const described = describeFetchError(error, url)
          lastError = described !== error.message ? Object.assign(new Error(described), { cause: error }) : error
        }
      }

      // Retry on network errors
      if (attempt < retries) {
        const delay = getRetryDelay(null, retryDelay, attempt)
        await sleep(delay, combineAbortSignals(externalSignal, getRequestSignal()))
        continue
      }
    }
  }

  // 재시도를 다 태우고도 못 붙은 건 서버 로그에 남긴다 — 사용자 보고(#161)만으로는 시각과
  // "fetch failed" 뿐이라, 같은 시각 서버가 본 원인 코드가 있어야 리전·업스트림을 가른다.
  if (lastError) console.error(`[upstream] ${retries + 1}회 시도 실패: ${lastError.message}`)
  throw lastError || new Error("Request failed after retries")
}

/**
 * Retry-After 방어 상한. 값을 그대로 믿으면 업스트림 헤더 하나가 대기를 임의로
 * 늘린다(3600 → 1시간 sleep). 업스트림 왕복(≤1.1초)보다 충분히 크고, 도구
 * 타임아웃(DEFAULT_TIMEOUT 30초)과 같은 자리에서 자른다.
 */
const MAX_RETRY_AFTER_MS = 30_000

/** Retry-After 헤더 우선(상한 클램프), 없으면 exponential backoff + jitter */
function getRetryDelay(response: Response | null, retryDelay: number, attempt: number): number {
  if (response) {
    const retryAfter = response.headers.get("Retry-After")
    if (retryAfter) {
      const seconds = Number(retryAfter)
      if (!isNaN(seconds) && seconds > 0) {
        return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
      }
    }
  }
  const baseDelay = retryDelay * Math.pow(2, attempt)
  return baseDelay + Math.random() * baseDelay * 0.5
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms))
  if (signal.aborted) return Promise.reject(requestCancelledError(signal.reason))

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timeoutId)
      signal.removeEventListener("abort", onAbort)
      reject(requestCancelledError(signal.reason))
    }
    signal.addEventListener("abort", onAbort, { once: true })
  })
}
