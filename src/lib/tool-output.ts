import { maskKeysInText } from "./fetch-with-retry.js"
import { requestContext } from "./session-state.js"

/** Protect output from both direct calls and execute_tool argument overrides. */
export function maskToolText(text: string, args?: Record<string, unknown>): string {
  const nested = args?.params && typeof args.params === "object"
    ? args.params as Record<string, unknown> : undefined
  const keys = [args?.apiKey, nested?.apiKey, requestContext.getStore()?.apiKey,
    process.env.LAW_OC, process.env.KOREAN_LAW_API_KEY]
  return maskKeysInText(text, keys.filter((key): key is string => typeof key === "string"))
}
