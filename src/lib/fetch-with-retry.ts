/**
 * Fetch with retry and timeout
 * - Exponential backoff for 429, 503, 504
 * - AbortController for timeout
 */

import { followLawAntibot } from "./law-antibot.js"

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

/**
 * 법제처 API가 200으로 빈 본문/HTML(점검·과부하 페이지)을 반환하는 간헐 장애 감지.
 * 정상 응답은 XML(`<`) 또는 JSON(`{`/`[`)으로 시작하므로 빈 본문과 HTML 페이지만 걸러낸다.
 */
function detectBadBody(text: string): "empty" | "html" | null {
  const t = text.trim()
  if (!t) return "empty"
  if (/^<!doctype html/i.test(t) || /^<html[\s>]/i.test(t)) return "html"
  return null
}

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
    if (!headers.has("referer") && isLawGoKrHost(url)) headers.set("referer", DEFAULT_REFERER)

    try {
      let response = await fetch(url, {
        ...fetchOptions,
        headers,
        signal: controller.signal,
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
          } catch { /* 우회 실패 시 원본 응답으로 진행 */ }
        }
        // 200인데 빈 본문/HTML(법제처 점검·과부하 페이지)이면 일시 장애로 보고 재시도.
        // 이를 막지 않으면 XML 파서가 "missing root element"로 터진다.
        if (response.ok && attempt < retries) {
          let bodyText: string | null = null
          try { bodyText = await response.clone().text() } catch { /* clone 실패 시 정상 처리 */ }
          if (bodyText !== null) {
            const bad = detectBadBody(bodyText)
            if (bad) {
              lastError = new Error(
                `법제처 API 비정상 응답(${bad === "empty" ? "빈 본문" : "HTML 페이지"}) - ${maskSensitiveUrl(url)}`
              )
              await sleep(getRetryDelay(response, retryDelay, attempt))
              continue
            }
          }
        }
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
