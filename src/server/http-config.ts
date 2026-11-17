/** Validated HTTP security configuration, kept separate so startup is testable. */

import { parseIntegerLimit, readExecutionLimits, type ExecutionLimits } from "../lib/execution-limits.js"
import { resolveChainDeadlineMs } from "../tools/chain-deadline.js"

const DEFAULT_BODY_LIMIT_BYTES = 100 * 1024
const MAX_BODY_LIMIT_BYTES = 10 * 1024 * 1024

export interface HttpServerConfig {
  host: string
  trustProxy: number | false
  authToken: string
  allowUnauthenticatedRemote: boolean
  bodyLimitBytes: number
  rateLimitRpm: number
  maxBatchCalls: number
  fallbackRpm: number
  fallbackBurst: number
  fallbackDailyCap: number
  fallbackPerIpRpm: number
  fallbackPerIpBurst: number
  executionLimits: ExecutionLimits
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase()
  return normalized === "localhost" || normalized === "::1" || /^127(?:\.\d{1,3}){3}$/.test(normalized)
}

function parseRemoteUnauthenticatedOverride(raw: string | undefined): boolean {
  if (raw === undefined || raw === "0") return false
  if (raw === "1") return true
  throw new Error("MCP_ALLOW_UNAUTHENTICATED_REMOTE must be 0 or 1.")
}

/** Only explicit, bounded hop counts are safe to infer from X-Forwarded-For. */
function parseTrustProxy(raw: string | undefined): number | false {
  if (raw === undefined || raw === "false" || raw === "0") return false
  return parseIntegerLimit("TRUST_PROXY", raw, 0, 1, 10)
}

/**
 * MCP_MAX_BODY_BYTES is the current numeric setting.  Accept the existing
 * MCP_BODY_LIMIT spelling as a compatibility bridge, but validate it here
 * rather than delegating malformed text to Express at request time.
 */
function parseBodyLimit(env: NodeJS.ProcessEnv): number {
  if (env.MCP_MAX_BODY_BYTES !== undefined) {
    return parseIntegerLimit("MCP_MAX_BODY_BYTES", env.MCP_MAX_BODY_BYTES, DEFAULT_BODY_LIMIT_BYTES, 1_024, MAX_BODY_LIMIT_BYTES)
  }
  const legacy = env.MCP_BODY_LIMIT
  if (legacy === undefined) return DEFAULT_BODY_LIMIT_BYTES

  const match = legacy.match(/^(\d+)(b|kb|mb)?$/i)
  if (!match) {
    throw new Error(`MCP_BODY_LIMIT must be a size from 1024 to ${MAX_BODY_LIMIT_BYTES} bytes (for example 100kb).`)
  }
  const multiplier = match[2]?.toLowerCase() === "mb" ? 1024 * 1024
    : match[2]?.toLowerCase() === "kb" ? 1024
      : 1
  const value = Number(match[1]) * multiplier
  if (!Number.isSafeInteger(value) || value < 1_024 || value > MAX_BODY_LIMIT_BYTES) {
    throw new Error(`MCP_BODY_LIMIT must be a size from 1024 to ${MAX_BODY_LIMIT_BYTES} bytes (for example 100kb).`)
  }
  return value
}

export function parseHttpPort(raw: string | undefined, env: NodeJS.ProcessEnv = process.env): number {
  return parseIntegerLimit("PORT", raw ?? env.PORT, 8000, 1, 65_535)
}

export function readHttpServerConfig(env: NodeJS.ProcessEnv = process.env): HttpServerConfig {
  const host = (env.MCP_HTTP_HOST ?? "127.0.0.1").trim()
  if (!host || /\s/.test(host)) {
    throw new Error("MCP_HTTP_HOST must be a non-empty host without whitespace.")
  }

  const authToken = env.MCP_AUTH_TOKEN ?? ""
  const hasAuthToken = authToken.trim().length > 0
  const allowUnauthenticatedRemote = parseRemoteUnauthenticatedOverride(env.MCP_ALLOW_UNAUTHENTICATED_REMOTE)
  if (!isLoopbackHost(host) && !hasAuthToken && !allowUnauthenticatedRemote) {
    throw new Error(
      "MCP_HTTP_HOST is non-loopback. Set MCP_AUTH_TOKEN or explicitly set MCP_ALLOW_UNAUTHENTICATED_REMOTE=1.",
    )
  }

  // 폴백 게이트도 같은 이유로 시작 시점에 검증한다 — parseInt 로 두면 오타 하나가
  // NaN 이 되고, 토큰버킷/일일캡 비교가 통째로 무력화돼 서버 키가 무방비로 열린다.
  const fallbackRpm = parseIntegerLimit("FALLBACK_RATE_LIMIT_RPM", env.FALLBACK_RATE_LIMIT_RPM, 120, 0, 100_000)
  // 클라이언트(IP)별 몫. 0 = 끔(종전 동작). 공개 운영은 공유 한도의 1/4 정도를 권한다
  const fallbackPerIpRpm = parseIntegerLimit("FALLBACK_PER_IP_RPM", env.FALLBACK_PER_IP_RPM, 0, 0, 100_000)

  // 체인 데드라인도 부팅 시점 fail-fast (#150). 값은 여기 담지 않는다 — 소비는 체인이
  // 호출 시점에 env 에서 직접 한다. 검증만 앞당겨, 오타 배포가 "체인 도구만 조용히
  // 죽는" 무증상 부분 장애로 남지 않게 한다.
  resolveChainDeadlineMs(env)

  return {
    host,
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    authToken,
    allowUnauthenticatedRemote,
    bodyLimitBytes: parseBodyLimit(env),
    rateLimitRpm: parseIntegerLimit("RATE_LIMIT_RPM", env.RATE_LIMIT_RPM, 60, 0, 100_000),
    maxBatchCalls: parseIntegerLimit("MCP_MAX_BATCH_CALLS", env.MCP_MAX_BATCH_CALLS, 20, 1, 100),
    fallbackRpm,
    fallbackBurst: parseIntegerLimit("FALLBACK_RATE_LIMIT_BURST", env.FALLBACK_RATE_LIMIT_BURST, fallbackRpm, 0, 100_000),
    fallbackDailyCap: parseIntegerLimit("FALLBACK_DAILY_CAP", env.FALLBACK_DAILY_CAP, 0, 0, 100_000_000),
    fallbackPerIpRpm,
    fallbackPerIpBurst: parseIntegerLimit("FALLBACK_PER_IP_BURST", env.FALLBACK_PER_IP_BURST, Math.max(1, fallbackPerIpRpm), 1, 100_000),
    executionLimits: readExecutionLimits(env),
  }
}
