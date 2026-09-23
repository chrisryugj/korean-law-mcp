/**
 * 체인 조립 회귀 (2026-09-23 리뷰 B#10·B#11)
 *
 * B#10 같은 질의의 의미검색을 한 체인이 두 번 치던 것
 * B#11 보조 갈래의 장애가 "결과 없음"으로 읽히거나 체인 전체를 죽이던 것
 */
import { describe, it, expect, beforeEach } from "vitest"
import { chainFullResearch, chainProcedureDetail, chainOrdinanceCompare, chainDocumentReview } from "./chains.js"
import { lawCache } from "../lib/cache.js"
import type { LawApiClient } from "../lib/api-client.js"

const lawXml = (names: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><LawSearch><totalCnt>${names.length}</totalCnt>` +
  names.map((n, i) =>
    `<law id="${i + 1}"><법령일련번호>${9000 + i}</법령일련번호><법령명한글><![CDATA[${n}]]></법령명한글>` +
    `<법령ID>${1000 + i}</법령ID><법령구분명>법률</법령구분명></law>`
  ).join("") + `</LawSearch>`

const aiXml = (lawName: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><aiSearch><검색결과개수>1</검색결과개수><법령조문>` +
  `<법령ID>1000</법령ID><법령명>${lawName}</법령명><법령종류명>법률</법령종류명>` +
  `<조문번호>0044</조문번호><조문제목>술에 취한 상태에서의 운전 금지</조문제목>` +
  `<조문내용><![CDATA[누구든지 술에 취한 상태에서…]]></조문내용><시행일자>20230101</시행일자>` +
  `</법령조문></aiSearch>`

const emptyAny = `<?xml version="1.0" encoding="UTF-8"?><Empty><totalCnt>0</totalCnt></Empty>`

const ORDIN_XML = `<?xml version="1.0" encoding="UTF-8"?><OrdinSearch><totalCnt>1</totalCnt><page>1</page>` +
  `<law><자치법규일련번호>1279715</자치법규일련번호><자치법규명><![CDATA[서울특별시 주차장 조례]]></자치법규명>` +
  `<지자체기관명>서울특별시</지자체기관명><공포일자>20200101</공포일자><시행일자>20200101</시행일자></law></OrdinSearch>`

/** 법령명 정확 검색만 응답하는 법제처 흉내. 구어 질의는 의미검색(3단계)까지 가야 법령이 잡힌다 */
function colloquialClient(known: string[]) {
  const aiQueries: string[] = []
  const client = {
    aiQueries,
    async searchLaw(query: string) { return lawXml(known.filter(n => n.includes(query.trim()))) },
    async getLawText() { throw new Error("본문 생략(mock)") },
    async getThreeTier() { return "{}" },
    async getAnnexes() { return "{}" },
    async fetchApi({ target, extraParams }: { target?: string; extraParams?: Record<string, string> }) {
      if (target === "aiSearch") {
        aiQueries.push(extraParams?.query ?? "")
        return aiXml("도로교통법")
      }
      return emptyAny
    },
  }
  return client as unknown as LawApiClient & { aiQueries: string[] }
}

describe("B#10 의미검색은 체인 한 번에 한 번", () => {
  beforeEach(() => lawCache.clear())

  it("full_research: 기반 법령 탐색 3단계가 체인의 AI 검색 결과를 넘겨받는다 (종전 2회)", async () => {
    const c = colloquialClient(["도로교통법"])
    const res = await chainFullResearch(c, { query: "음주운전 과태료 기준 얼마" })
    expect(c.aiQueries).toHaveLength(1)
    expect(res.content[0].text).toContain("도로교통법 본문")   // 3단계로 잡은 기반 법령이 그대로 쓰인다
  })

  it("procedure_detail: 보완 정보 섹션과 기반 법령 탐색이 같은 요청을 한 번만 보낸다 (종전 2회)", async () => {
    const c = colloquialClient(["도로교통법"])
    const res = await chainProcedureDetail(c, { query: "음주운전 과태료 기준 얼마" })
    expect(c.aiQueries).toHaveLength(1)
    const text = res.content[0].text
    expect(text).toContain("법령: 도로교통법")
    expect(text).toContain("▶ AI 검색 보완 정보")
  })
})

describe("B#11 보조 갈래의 장애는 '없음'이 아니라 '실패'로 밝히고 체인은 계속한다", () => {
  beforeEach(() => lawCache.clear())

  it("ordinance_compare: 상위 법령 검색 장애가 조례 검색까지 죽이지 않는다", async () => {
    const client = {
      async searchLaw() { throw new Error("법제처 서버 오류 (500) - searchLaw") },
      async searchOrdinance() { return ORDIN_XML },
      async getOrdinance() { return "{}" },
    } as unknown as LawApiClient
    const res = await chainOrdinanceCompare(client, { query: "주차장 조례" })
    const text = res.content[0].text
    expect(res.isError).toBeFalsy()                          // 종전: 체인 전체가 오류 응답
    expect(text).toContain("▶ 상위 법령 [NOT_FOUND / FAILED]")
    expect(text).toContain("[1279715]")
  })

  it("full_research: 기반 법령 검색 장애를 '관련 법령 없음'으로 삼키지 않는다", async () => {
    const client = {
      async searchLaw() { throw new Error("법제처 서버 오류 (500) - searchLaw") },
      async fetchApi() { return emptyAny },
    } as unknown as LawApiClient
    const res = await chainFullResearch(client, { query: "도로교통법 음주운전" })
    const text = res.content[0].text
    expect(text).toContain("▶ 법령 본문 (기반 법령 검색) [NOT_FOUND / FAILED]")
    expect(text).toContain("법제처 서버 오류")
    expect(res.isError).toBeFalsy()
  })

  it("document_review: AI 법령 검색 장애는 '근거 법령 검색 실패'로 밝힌다 (종전: 섹션이 조용히 사라짐)", async () => {
    const client = {
      async fetchApi({ target }: { target?: string }) {
        if (target === "aiSearch") throw new Error("법제처 서버 오류 (500) - aiSearch")
        return emptyAny
      },
    } as unknown as LawApiClient
    const text = [
      "주택 임대차 계약서",
      "제1조(보증금) 임대인은 계약 종료 후 보증금 반환을 지체할 수 있다.",
      "제2조(위약금) 임차인이 계약을 위반하면 보증금 전액을 위약금으로 몰수한다.",
    ].join("\n")
    const res = await chainDocumentReview(client, { text, maxClauses: 15 })
    const out = res.content[0].text
    expect(out).toContain("▶ 근거 법령 검색 실패 [NOT_FOUND / FAILED]")
    expect(out).not.toContain("▶ 근거 법령\n")
  })
})
