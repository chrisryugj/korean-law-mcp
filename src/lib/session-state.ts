/**
 * 세션 상태 관리 (순환 의존성 방지)
 */

// 현재 활성 세션 ID (요청 처리 중에만 유효)
export let currentSessionId: string | undefined

export function setCurrentSessionId(sessionId: string | undefined) {
  currentSessionId = sessionId
}

// 세션별 API 키 맵
const sessionApiKeys = new Map<string, string>()

export function setSessionApiKey(sessionId: string, apiKey: string) {
  sessionApiKeys.set(sessionId, apiKey)
}

export function getSessionApiKey(sessionId: string): string | undefined {
  return sessionApiKeys.get(sessionId)
}

export function deleteSession(sessionId: string) {
  sessionApiKeys.delete(sessionId)
}
