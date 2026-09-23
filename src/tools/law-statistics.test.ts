import { afterEach, beforeEach, describe, it, expect, vi } from "vitest"
import { getLawStatistics } from "./law-statistics.js"
import { ExecutionLimitError } from "../lib/execution-limits.js"
import type { LawApiClient } from "../lib/api-client.js"

// 2026-09-23 리뷰 D2: 실측 lsHstInf 응답(regDt=20260901·20260902)의 항목 원문(OC만 치환).
// 항목 태그는 <law>, 개정구분은 <제개정구분명>. 같은 법령일련번호(289029)가 두 날에 모두 나온다.
const ITEM_289029 =
  `<law id="1"><법령일련번호>289029</법령일련번호><현행연혁코드>현행</현행연혁코드><법령명한글><![CDATA[경찰공무원 임용령]]></법령명한글>` +
  `<법령ID>002194</법령ID><공포일자>20260901</공포일자><공포번호>36634</공포번호><제개정구분명>일부개정</제개정구분명>` +
  `<소관부처코드>1320000</소관부처코드><소관부처명>경찰청</소관부처명><법령구분명>대통령령</법령구분명><시행일자>20260901</시행일자>` +
  `<자법타법여부></자법타법여부><법령상세링크>/DRF/lawService.do?OC=test&amp;target=law&amp;MST=289029&amp;type=HTML</법령상세링크></law>`
const ITEM_289323 =
  `<law id="2"><법령일련번호>289323</법령일련번호><현행연혁코드>연혁</현행연혁코드>` +
  `<법령명한글><![CDATA[2018 평창 동계올림픽대회 및 동계패럴림픽대회 지원 등에 관한 특별법]]></법령명한글><법령ID>011532</법령ID>` +
  `<공포일자>20260908</공포일자><공포번호>21901</공포번호><제개정구분명>타법개정</제개정구분명><소관부처코드>1371000</소관부처코드>` +
  `<소관부처명>문화체육관광부</소관부처명><법령구분명>법률</법령구분명><시행일자>20270909</시행일자><자법타법여부></자법타법여부>` +
  `<법령상세링크>/DRF/lawService.do?OC=test&amp;target=law&amp;MST=289323&amp;type=HTML</법령상세링크></law>`
const ITEM_289305 =
  `<law id="3"><법령일련번호>289305</법령일련번호><현행연혁코드>현행</현행연혁코드>` +
  `<법령명한글><![CDATA[5ㆍ18민주유공자예우 및 단체설립에 관한 법률]]></법령명한글><법령ID>009289</법령ID>` +
  `<공포일자>20260908</공포일자><공포번호>21887</공포번호><제개정구분명>일부개정</제개정구분명><소관부처코드>1830000</소관부처코드>` +
  `<소관부처명>국가보훈부</소관부처명><법령구분명>법률</법령구분명><시행일자>20260908</시행일자><자법타법여부></자법타법여부>` +
  `<법령상세링크>/DRF/lawService.do?OC=test&amp;target=law&amp;MST=289305&amp;type=HTML</법령상세링크></law>`
const ITEM_265271_OLD =
  `<law id="5"><법령일련번호>265271</법령일련번호><현행연혁코드>연혁</현행연혁코드><법령명한글><![CDATA[대통령비서실 직제]]></법령명한글>` +
  `<법령ID>011784</법령ID><공포일자>20240910</공포일자><공포번호>34889</공포번호><제개정구분명>일부개정</제개정구분명>` +
  `<소관부처코드>1741000</소관부처코드><소관부처명>행정안전부</소관부처명><법령구분명>대통령령</법령구분명><시행일자>20240910</시행일자>` +
  `<자법타법여부></자법타법여부><법령상세링크>/DRF/lawService.do?OC=test&amp;target=law&amp;MST=265271&amp;type=HTML</법령상세링크></law>`

const page = (totalCnt: number, items: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><LawSearch><target>lsHstInf</target><totalCnt>${totalCnt}</totalCnt>${items.join("")}</LawSearch>`

// 20260901은 실측 총 132건(여기선 3건만 실음 → 상한 표기 대상), 20260902는 실측 18건 중 2건
const DAYS: Record<string, string> = {
  "20260902": page(2, [ITEM_289029, ITEM_265271_OLD]),
  "20260901": page(132, [ITEM_289323, ITEM_289305, ITEM_289029]),
}
const EMPTY_DAY = page(0, [])

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-09-02T03:00:00Z"))   // KST 2026-09-02 12:00
})
afterEach(() => vi.useRealTimers())

describe("getLawStatistics: lsHstInf 실측 형상 (D2)", () => {
  it("<law>·<제개정구분명>을 읽어 0건이 아닌 실제 개정 목록을 낸다", async () => {
    const regDts: string[] = []
    const client = {
      getLawHistory: async ({ regDt }: { regDt: string }) => { regDts.push(regDt); return DAYS[regDt] ?? EMPTY_DAY },
    } as unknown as LawApiClient

    const r = await getLawStatistics(client, { days: 1, limit: 10 })
    const t = r.content[0].text
    expect(r.isError).toBeFalsy()
    expect(regDts).toEqual(["20260902", "20260901"])     // 최신일부터
    expect(t).toContain("5ㆍ18민주유공자예우 및 단체설립에 관한 법률")
    expect(t).toContain("개정구분: 타법개정")
    expect(t).toContain("공포일: 2026-09-08 / 시행일: 2027-09-09")
    // 289029는 두 날에 모두 나오지만 한 번만 센다: 3 + 2 - 1 = 4
    expect(t).toContain("총 4건")
    expect(t.match(/경찰공무원 임용령/g)).toHaveLength(1)
    expect(t).not.toContain("총 0건")
  })

  it("공포일 최신순으로 정렬해 반영일만 최근인 과거 공포본은 뒤로 민다", async () => {
    const client = { getLawHistory: async ({ regDt }: { regDt: string }) => DAYS[regDt] ?? EMPTY_DAY } as unknown as LawApiClient
    const t = (await getLawStatistics(client, { days: 1, limit: 10 })).content[0].text
    expect(t.indexOf("대통령비서실 직제")).toBeGreaterThan(t.indexOf("경찰공무원 임용령"))
    expect(t.indexOf("경찰공무원 임용령")).toBeGreaterThan(t.indexOf("5ㆍ18민주유공자예우"))
  })

  it("하루 100건 상한에 걸린 날을 밝힌다 (총계 132 > 수집 3)", async () => {
    const client = { getLawHistory: async ({ regDt }: { regDt: string }) => DAYS[regDt] ?? EMPTY_DAY } as unknown as LawApiClient
    const t = (await getLawStatistics(client, { days: 1, limit: 10 })).content[0].text
    expect(t).toContain("2026-09-01(132건 중 3건)")
  })

  it("날짜는 한국 시각 기준이다 (UTC 20시 = KST 다음날 05시)", async () => {
    vi.setSystemTime(new Date("2026-09-01T20:00:00Z"))
    const regDts: string[] = []
    const client = { getLawHistory: async ({ regDt }: { regDt: string }) => { regDts.push(regDt); return EMPTY_DAY } } as unknown as LawApiClient
    await getLawStatistics(client, { days: 1, limit: 10 })
    expect(regDts[0]).toBe("20260902")
  })
})

describe("getLawStatistics: 부분 결과는 부분이라고 말한다 (D2)", () => {
  it("요청 예산이 바닥나면 받은 최신일까지 싣고 못 받은 오래된 날을 밝힌다", async () => {
    let n = 0
    const client = {
      getLawHistory: async ({ regDt }: { regDt: string }) => {
        n++
        if (n > 3) throw new ExecutionLimitError("upstream request budget exhausted")
        return regDt === "20260902" ? DAYS["20260902"] : EMPTY_DAY
      },
    } as unknown as LawApiClient

    const r = await getLawStatistics(client, { days: 9, limit: 10 })
    const t = r.content[0].text
    expect(r.isError).toBeFalsy()
    expect(t).toContain("경찰공무원 임용령")           // 최신일(0902) 수집분은 싣는다
    // 0902·0901·0831 수신, 0830·0829에서 예산 소진, 0828~0824는 요청조차 못 함 → 7일
    expect(t).toContain("요청 예산 소진으로 가장 오래된 7일(2026-08-24 ~ 2026-08-30)")
    expect(t).toContain("부분 결과")
  })

  it("일부 날짜 조회 실패는 그 날짜를 밝혀 적는다", async () => {
    const client = {
      getLawHistory: async ({ regDt }: { regDt: string }) => {
        if (regDt === "20260901") throw new Error("법제처 서버 오류 (503) - getLawHistory")
        return DAYS[regDt] ?? EMPTY_DAY
      },
    } as unknown as LawApiClient
    const t = (await getLawStatistics(client, { days: 1, limit: 10 })).content[0].text
    expect(t).toContain("1일 조회 실패(2026-09-01)")
  })

  it("한 날도 못 받으면 '0건' 성공이 아니라 오류로 답한다", async () => {
    const client = {
      getLawHistory: async () => { throw new Error("법제처 서버 오류 (503) - getLawHistory") },
    } as unknown as LawApiClient
    const r = await getLawStatistics(client, { days: 2, limit: 10 })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain("한 날도 조회하지 못했습니다")
    expect(r.content[0].text).not.toContain("총 0건")
  })

  // 독립 리뷰: 키 없음·권한 오류는 재시도로 낫지 않는다. "잠시 후 다시"만 말하면 원인을 못 찾는다
  it("전부 실패하면 첫 실패 원인을 싣는다", async () => {
    const client = {
      getLawHistory: async () => { throw new Error("API 오류 (403) - getLawHistory") },
    } as unknown as LawApiClient
    const r = await getLawStatistics(client, { days: 2, limit: 10 })
    expect(r.content[0].text).toContain("첫 실패 원인: API 오류 (403)")
  })
})
