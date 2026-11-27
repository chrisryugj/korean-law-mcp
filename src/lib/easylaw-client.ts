/**
 * 찾기 쉬운 생활법령정보 Open API(https://open.easylaw.go.kr/api/…) 클라이언트.
 *
 * 인증: 발급받은 서비스키를 HTTP 헤더 SERVICE-KEY 로 보낸다. 외부 호출은 키에 등록한 도메인만 받으며
 * 요청 도메인은 Referer·Origin 으로 판별한다(없으면 「요청 도메인: null」로 거절, 2026-11-28 실측).
 * EASYLAW_SERVICE_KEY 가 없으면 쓰지 않는다(호출부가 법제처 공개 생활법령 MCP 로 대신한다).
 */
import { fetchWithRetry } from "./fetch-with-retry.js"
import { LawApiError, ErrorCodes } from "./errors.js"

export const EASYLAW_API_BASE = "https://open.easylaw.go.kr/api"

export function easylawConfigured(): boolean {
  return Boolean(process.env.EASYLAW_SERVICE_KEY?.trim())
}

export type EasylawItem = Record<string, unknown>

/** 응답 body.items.item 을 배열로(하나면 단일 객체, 없으면 빈 문자열·빈 배열로 온다) */
export function easylawItems(body: unknown): EasylawItem[] {
  const item = (body as { items?: { item?: unknown } } | null)?.items?.item
  return Array.isArray(item) ? (item as EasylawItem[]) : item && typeof item === "object" ? [item as EasylawItem] : []
}

/**
 * GET {base}/{path}?type=json&… → response.body. 결과 코드가 "00" 이 아니면 LawApiError(키 값은 메시지에 싣지 않는다).
 * params 값은 문자열로 바꾸고 빈 값은 뺀다
 */
export async function callEasylaw(path: string, params: Record<string, string | number | undefined>): Promise<{ totalCount: number; body: unknown }> {
  const key = process.env.EASYLAW_SERVICE_KEY?.trim()
  if (!key) throw new LawApiError("생활법령 Open API 서비스키(EASYLAW_SERVICE_KEY)가 설정되지 않았습니다", ErrorCodes.API_ERROR)
  const q = new URLSearchParams({ type: "json" })
  for (const [k, v] of Object.entries(params)) if (v !== undefined && String(v) !== "") q.append(k, String(v))
  const referer = process.env.EASYLAW_REFERER?.trim()
  const headers: Record<string, string> = { "SERVICE-KEY": key, accept: "application/json" }
  if (referer) {
    headers.referer = referer
    headers.origin = new URL(referer).origin
  }
  const res = await fetchWithRetry(`${EASYLAW_API_BASE}/${path}?${q}`, { headers, retries: 1 })
  if (!res.ok) throw new LawApiError(`생활법령 Open API HTTP ${res.status}`, ErrorCodes.API_ERROR)
  const json = JSON.parse(await res.text()) as { response?: { header?: { resultCode?: string; resultMsg?: string }; body?: { totalCount?: unknown } | null } }
  const header = json.response?.header
  if (header?.resultCode !== "00") {
    throw new LawApiError(`생활법령 Open API 오류 ${header?.resultCode ?? "?"}: ${header?.resultMsg ?? "응답 형식 오류"}`, ErrorCodes.API_ERROR)
  }
  const body = json.response?.body ?? null
  return { totalCount: Number((body as { totalCount?: unknown } | null)?.totalCount ?? 0), body }
}
