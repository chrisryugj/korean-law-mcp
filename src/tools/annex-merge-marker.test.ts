import { describe, expect, it, vi, afterEach } from "vitest"
import { getAnnexes } from "./annex.js"
import { ExecutionLimitError } from "../lib/execution-limits.js"
import { runWithRequestContext } from "../lib/session-state.js"
import type { LawApiClient } from "../lib/api-client.js"

// 부록 3 — `fetchLawAnnexUnits` 실패가 #127 마커 커버리지 안인지 밖인지.
// 두 호출부가 각각 다른 마커로 이어진다: 목록 경로는 `mergeIssue` 배너,
// 추출 경로는 `canonicalNote` 배너. 이 테스트가 그 커버리지를 못 박는다.

const LIST_JSON = JSON.stringify({
  licBylSearch: {
    totalCnt: "2",
    licbyl: [
      { 별표번호: "000100", 별표명: "과태료 부과기준", 별표종류: "별표", 별표서식파일링크: "/flDownload.do?flSeq=1", 관련법령일련번호: "999999" },
      { 별표번호: "000200", 별표명: "수수료", 별표종류: "별표", 별표서식파일링크: "/flDownload.do?flSeq=2", 관련법령일련번호: "999999" },
    ],
  },
})

function clientWithFailingCanonical(): LawApiClient {
  return {
    getAnnexes: vi.fn(async () => LIST_JSON),
    // fetchLawAnnexUnits 는 fetchApi 를 탄다 — 예산 초과·장애를 이걸로 흉내낸다
    fetchApi: vi.fn(async () => { throw new Error("Upstream response body is 3765828 bytes, over the per-response limit") }),
  } as unknown as LawApiClient
}

describe("현행 본문 병합 실패 — 삼키지 않고 마커로 (#127 커버리지)", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("목록 경로: 병합 실패가 배너로 표면화된다", async () => {
    const result = await getAnnexes(clientWithFailingCanonical(), { lawName: "도로교통법 시행규칙" })
    const text = result.content[0].text

    expect(text).toContain("신설 별표 병합 확인 불가")
    expect(text).toContain("현행 본문 조회 실패")
    // 목록 자체는 유효하므로 isError 가 아니다 — 그래서 마커가 유일한 신호다
    expect(result.isError).toBeUndefined()
    expect(text).toContain("과태료 부과기준")
  }, 30000)

  // 추출 경로(annex.ts 의 두 번째 fetchLawAnnexUnits 호출)는 `canonicalIssue` →
  // `⚠️ 정본 링크 확인 불가` 배너로 이어진다. 그 배너는 파일 파싱이 성공한 뒤에야
  // 붙으므로 실제 HWP/PDF 픽스처가 있어야 끝까지 확인된다 — 여기서는 파싱 이전
  // 단계까지만 돌려 병합 실패가 도구를 죽이지 않는다는 사실만 고정한다.
  it("추출 경로: 정본 조회가 실패해도 licbyl 링크로 진행한다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("본문", {
      status: 200, headers: { "content-type": "text/plain" },
    })))

    const result = await getAnnexes(clientWithFailingCanonical(), {
      lawName: "도로교통법 시행규칙", bylSeq: "000100",
    })
    const text = result.content[0].text

    // 정본 조회 실패가 throw 로 새지 않고 licbyl 링크까지 도달했다는 증거
    expect(text).toContain("flSeq=1")
    expect(text).not.toContain("no canonical")
  }, 30000)
})


describe("별표 정본 조회: 중단 명령", () => {
  it("목록 병합의 예산 소진을 부분 성공으로 삼키지 않는다", async () => {
    const client = clientWithFailingCanonical()
    client.fetchApi = vi.fn(async () => { throw new ExecutionLimitError("budget depleted") })
    const r = await getAnnexes(client, { lawName: "도로교통법 시행규칙" })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain("budget depleted")
    expect(r.content[0].text).not.toContain("신설 별표 병합 확인 불가")
  })

  it("추출 경로의 예산 소진도 인덱스 링크 다운로드로 이어지지 않는다", async () => {
    const client = clientWithFailingCanonical()
    client.fetchApi = vi.fn(async () => { throw new ExecutionLimitError("budget depleted") })
    const fetch = vi.fn(async () => new Response("fallback"))
    vi.stubGlobal("fetch", fetch)
    try {
      const r = await getAnnexes(client, { lawName: "도로교통법 시행규칙", bylSeq: "000100" })
      expect(r.isError).toBe(true)
      expect(r.content[0].text).toContain("budget depleted")
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("정본 확인 중 취소되면 인덱스 링크 다운로드를 시작하지 않는다", async () => {
    const controller = new AbortController()
    const client = clientWithFailingCanonical()
    client.fetchApi = vi.fn(async () => {
      controller.abort(new Error("caller stopped"))
      throw controller.signal.reason
    })
    const fetch = vi.fn(async () => new Response("fallback"))
    vi.stubGlobal("fetch", fetch)
    try {
      const r = await runWithRequestContext({ signal: controller.signal }, () =>
        getAnnexes(client, { lawName: "도로교통법 시행규칙", bylSeq: "000100" }))
      expect(r.isError).toBe(true)
      expect(r.content[0].text).toContain("caller stopped")
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
