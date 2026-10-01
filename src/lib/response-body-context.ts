/** Keep fetch's total deadline and caller cancellation active during bounded body reads. */
import { combineAbortSignals, runWithRequestContext } from "./session-state.js"

const contexts = new WeakMap<Response, { signal?: AbortSignal; deadlineAt: number }>()

export function bindResponseContext(response: Response, signal: AbortSignal | undefined, deadlineAt: number): Response {
  contexts.set(response, { signal, deadlineAt })
  return response
}

export async function withResponseContext<T>(response: Response, work: () => Promise<T>): Promise<T> {
  const context = contexts.get(response)
  if (!context) return work()
  const controller = new AbortController()
  const timeout = () => controller.abort(new Error("Request timeout while reading upstream response body."))
  const remaining = context.deadlineAt - Date.now()
  const timer = remaining > 0 ? setTimeout(timeout, remaining) : undefined
  if (remaining <= 0) timeout()
  try {
    return await runWithRequestContext({ signal: combineAbortSignals(context.signal, controller.signal) }, work)
  } finally {
    clearTimeout(timer)
  }
}
