/**
 * SDK 거절 사유 로그의 봉투 요약 (2026-09-23)
 *
 * claude.ai 커넥터 POST 의 약 15% 가 400 이었는데 로그엔 `[edge] … -> 400` 만 남아 사유를 가를 수
 * 없었다. onerror 로그에 method 와 id·params 의 타입만 싣는다: 값(검색어·키)은 싣지 않는다.
 */
import { describe, expect, it } from "vitest"
import { describeEnvelope } from "./http-server.js"

describe("describeEnvelope", () => {
  it("method 와 id·params 의 타입만 싣는다", () => {
    expect(describeEnvelope({ jsonrpc: "2.0", id: 1, method: "tools/list", params: null }))
      .toBe("tools/list(id:number,params:null)")
  })

  it("값은 싣지 않는다 (검색어·키가 로그로 새지 않게)", () => {
    const out = describeEnvelope({ jsonrpc: "2.0", id: "abc", method: "tools/call", params: { name: "search_law", arguments: { query: "비밀검색어", apiKey: "secret" } } })
    expect(out).toBe("tools/call(id:string,params:object)")
    expect(out).not.toContain("비밀검색어")
    expect(out).not.toContain("secret")
  })

  it("배치와 응답 메시지를 구분하고 3개 넘으면 개수만 붙인다", () => {
    const batch = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 5, result: {} },
      { jsonrpc: "2.0", id: 6, method: "ping" },
    ]
    expect(describeEnvelope(batch))
      .toBe("initialize(id:number,params:object) notifications/initialized(id:undefined,params:undefined) response(id:number,params:undefined) +1")
  })

  it("method 의 개행·제어문자로 로그 줄을 위조하지 못한다", () => {
    const out = describeEnvelope({ jsonrpc: "2.0", id: 1, method: "tools/list\n[edge] POST /law -> 200" })
    expect(out).not.toContain("\n")
    expect(out.startsWith("tools/list?")).toBe(true)
  })

  it("객체가 아닌 본문도 타입으로만 표기한다", () => {
    expect(describeEnvelope("text")).toBe("string")
    expect(describeEnvelope(undefined)).toBe("undefined")
  })
})
