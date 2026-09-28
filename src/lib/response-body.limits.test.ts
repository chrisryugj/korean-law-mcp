import { afterAll, beforeAll, describe, expect, it } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { fetchWithRetry } from "./fetch-with-retry.js"
import { readResponseText } from "./response-body.js"
import { requestContext } from "./session-state.js"
import { DEFAULT_EXECUTION_LIMITS, RequestExecutionBudget } from "./execution-limits.js"

// 예산(당시 기본 2 MiB)을 넘는 본문에서 도구 호출이 **에러 대신 300초 정지**했다(#115).
// 기본값은 v4.15.0 에 8 MiB 로 올랐다 — 이 테스트는 기본값이 아니라 초과 시 동작을 보므로 2 MiB 를 명시한다.
// 원인: `response.clone()`이 만든 tee의 한쪽 가지만 취소하면 그 취소 프라미스는
// 나머지 가지가 취소될 때까지 settle되지 않는데, 정리 코드가 그걸 await했다.
// 업스트림을 두드리지 않도록 전 케이스를 로컬 mock 서버로 돌린다.

const OVER = Buffer.from(`<?xml version="1.0"?><Law>${"가".repeat(800_000)}</Law>`, "utf8") // ~2.4 MB > 2 MiB
const UNDER = Buffer.from(`<?xml version="1.0"?><Law>${"가".repeat(600_000)}</Law>`, "utf8") // ~1.8 MB < 2 MiB
const WS_THEN_JSON = Buffer.from(" ".repeat(4096) + `{"Law":"ok"}`, "utf8")

let base = ""
let server: http.Server
let hits = 0

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits++
    const kind = new URL(req.url ?? "/", "http://x").searchParams.get("k")
    const body = kind === "under" ? UNDER : kind === "ws" ? WS_THEN_JSON : OVER
    const headers: Record<string, string> = { "content-type": "text/xml;charset=UTF-8" }
    if (kind === "chunked") {
      res.writeHead(200, headers)
      for (let i = 0; i < body.length; i += 65536) res.write(body.subarray(i, i + 65536))
      res.end()
      return
    }
    res.writeHead(200, { ...headers, "content-length": String(body.length) })
    res.end(body)
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
})

afterAll(() => new Promise<void>((r) => server.close(() => r())))

const LIMITS = { ...DEFAULT_EXECUTION_LIMITS, maxUpstreamBodyBytes: 2 * 1024 * 1024 }

function withBudget<T>(work: () => Promise<T>): { run: Promise<T>; budget: RequestExecutionBudget } {
  const budget = new RequestExecutionBudget(LIMITS)
  return { budget, run: requestContext.run({ budget }, work) }
}

const read = (url: string) => async () => readResponseText(await fetchWithRetry(url))

describe("업스트림 본문 예산 — 초과는 정지가 아니라 에러다", () => {
  it("Content-Length가 한도를 넘으면 즉시 실측 크기·한도를 담은 에러로 끝난다", async () => {
    const { run } = withBudget(read(`${base}?k=over`))
    await expect(run).rejects.toThrow(
      new RegExp(`${OVER.length}.*${LIMITS.maxUpstreamBodyBytes}`),
    )
  }, 6000)

  it("Content-Length 없이 흘러와도(chunked) 한도 도달 시 즉시 에러로 끝난다", async () => {
    const { run } = withBudget(read(`${base}?k=chunked`))
    await expect(run).rejects.toThrow(/MCP_MAX_UPSTREAM_BODY_BYTES/)
  }, 6000)
})

describe("한도 미만 대형 응답 — 오탐·이중 청구 없음", () => {
  it("1.8MB 법령 전문은 정상 통과하고 예산에 한 번만 청구된다", async () => {
    const { run, budget } = withBudget(read(`${base}?k=under`))
    await expect(run).resolves.toContain("<Law>")
    // 훔쳐보기가 본문 전체를 복제해 읽던 때는 같은 바이트가 두 번 청구됐다.
    expect(budget.snapshot().upstreamBodyBytes).toBe(UNDER.length)
  }, 6000)

  it("앞부분이 공백뿐이어도 '빈 본문'으로 오판하지 않는다 (프로브 경계)", async () => {
    hits = 0
    const { run } = withBudget(read(`${base}?k=ws`))
    await expect(run).resolves.toContain(`{"Law":"ok"}`)
    expect(hits).toBe(1)                       // 빈 본문으로 오판했다면 재시도가 붙는다
  }, 6000)
})
