import { describe, it, expect, vi, afterEach } from "vitest"
import { LawApiClient } from "./api-client.js"

// getLawText 의 target 선택 회귀.
//
// 경위: eflaw 단건 조회는 MST 단독(efYd 미동반)으로 현행이 아닌 버전을 못 풀어 "{}"를
// 주던 시절(2026-08-19 형사소송법 실측)에 target=law 폴백이 생겼다. 2026-08-27부터는
// 법제처가 eflaw 단건에 efYd 를 요구해 MST 단독 요청이 매번 HTML 안내 페이지로 실패했고(#153),
// 폴백 앞의 재시도 사다리가 그 HTML 을 4회 두드려 호출마다 약 3.3초·업스트림 5회를 썼다
// (2026-09-23 리뷰 A1·B1). 지금은 MST 단독이면 target=law 로 바로 간다.

const LAW_BODY = `{"법령": {"기본정보": {"법령명_한글": "형사소송법", "시행일자": 20261002}}}`

const jsonRes = (body: string) =>
  new Response(body, { status: 200, headers: { "content-type": "application/json" } })

const HTML_ERROR_PAGE = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN">
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>국가법령정보 공동활용</title></head>
<body>미신청된 목록/본문에 대한 접근입니다.</body></html>`

const htmlRes = () =>
  new Response(HTML_ERROR_PAGE, { status: 200, headers: { "content-type": "text/html" } })

function recordFetch(respond: (url: string) => Response): string[] {
  const urls: string[] = []
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    urls.push(String(url))
    return respond(String(url))
  }))
  return urls
}

/** 재시도 백오프가 있는 경로: 기대를 먼저 걸고 가짜 시계를 돌린다(실시간 대기 없음) */
async function settleWithFakeTimers<T>(run: () => Promise<T>, assert: (p: Promise<T>) => Promise<unknown>) {
  vi.useFakeTimers()
  try {
    const promise = run()
    const expectation = assert(promise)
    await vi.advanceTimersByTimeAsync(10_000)
    await expectation
  } finally {
    vi.useRealTimers()
  }
}

describe("getLawText: MST 단독은 target=law 로 한 번에 간다", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("MST 단독 조회는 eflaw 를 거치지 않고 target=law 1회로 끝난다", async () => {
    const urls = recordFetch(() => jsonRes(LAW_BODY))

    const client = new LawApiClient({ apiKey: "test" })
    const text = await client.getLawText({ mst: "288579" })

    expect(text).toContain("기본정보")
    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain("target=law")
    expect(urls[0]).toContain("MST=288579")
    expect(urls[0]).not.toContain("target=eflaw")
  })

  it("조문 단건 조회에 JO 파라미터를 유지한다", async () => {
    const urls = recordFetch(() => jsonRes(LAW_BODY))

    const client = new LawApiClient({ apiKey: "test" })
    await client.getLawText({ mst: "285697", jo: "007500" })

    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain("target=law")
    expect(urls[0]).toContain("JO=007500")
  })

  it("MST 와 lawId 를 함께 받으면 MST 만 싣는다 (MST 가 버전을 특정한다)", async () => {
    const urls = recordFetch(() => jsonRes(LAW_BODY))

    const client = new LawApiClient({ apiKey: "test" })
    await client.getLawText({ mst: "285697", lawId: "000190" })

    expect(urls[0]).toContain("MST=285697")
    expect(urls[0]).not.toContain("ID=000190")
  })

  it("빈 봉투는 그대로 반환한다 (NOT_FOUND 표면화는 상위 레이어 몫)", async () => {
    const urls = recordFetch(() => jsonRes("{}"))

    const client = new LawApiClient({ apiKey: "test" })
    const text = await client.getLawText({ mst: "99999999" })

    expect(text).toBe("{}")
    expect(urls).toHaveLength(1)
  })

  it("target=law 가 끝내 HTML 이면 던진다 (조용한 성공으로 위장하지 않는다)", async () => {
    recordFetch(() => htmlRes())

    const client = new LawApiClient({ apiKey: "test" })
    await settleWithFakeTimers(
      () => client.getLawText({ mst: "285697", jo: "007500" }),
      p => expect(p).rejects.toThrow(/법령 조문\(007500\)을 찾을 수 없습니다/),
    )
  })
})

describe("getLawText: eflaw 가 필요한 경로는 그대로다", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("lawId 단독 조회는 eflaw 로 간다 (eflaw+ID 는 efYd 없이도 정상, 2026-09-23 실측)", async () => {
    const urls = recordFetch(() => jsonRes(LAW_BODY))

    const client = new LawApiClient({ apiKey: "test" })
    await client.getLawText({ lawId: "001706" })

    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain("target=eflaw")
    expect(urls[0]).toContain("ID=001706")
  })

  it("lawId 단독 조회의 빈 봉투는 폴백 없이 그대로 반환한다", async () => {
    const urls = recordFetch(() => jsonRes("{}"))

    const client = new LawApiClient({ apiKey: "test" })
    const text = await client.getLawText({ lawId: "1234" })

    expect(text).toBe("{}")
    expect(urls).toHaveLength(1)
  })

  // MST 는 공포본 단위라 분리시행 공포본이면 target=law 가 시점과 무관하게 마지막 시행
  // 슬라이스를 돌려준다(실측 2026-08-19: target=law&MST=281865 → 시행일자 20271231).
  // 시행일을 못박은 호출이 target=law 로 새면 행위시법 조문 비교가 다른 슬라이스로 오염된다.
  it("efYd 가 있으면 빈 봉투라도 target=law 로 가지 않는다", async () => {
    const urls = recordFetch(() => jsonRes("{}"))

    const client = new LawApiClient({ apiKey: "test" })
    const text = await client.getLawText({ mst: "281865", efYd: "20260701" })

    expect(text).toBe("{}")
    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain("target=eflaw")
    expect(urls[0]).toContain("efYd=20260701")
  })

  it("efYd 동반 요청은 HTML 이면 target=law 로 새지 않고 던진다", async () => {
    const urls = recordFetch(() => htmlRes())

    const client = new LawApiClient({ apiKey: "test" })
    await settleWithFakeTimers(
      () => client.getLawText({ mst: "281865", efYd: "20260701" }),
      p => expect(p).rejects.toThrow(),
    )
    expect(urls.every(u => u.includes("target=eflaw"))).toBe(true)
  })

  it("lawId 단독 조회가 HTML 이면 던지고, type=JSON 호출이라 LAW_RESPONSE_TYPE 우회 안내는 붙이지 않는다", async () => {
    const urls = recordFetch(() => htmlRes())

    const client = new LawApiClient({ apiKey: "test" })
    await settleWithFakeTimers(
      () => client.getLawText({ lawId: "000190" }),
      p => expect(p).rejects.toThrow(/^(?=.*법령을 찾을 수 없습니다)(?!.*LAW_RESPONSE_TYPE).*$/s),
    )
    expect(urls.some(u => u.includes("target=law&"))).toBe(false)
  })
})
