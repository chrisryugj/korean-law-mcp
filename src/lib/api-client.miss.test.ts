import { describe, it, expect, vi, afterEach } from "vitest"
import { LawApiClient } from "./api-client.js"

// 법제처 DRF는 미스도 HTTP 200으로 답한다. `lawService.do` 단건 조회의 일부 조합은
// 그 200에 **빈 본문**(prec·thdCmp·lsStmd + JSON) 또는 **권한 안내 HTML**(lsStmd + XML)을
// 실어 보내는데, 이것이 "점검·과부하" 신호로 오인돼 재시도 사다리를 완주했다.
// 실측(2026-08-16, 이슈 #88 정정 코멘트): get_three_tier 미스 12.9초 / 업스트림 4회,
// get_law_system_tree 미스 10.6초 / 4회. 반면 검색(`lawSearch.do`) 미스는 18/18이
// 정상 봉투라 같은 위험이 없다 — 그쪽 방어는 건드리지 않는다.

// lsStmd/XML 미스 실본문(요지). 문구는 OC 키의 API 신청 상태에 따라 달라지므로
// 분류가 이 문안에 의존해서는 안 된다.
const LSSTMD_NOTICE_HTML =
  `<!DOCTYPE html><html><head><title>국가법령정보 공동활용</title></head><body>` +
  `국가법령정보 공동활용 미신청된 목록/본문에 대한 접근입니다. OPEN API 로그인 후 신청하세요.` +
  `</body></html>`

const emptyJson = () => new Response("", { status: 200, headers: { "content-type": "application/json" } })

/**
 * 가짜 시계로 돌린다: 백오프를 실시간으로 기다리면 이 파일 하나가 23초를 썼다(2026-09-23 리뷰 D14).
 * 경과 시간 단정은 가짜 시계 기준이라 오히려 결정적이다.
 */
async function underFakeClock<T>(call: () => Promise<T>) {
  vi.useFakeTimers()
  try {
    const started = Date.now()
    let settledAt = 0
    const outcome = call()
      .finally(() => { settledAt = Date.now() })
      .then(value => ({ ok: true as const, value, error: undefined }), error => ({ ok: false as const, value: undefined, error }))
    await vi.advanceTimersByTimeAsync(60_000)
    return { ...(await outcome), elapsed: settledAt - started }
  } finally {
    vi.useRealTimers()
  }
}

describe("lawService.do 단건 조회 미스 — 확인 1회 후 표면화", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("thdCmp 빈 본문 미스: 업스트림 2회로 끊고 오류로 표면화한다", async () => {
    let n = 0
    vi.stubGlobal("fetch", vi.fn(async () => { n++; return emptyJson() }))

    const client = new LawApiClient({ apiKey: "test" })
    const r = await underFakeClock(() => client.getThreeTier({ mst: "99999999" }))

    expect(r.ok).toBe(false)
    expect(n).toBe(2)                              // 최초 + 확인 재시도 1회
    expect(r.elapsed).toBeLessThan(1000)           // 사다리(1+2+4s) 소진 아님
  })

  it("일시 장애로 한 번 비었다가 회복되면 정상 응답을 돌려준다 (미스 오탐 방지)", async () => {
    let n = 0
    vi.stubGlobal("fetch", vi.fn(async () => {
      n++
      return n === 1 ? emptyJson() : new Response(`{"법령": {"기본정보": {}}}`, { status: 200 })
    }))

    const client = new LawApiClient({ apiKey: "test" })
    const r = await underFakeClock(() => client.getThreeTier({ mst: "288689" }))
    expect(r.value).toContain("기본정보")
    expect(n).toBe(2)
  })

  it("lsStmd 권한 안내 HTML 미스: 문구 매칭 없이 2회로 끊는다", async () => {
    let n = 0
    vi.stubGlobal("fetch", vi.fn(async () => {
      n++
      return new Response(LSSTMD_NOTICE_HTML, { status: 200, headers: { "content-type": "text/html" } })
    }))

    const client = new LawApiClient({ apiKey: "test" })
    const r = await underFakeClock(() => client.fetchApi({
      endpoint: "lawService.do",
      target: "lsStmd",
      type: "XML",
      extraParams: { MST: "99999999" },
    }))
    expect(r.ok).toBe(false)
    expect(n).toBe(2)
  })

  it("검색(lawSearch.do)의 빈 본문은 여전히 일시 장애로 보고 사다리를 유지한다", async () => {
    let n = 0
    vi.stubGlobal("fetch", vi.fn(async () => { n++; return emptyJson() }))

    const client = new LawApiClient({ apiKey: "test" })
    const r = await underFakeClock(() => client.searchLaw("민법"))
    expect(r.ok).toBe(false)
    expect(n).toBe(4)                              // 1회 + 재시도 3회 = 기존 방어 그대로
  })

  // #150-2: "빈 본문 = 미스일 수 있다"는 실측표상 prec·thdCmp·lsStmd 뿐이다.
  // endpoint 단위 배선은 target=law까지 사다리를 2회로 자르고, 오류 문안에
  // "자료가 실제로 없음"이라는 부존재 후보를 섞는다 — 거기 빈 본문은 진짜 장애다.
  it("미스가 정상 봉투로 오는 target(law)은 빈 본문을 장애로 보고 사다리를 유지한다", async () => {
    let n = 0
    vi.stubGlobal("fetch", vi.fn(async () => { n++; return emptyJson() }))

    const client = new LawApiClient({ apiKey: "test" })
    const r = await underFakeClock(() => client.fetchApi({
      endpoint: "lawService.do",
      target: "law",
      type: "JSON",
      extraParams: { MST: "160001" },
    }))
    expect(String(r.error)).toMatch(/빈 응답/)
    expect(n).toBe(4)                              // 미스 확정(2회)이 아니라 장애 사다리(4회)
  })

  it("getLawText 도 빈 본문에서 미스 확정 대신 사다리를 유지한다", async () => {
    let n = 0
    vi.stubGlobal("fetch", vi.fn(async () => { n++; return emptyJson() }))

    const client = new LawApiClient({ apiKey: "test" })
    const r = await underFakeClock(() => client.getLawText({ mst: "160001" }))
    expect(String(r.error)).toMatch(/빈 응답/)
    expect(n).toBe(4)
  })
})

describe("빈 응답 가드 — 파서가 아니라 여기서 잡힌다", () => {
  afterEach(() => vi.unstubAllGlobals())

  // 사다리를 다 태우고도 빈 본문이면 그 ""가 파서까지 내려가 "missing root element"류
  // 예외가 됐다. 원인(업스트림 빈 응답)이 증상(파싱 실패)으로 바뀌어 진단이 어려워진다.
  const searches: Array<[string, (c: LawApiClient) => Promise<string>]> = [
    ["searchOrdinance", (c) => c.searchOrdinance({ query: "주차" })],
    ["searchAdminRule", (c) => c.searchAdminRule({ query: "훈령" })],
    ["getLawHistory", (c) => c.getLawHistory({ regDt: "20260101" })],
    ["getArticleHistory", (c) => c.getArticleHistory({ lawId: "001565" })],
    ["getAnnexes", (c) => c.getAnnexes({ lawName: "도로교통법 시행규칙" })],
  ]

  for (const [name, call] of searches) {
    it(`${name}: 빈 응답을 명시적 메시지로 전환한다`, async () => {
      vi.stubGlobal("fetch", vi.fn(async () => emptyJson()))
      const r = await underFakeClock(() => call(new LawApiClient({ apiKey: "test" })))
      expect(String(r.error)).toMatch(/빈 응답/)
    })
  }
})

describe("백오프 상수 — 업스트림 왕복 대비 비율", () => {
  afterEach(() => vi.unstubAllGlobals())

  // 업스트림 왕복은 검색 ~0.45초 / 단건 조회 ~0.9초(04_qa_verification.md §2.1·§3.2)인데
  // base 1,000ms 사다리는 1+2+4초(지터 최대 +50%)를 태워 왕복의 6~8배를 대기에 썼다.
  it("404 사다리 소진이 5초 안에 끝난다 (재시도 횟수·retryOn은 그대로)", async () => {
    let n = 0
    vi.stubGlobal("fetch", vi.fn(async () => { n++; return new Response("Not Found", { status: 404 }) }))

    const client = new LawApiClient({ apiKey: "test" })
    const r = await underFakeClock(() => client.fetchApi({
      endpoint: "lawSearch.do",
      target: "lsHistory",
      type: "HTML",
      extraParams: { query: "소득세법" },
    }))

    expect(String(r.error)).toMatch(/404/)
    expect(n).toBe(4)                               // 버스트 404 워크어라운드 유지
    expect(r.elapsed).toBeLessThan(5000)
  })
})
