import { describe, it, expect, vi, afterEach } from "vitest"
import { searchLifeLaw, parseLifeLawResponse, LIFE_LAW_MCP_URL } from "./life-law-guide.js"
import type { LawApiClient } from "../lib/api-client.js"

const client = {} as LawApiClient

/** 법제처 생활법령 MCP 실응답(2026. 11. 28.)의 꼴: SSE 한 줄에 JSON-RPC 결과, structuredContent 와 content[0].text 가 같다 */
function sse(result: unknown): string {
  return `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result })}\n\n`
}

const FOUND = {
  query_used: "전세* 보증금* 집주인* 돌려주*",
  broadened: false,
  note: "질문 전체로는 결과가 없어 검색어를 줄이거나 넓혀 조회했습니다. 결과가 질문과 정확히 맞는지 확인하세요.",
  sections: [{
    section: "관심규정해설",
    count: 2,
    items: [{
      title: "잔금정산하기",
      tree: "집 계약하기>잔금정산 및 등기하기>",
      ov: "... 임차권등기가 되면 대항력이나 우선변제권이 그대로 유지되므로 &lt;보증금&gt; 을 우선해서 받을 수 있어요(「주택임대차보호법」 제3조의3제5항 참조).",
      link: "https://www.easylaw.go.kr/CSP/csp1/lifeLawDetail/getLifeLawDetail.do?popMenu=ov&csmfldSeq=666",
    }],
  }],
}

afterEach(() => vi.unstubAllGlobals())

describe("search_life_law (법제처 생활법령 MCP)", () => {
  it("질문과 건수를 tools/call 로 보내고 분류·제목·경로·발췌·원문 링크를 낸다", async () => {
    let sent: { url: string; body: any } | null = null
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
      sent = { url: String(input), body: JSON.parse(String(init?.body)) }
      return new Response(sse({ structuredContent: FOUND, content: [{ type: "text", text: JSON.stringify(FOUND) }] }), { headers: { "content-type": "text/event-stream" } })
    })
    const r = await searchLifeLaw(client, { question: "전세 보증금을 집주인이 안 돌려주면?", maxItems: 2 })
    expect(sent!.url).toBe(LIFE_LAW_MCP_URL)
    expect(sent!.body.method).toBe("tools/call")
    expect(sent!.body.params).toEqual({ name: "search_life_law", arguments: { question: "전세 보증금을 집주인이 안 돌려주면?", max_items: 2 } })
    const text = r.content[0].text
    expect(r.isError).toBeUndefined()
    expect(text).toContain("실제 검색어: 전세* 보증금* 집주인* 돌려주*")
    expect(text).toContain("## 관심규정해설 (2건 중 1건)")
    expect(text).toContain("1. 잔금정산하기 [집 계약하기 > 잔금정산 및 등기하기]")
    expect(text).toContain("<보증금>")
    expect(text).toContain("원문: https://www.easylaw.go.kr/CSP/csp1/lifeLawDetail/getLifeLawDetail.do?popMenu=ov&csmfldSeq=666")
    expect(text).toContain("※ 질문 전체로는 결과가 없어")
  })

  it("분류마다 다른 필드(백문백답 질문·답, 판례 판시사항·요지, 관련 법령)를 읽는다", async () => {
    const r0 = { query_used: "월급", sections: [
      { section: "백문백답", count: 4, items: [{ title: "통상임금", onhunqueCts: "통상임금은 무엇인가요?", onhunansCts: "정기적이고 일률적으로 지급하기로 정한 금액을 말합니다.", link: "https://www.easylaw.go.kr/x?onhunqueSeq=5950" }] },
      { section: "대법원판례", count: 1, items: [{ title: "대법원 2010. 5. 20. 선고 2007다90760 퇴직금", judItm: "퇴직금 분할 약정의 효력", precGst: "원칙적 무효" }] },
      { section: "백문백답 법령명", count: 1, items: [{ title: "근로/노동", onhunqueCts: "지원금을 받을 수 있을까요?", onhunqueConLsiNm: "고용보험법,고용보험법시행령" }] },
    ] }
    vi.stubGlobal("fetch", async () => new Response(sse({ content: [{ type: "text", text: JSON.stringify(r0) }] })))
    const text = (await searchLifeLaw(client, { question: "월급을 못 받았어요", maxItems: 3 })).content[0].text
    expect(text).toContain("질문·쟁점: 통상임금은 무엇인가요?")
    expect(text).toContain("발췌: 정기적이고 일률적으로")
    expect(text).toContain("질문·쟁점: 퇴직금 분할 약정의 효력")
    expect(text).toContain("발췌: 원칙적 무효")
    expect(text).toContain("관련 법령: 고용보험법, 고용보험법시행령")
  })

  it("keywords 를 주면 함께 보낸다", async () => {
    let args: any = null
    vi.stubGlobal("fetch", async (_: string | URL, init?: RequestInit) => {
      args = JSON.parse(String(init?.body)).params.arguments
      return new Response(sse({ structuredContent: FOUND, content: [] }))
    })
    await searchLifeLaw(client, { question: "집주인", keywords: ["임대인", "보증금"], maxItems: 3 })
    expect(args.keywords).toEqual(["임대인", "보증금"])
  })

  it("결과 섹션이 비면 NOT_FOUND 와 다른 표현으로 다시 찾으라는 힌트를 낸다(지어내기 금지)", async () => {
    vi.stubGlobal("fetch", async () => new Response(sse({ structuredContent: { query_used: "없는말*", sections: [] }, content: [] })))
    const r = await searchLifeLaw(client, { question: "없는말", maxItems: 3 })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain("[NOT_FOUND]")
    expect(r.content[0].text).toContain("실제 검색어: 없는말*")
    expect(r.content[0].text).toContain("keywords")
  })

  it("JSON-RPC 오류·도구 오류는 오류 응답으로 낸다", async () => {
    vi.stubGlobal("fetch", async () => new Response(sse({ isError: true, content: [{ type: "text", text: "upstream down" }] })))
    const r = await searchLifeLaw(client, { question: "운전면허 갱신", maxItems: 3 })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain("upstream down")
  })

  it("structuredContent 가 없으면 content[0].text 의 JSON 을 읽고, SSE 아닌 JSON 본문도 받는다", () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(FOUND) }] } })
    expect(parseLifeLawResponse(body).query_used).toBe(FOUND.query_used)
  })
})
