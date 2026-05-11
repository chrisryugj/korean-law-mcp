/**
 * 요청별 컨텍스트 (AsyncLocalStorage 기반 - stateless 모드)
 *
 * HTTP stateless 전환 후: 세션 Map 없음. 매 요청마다 ALS에 API 키를 주입하고
 * api-client가 getStore()로 조회. 요청 끝나면 자동 소멸.
 */

import { AsyncLocalStorage } from "node:async_hooks"

export interface RequestContext {
  apiKey?: string
}

export const requestContext = new AsyncLocalStorage<RequestContext>()
