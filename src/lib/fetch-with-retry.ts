/**
 * Fetch with retry and timeout
 * - Exponential backoff for 429, 503, 504
 * - AbortController for timeout
 */

/**
 * URL에서 민감 정보(API 키) 마스킹 — 에러 메시지/로그 노출 방지.
 * 법제처 API는 ?OC=KEY 쿼리 파라미터로 키를 받으므로 해당 값만 *** 처리.
 * 추가 방어로 일반적인 키 파라미터 이름들도 마스킹.
 */
export function maskSensitiveUrl(url: string): string {
  if (!url) return url
  return url.replace(/([?&](?:oc|OC|apikey|apiKey|api_key|authKey|auth_key|key)=)[^&]+/g, "$1***")
}

export interface FetchWithRetryOptions extends RequestInit {
  /** Request timeout in ms (default: 30000) */
  timeout?: number
  /** Max retry attempts (default: 3) */
  retries?: number
  /** Base delay for exponential backoff in ms (default: 1000) */
  retryDelay?: number
  /** HTTP status codes to retry on (default: [429, 503, 504]) */
  retryOn?: number[]
}

const DEFAULT_TIMEOUT = 30000
const DEFAULT_RETRIES = 3
const DEFAULT_RETRY_DELAY = 1000
const DEFAULT_RETRY_ON = [429, 503, 504]

// 법제처 OPEN API가 Node 기본 UA(undici)를 봇으로 분류해 거부하므로
// 일반 브라우저 UA로 호출. LAW_USER_AGENT 환경변수로 override 가능.
const DEFAULT_USER_AGENT =
  process.env.LAW_USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

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
    ...fetchOptions
  } = options

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    const headers = new Headers(fetchOptions.headers)
    if (!headers.has("user-agent")) headers.set("user-agent", DEFAULT_USER_AGENT)

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        headers,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      // Success or non-retryable error
      if (response.ok || !retryOn.includes(response.status)) {
        return response
      }

      // Retryable error - check if we have retries left
      if (attempt < retries) {
        const delay = getRetryDelay(response, retryDelay, attempt)
        await sleep(delay)
        continue
      }

      // No retries left
      return response
    } catch (error) {
      clearTimeout(timeoutId)

      // Timeout or network error — URL에서 API 키 제거 후 에러 생성
      if (error instanceof Error) {
        if (error.name === "AbortError") {
          lastError = new Error(`Request timeout after ${timeout}ms for ${maskSensitiveUrl(url)}`)
        } else {
          // fetch 네이티브 에러 메시지에도 URL이 포함될 수 있음
          const masked = maskSensitiveUrl(error.message)
          lastError = masked !== error.message ? new Error(masked) : error
        }
      }

      // Retry on network errors
      if (attempt < retries) {
        const delay = getRetryDelay(null, retryDelay, attempt)
        await sleep(delay)
        continue
      }
    }
  }

  throw lastError || new Error("Request failed after retries")
}

/** Retry-After 헤더 우선, 없으면 exponential backoff + jitter */
function getRetryDelay(response: Response | null, retryDelay: number, attempt: number): number {
  if (response) {
    const retryAfter = response.headers.get("Retry-After")
    if (retryAfter) {
      const seconds = Number(retryAfter)
      if (!isNaN(seconds) && seconds > 0) {
        return seconds * 1000
      }
    }
  }
  const baseDelay = retryDelay * Math.pow(2, attempt)
  return baseDelay + Math.random() * baseDelay * 0.5
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
