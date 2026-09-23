/**
 * tool-registry 최종 게이트 회귀 (2026-09-23 리뷰 C4·C5)
 *
 * - C4: 인자 문자열 길이 상한. 스키마에 .max() 가 없던 인자가 정규식 백트래킹으로 이벤트 루프를 멈췄다.
 * - C5: 도구 출력의 API 키 마스킹. 법제처 상세링크에 실려 온 OC 가 사용자에게 그대로 나갔다.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { registerTools, findOversizedArg, MAX_ARG_CHARS, MAX_SHORT_ARG_CHARS, MAX_TEXT_ARG_CHARS } from "./tool-registry.js"
import { maskKeysInText } from "./lib/fetch-with-retry.js"
import { lawCache } from "./lib/cache.js"
import type { LawApiClient } from "./lib/api-client.js"

async function connect(apiClient: Partial<LawApiClient>) {
  const server = new Server({ name: "t", version: "1" }, { capabilities: { tools: {} } })
  registerTools(server, apiClient as LawApiClient)
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: "c", version: "1" })
  await Promise.all([server.connect(a), client.connect(b)])
  return client
}

const textOf = (r: unknown) => (r as { content: Array<{ text: string }> }).content[0].text

beforeEach(() => lawCache.clear())

describe("findOversizedArg", () => {
  it("일반 문자열 인자는 2천 자, text 는 5만 자까지 받는다", () => {
    expect(findOversizedArg({ query: "가".repeat(MAX_ARG_CHARS) })).toBeNull()
    expect(findOversizedArg({ query: "가".repeat(MAX_ARG_CHARS + 1) })).toContain("query")
    expect(findOversizedArg({ text: "가".repeat(MAX_TEXT_ARG_CHARS) })).toBeNull()
    expect(findOversizedArg({ text: "가".repeat(MAX_TEXT_ARG_CHARS + 1) })).toContain("text")
  })

  it("조문·별표 번호류는 100자까지만 받는다 (buildJO 숫자열 백트래킹 차단)", () => {
    expect(findOversizedArg({ jo: "제38조의2" })).toBeNull()
    expect(findOversizedArg({ jo: "제" + "1".repeat(MAX_SHORT_ARG_CHARS) + "조" })).toContain("jo")
    expect(findOversizedArg({ articles: ["제1조", "제" + "1".repeat(200) + "조"] })).toContain("articles")
  })

  it("execute_tool 의 params 처럼 중첩된 인자와 배열도 본다", () => {
    expect(findOversizedArg({ tool: "get_annexes", params: { lawName: " ".repeat(100_000) } })).toContain("lawName")
    expect(findOversizedArg({ tool: "get_law_text", params: { jo: "1".repeat(500) } })).toContain("jo")
  })
})

describe("maskKeysInText", () => {
  it("상세링크의 OC 를 가린다 (?OC=, &amp;OC=, &oc= 모두)", () => {
    expect(maskKeysInText("링크: /DRF/lawService.do?OC=ryuseungin&amp;target=prec&amp;ID=1"))
      .toBe("링크: /DRF/lawService.do?OC=***&amp;target=prec&amp;ID=1")
    expect(maskKeysInText("x?target=prec&amp;OC=secret1&amp;ID=2")).toBe("x?target=prec&amp;OC=***&amp;ID=2")
    expect(maskKeysInText("a&oc=secret2")).toBe("a&oc=***")
  })

  it("키 값만 가리고 뒤 문자열은 남긴다", () => {
    expect(maskKeysInText("…&amp;OC=abc)입니다. 다음")).toBe("…&amp;OC=***)입니다. 다음")
    expect(maskKeysInText("(oc=3) 참고")).toBe("(oc=***) 참고")
  })

  it("단어 안의 oc= 는 건드리지 않는다", () => {
    expect(maskKeysInText("DOC=1 protocol=2")).toBe("DOC=1 protocol=2")
  })

  it("알려진 키 값은 형태와 무관하게 지운다 (8자 미만은 오탐 방지로 제외)", () => {
    expect(maskKeysInText('{"key":"serverkey99"}', ["serverkey99"])).toBe('{"key":"***"}')
    expect(maskKeysInText("민법 제1조", ["민법"])).toBe("민법 제1조")
  })
})

describe("registerTools 게이트 배선", () => {
  it("상한을 넘는 인자는 도구를 부르지 않고 INVALID_PARAMETER 로 돌려준다", async () => {
    let called = 0
    const client = await connect({ getLawText: async () => { called++; return "{}" } })
    const r = await client.callTool({ name: "get_law_text", arguments: { mst: "1".repeat(MAX_ARG_CHARS + 1) } })
    expect(r.isError).toBe(true)
    expect(textOf(r)).toContain("[INVALID_PARAMETER]")
    expect(called).toBe(0)
  })

  it("도구 출력에 실린 OC 를 가려서 내보낸다", async () => {
    const body = JSON.stringify({
      법령: {
        기본정보: { 법령명_한글: "테스트법" },
        조문: { 조문단위: [{ 조문여부: "조문", 조문번호: "1", 조문내용: "제1조 링크 /DRF/lawService.do?OC=leakedkey1&amp;ID=9" }] },
      },
    })
    const client = await connect({ getLawText: async () => body })
    const r = await client.callTool({ name: "get_law_text", arguments: { mst: "1", jo: "제1조" } })
    expect(textOf(r)).toContain("OC=***")
    expect(textOf(r)).not.toContain("leakedkey1")
  })

  it("tools/list 는 호출마다 같은 목록을 준다 (첫 요청에 한 번 만들어 재사용)", async () => {
    const client = await connect({})
    const first = await client.listTools()
    const second = await client.listTools()
    expect(first.tools.length).toBe(10)
    expect(second).toEqual(first)
  })
})
