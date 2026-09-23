/**
 * get_annexes 비용 회귀 (2026-09-23 리뷰 C2·C9)
 *
 * C9: 목록 경로가 현행 본문(target=law, 도로교통법 시행규칙 실측 3.8MB)을 받아 신설 별표를 병합한 뒤
 *     query 가 1건으로 좁혀 본문 추출로 넘어가면, 같은 본문을 한 번 더 받았다(fetchApi 는 캐시가 없다).
 *     요청당 업스트림 1회와 본문 예산 3.8MB 를 그냥 버렸다.
 * C2: lawName 의 공백 덩어리가 별표 표기 파싱에서 제곱으로 백트래킹해 fetch 전에 멈췄다(10만 자 19.3초).
 */
import { describe, expect, it, vi, afterEach } from "vitest"
import { getAnnexes } from "./annex.js"
import type { LawApiClient } from "../lib/api-client.js"

const LIST_JSON = JSON.stringify({
  licBylSearch: {
    totalCnt: "2",
    licbyl: [
      { 별표번호: "000100", 별표명: "과태료 부과기준", 별표종류: "별표", 별표서식파일링크: "/flDownload.do?flSeq=1", 관련법령일련번호: "999999" },
      { 별표번호: "000200", 별표명: "수수료", 별표종류: "별표", 별표서식파일링크: "/flDownload.do?flSeq=2", 관련법령일련번호: "999999" },
    ],
  },
})

const LAW_JSON = JSON.stringify({
  법령: {
    별표: {
      별표단위: [
        { 별표번호: "0001", 별표가지번호: "00", 별표구분: "별표", 별표제목: "과태료 부과기준", 별표서식파일링크: "/flDownload.do?flSeq=11" },
        { 별표번호: "0002", 별표가지번호: "00", 별표구분: "별표", 별표제목: "수수료", 별표서식파일링크: "/flDownload.do?flSeq=12" },
      ],
    },
  },
})

/** target=law 조회만 세고, n번째 조회에 lawResponses[n] 을 돌려준다 */
function countingClient(lawResponses: Array<() => Promise<string>>): { client: LawApiClient, lawCalls: () => number } {
  let calls = 0
  const client = {
    getAnnexes: vi.fn(async () => LIST_JSON),
    fetchApi: vi.fn(async (p: { target?: string }) => {
      if (p.target !== "law") return "{}"
      const respond = lawResponses[Math.min(calls, lawResponses.length - 1)]
      calls++
      return respond()
    }),
  } as unknown as LawApiClient
  return { client, lawCalls: () => calls }
}

/** 별표 파일 다운로드를 가로채고 요청 URL 을 모은다 */
function stubDownload(): string[] {
  const urls: string[] = []
  vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
    urls.push(String(url))
    return new Response("본문", { status: 200, headers: { "content-type": "text/plain" } })
  }))
  return urls
}

describe("현행 본문을 한 요청에서 두 번 받지 않는다 (리뷰 C9)", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("query 로 1건이 좁혀져 본문 추출로 넘어가도 target=law 조회는 1회다", async () => {
    const urls = stubDownload()
    const { client, lawCalls } = countingClient([async () => LAW_JSON])
    await getAnnexes(client, { lawName: "도로교통법 시행규칙", query: "과태료" })
    expect(lawCalls()).toBe(1)
    // 좁혀진 1건의 본문 추출 경로까지 갔다: 정본(현행 본문) 링크로 내려받았다
    expect(urls.some(u => u.includes("flSeq=11"))).toBe(true)
  }, 30000)

  it("첫 조회가 실패하면 추출 단계가 종전처럼 다시 시도한다 (실패는 기억하지 않는다)", async () => {
    stubDownload()
    const { client, lawCalls } = countingClient([
      async () => { throw new Error("upstream down") },
      async () => LAW_JSON,
    ])
    await getAnnexes(client, { lawName: "도로교통법 시행규칙", query: "과태료" })
    expect(lawCalls()).toBe(2)
  }, 30000)
})

describe("공백 덩어리 lawName 전체 경로 (리뷰 C2)", () => {
  it("별표 표기 파싱이 fetch 전에 이벤트 루프를 멈추지 않는다", async () => {
    const client = {
      getAnnexes: vi.fn(async () => "{}"),
      fetchApi: vi.fn(async () => "{}"),
    } as unknown as LawApiClient
    const t0 = performance.now()
    const result = await getAnnexes(client, { lawName: "관세법 별표" + " ".repeat(100_000) + "가" })
    expect(performance.now() - t0).toBeLessThan(500)
    expect(result.isError).toBe(true)
  })
})
