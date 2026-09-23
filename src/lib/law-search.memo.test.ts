/**
 * findLaws 요청 단위 공유·치명 오류 전파 (2026-09-23 리뷰 B#3·A10·B#11)
 */
import { describe, it, expect, beforeEach } from "vitest"
import { findLaws } from "./law-search.js"
import { lawCache } from "./cache.js"
import { requestContext } from "./session-state.js"
import { ExecutionLimitError, RequestExecutionBudget, DEFAULT_EXECUTION_LIMITS } from "./execution-limits.js"
import type { LawApiClient } from "./api-client.js"

const lawXml = (name: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><LawSearch><totalCnt>1</totalCnt><law id="1">` +
  `<법령일련번호>9001</법령일련번호><법령명한글><![CDATA[${name}]]></법령명한글>` +
  `<법령ID>1001</법령ID><법령구분명>법률</법령구분명></law></LawSearch>`

function countingClient(): LawApiClient & { calls: string[] } {
  const calls: string[] = []
  const client = {
    calls,
    async searchLaw(query: string) {
      calls.push(query)
      await new Promise(resolve => setImmediate(resolve))
      return lawXml("민법")
    },
  }
  return client as unknown as LawApiClient & { calls: string[] }
}

describe("findLaws 요청 단위 공유 (A10)", () => {
  beforeEach(() => lawCache.clear())

  it("한 요청 안에서 동시에 도는 같은 검색은 업스트림 1회로 묶인다 (max 가 달라도)", async () => {
    const c = countingClient()
    const results = await requestContext.run({}, () => Promise.all([
      findLaws(c, "민법", undefined, 5, 100),
      findLaws(c, "민법", undefined, 5, 100),
      findLaws(c, "민법", undefined, 1, 100),
    ]))
    expect(c.calls).toEqual(["민법"])
    expect(results.map(r => r[0]?.lawName)).toEqual(["민법", "민법", "민법"])
  })

  it("공유는 요청 컨텍스트 경계를 넘지 않는다 (전역 in-flight 맵 금지)", async () => {
    const c = countingClient()
    await Promise.all([
      requestContext.run({}, () => findLaws(c, "민법")),
      requestContext.run({}, () => findLaws(c, "민법")),
    ])
    expect(c.calls).toHaveLength(2)
  })
})

describe("findLaws 치명 오류 즉시 전파 (B#11)", () => {
  beforeEach(() => lawCache.clear())

  it("예산 소진은 다른 검색어 변형으로 넘어가지 않고 그대로 올린다", async () => {
    const calls: string[] = []
    const client = {
      async searchLaw(query: string) {
        calls.push(query)
        throw new ExecutionLimitError("Request upstream work budget exceeded (max 48 attempts).")
      },
    } as unknown as LawApiClient
    const budget = new RequestExecutionBudget(DEFAULT_EXECUTION_LIMITS)
    // 원문·부가어 제거·법령명 패턴 3변형이 가능한 질의. 종전엔 3번 모두 시도한 뒤 "법령 검색 실패"로 감쌌다
    await expect(requestContext.run({ budget }, () => findLaws(client, "관세법 과태료 기준")))
      .rejects.toBeInstanceOf(ExecutionLimitError)
    expect(calls).toEqual(["관세법 과태료 기준"])
  })
})
