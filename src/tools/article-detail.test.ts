import { describe, it, expect } from "vitest"
import { getArticleDetail } from "./article-detail.js"
import type { LawApiClient } from "../lib/api-client.js"

function client(unit: object = {
  조문여부: "조문", 조문번호: "401", 조문가지번호: "2", 조문제목: "업무집행지시자 등의 책임", 조문내용: "제401조의2(업무집행지시자 등의 책임) …",
}, calls: object[] = []): LawApiClient {
  return {
    getLawText: async (params: object) => {
      calls.push(params)
      return JSON.stringify({ 법령: { 기본정보: { 법령명_한글: "상법" }, 조문: { 조문단위: unit } } })
    },
    fetchApi: async () => { throw new Error("eflaw 직접 호출 금지 (#153 이후 MST 단독은 HTML)") },
  } as unknown as LawApiClient
}

describe("getArticleDetail — 조회 위치 라벨 (#118)", () => {
  it("의X 조문에 '조'를 덧붙이지 않는다", async () => {
    const r = await getArticleDetail(client(), { jo: "제401조의2", mst: "272919" })
    const text = r.content[0].text
    expect(text).toContain("조회 위치: 제401조의2")
    expect(text).not.toContain("제401조의2조")
  })

  it("보통 조문 표기는 종전대로", async () => {
    const r = await getArticleDetail(client(), { jo: "제44조", mst: "281875" })
    expect(r.content[0].text).toContain("조회 위치: 제44조")
  })

  it("JO 코드 입력은 자연어 표기로 보여준다", async () => {
    const r = await getArticleDetail(client(), { jo: "040102", mst: "272919" })
    expect(r.content[0].text).toContain("조회 위치: 제401조의2")
  })
})

// 2026-09-23 리뷰 B2·D6: eflaw 를 직접 부르던 MST 경로가 #153 이후 항상 실패해
// impact_map 의 대상 조문이 늘 NOT_FOUND 였다. getLawText 를 거쳐야 한다.
describe("getArticleDetail: getLawText 경유", () => {
  it("MST·JO 를 getLawText 에 넘긴다 (fetchApi 로 eflaw 를 직접 치지 않는다)", async () => {
    const calls: object[] = []
    const r = await getArticleDetail(client(undefined, calls), { jo: "제44조", mst: "281875" })
    expect(r.isError).toBeFalsy()
    expect(calls).toEqual([{ mst: "281875", lawId: undefined, jo: "004400", apiKey: undefined }])
  })
})

// 업스트림은 HANG·HO·MOK 을 무시한다(실측: HANG=2 에도 7개 항 전부). 라벨만 "제2항"이라
// 쓰고 조문 전체를 내보내면 LLM 이 다른 항 내용을 제2항으로 인용한다.
const ARTICLE_38 = {
  조문여부: "조문", 조문번호: "38", 조문제목: "(신고)", 조문내용: "제38조(신고)",
  항: [
    { 항번호: "①", 항내용: "① 첫째 항", 호: [{ 호번호: "1.", 호내용: "1. 일호" }, { 호번호: "2.", 호내용: "2. 이호" }] },
    {
      항번호: "②", 항내용: "② 둘째 항",
      호: [{ 호번호: "1.", 호내용: "1. 둘째항 일호" }, { 호번호: "4.", 호내용: "4. 둘째항 사호", 목: [{ 목번호: "가.", 목내용: "가. 목가" }, { 목번호: "나.", 목내용: "나. 목나" }] }],
    },
  ],
}

describe("getArticleDetail: 항·호·목 로컬 선택", () => {
  it("hang 을 주면 그 항만 싣는다", async () => {
    const text = (await getArticleDetail(client(ARTICLE_38), { jo: "제38조", mst: "1", hang: "2" })).content[0].text
    expect(text).toContain("② 둘째 항")
    expect(text).not.toContain("① 첫째 항")
    expect(text).not.toContain("[주의]")
  })

  it("항 없이 호만 물으면 그 호가 있는 항으로 좁힌다 (다른 항의 '못 찾음'으로 오판하지 않는다)", async () => {
    const text = (await getArticleDetail(client(ARTICLE_38), { jo: "제38조", mst: "1", ho: "4" })).content[0].text
    expect(text).toContain("4. 둘째항 사호")
    expect(text).not.toContain("1. 일호")
    expect(text).not.toContain("1. 둘째항 일호")
    expect(text).not.toContain("[주의]")
  })

  it("목은 숫자로 물어도 받는다 (2 → 나)", async () => {
    const text = (await getArticleDetail(client(ARTICLE_38), { jo: "제38조", mst: "1", hang: "2", ho: "4", mok: "2" })).content[0].text
    expect(text).toContain("나. 목나")
    expect(text).not.toContain("가. 목가")
  })

  it("없는 항을 물으면 거르지 않고 전체를 싣되 못 찾았다고 밝힌다", async () => {
    const text = (await getArticleDetail(client(ARTICLE_38), { jo: "제38조", mst: "1", hang: "9" })).content[0].text
    expect(text).toContain("① 첫째 항")
    expect(text).toContain("② 둘째 항")
    expect(text).toContain("[주의] 제9항")
  })
})
