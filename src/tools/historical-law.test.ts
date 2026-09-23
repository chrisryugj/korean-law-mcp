import { describe, it, expect } from "vitest"
import { getHistoricalLaw, searchHistoricalLaw } from "./historical-law.js"
import type { LawApiClient } from "../lib/api-client.js"

// 실제 lawService(target=law) JSON 축약 — 법령명은 "법령명_한글" 키, 소관부처는 {content} 객체,
// 조문은 법령.조문.조문단위[]로 **한 겹 감싸서** 온다(2026-08-29 실측 아동복지법 MST 285697).
// 장·절 헤더는 같은 배열에 조문여부="전문"으로 섞이고, 조문 본문은 조문내용이 아니라 항·호에 있다.
const HIST_JSON = JSON.stringify({
  법령: {
    기본정보: {
      법령명_한글: "상법",
      시행일자: "20260910",
      공포일자: "20250909",
      공포번호: "21044",
      제개정구분명: "일부개정",
      소관부처: { content: "법무부", 소관부처코드: "1270000" },
    },
    조문: {
      조문단위: [
        { 조문번호: "1", 조문여부: "전문", 조문내용: "        제1편 총칙" },
        { 조문번호: "1", 조문여부: "조문", 조문제목: "목적", 조문내용: ["제1조(목적)", "이 법은 상사에 관하여…"] },
        {
          조문번호: "2", 조문가지번호: "3", 조문여부: "조문", 조문제목: "적용범위",
          조문내용: "제2조의3(적용범위)",
          항: [{ 항번호: "①", 항내용: "① 이 법은 상행위에 적용한다." }],
        },
      ],
    },
  },
})

const client = { fetchApi: async () => HIST_JSON } as unknown as LawApiClient

describe("getHistoricalLaw — JSON 객체 필드 안전 문자열화", () => {
  it("소관부처 객체·법령명_한글 키·조문내용 배열을 훼손 없이 출력", async () => {
    const r = await getHistoricalLaw(client, { mst: "273629" })
    const t = r.content[0].text
    expect(t).toContain("법령명: 상법")          // 종전엔 N/A
    expect(t).toContain("소관부처: 법무부")       // 종전엔 [object Object]
    expect(t).toContain("이 법은 상사에")          // 배열 조문내용 평탄화
    expect(t).not.toContain("[object Object]")
  })
})

// 회귀 (#153 곁가지 2): law.조문을 조문 객체의 배열로 읽어 조문단위 래퍼 하나만 잡히면서
// 조문 목록이 "제undefined조" 한 줄로 무너졌다.
describe("getHistoricalLaw — 조문단위 래퍼를 풀어 읽는다 (#153)", () => {
  it("조문번호가 undefined로 새지 않고 실제 조문이 잡힌다", async () => {
    const t = (await getHistoricalLaw(client, { mst: "273629" })).content[0].text
    expect(t).not.toContain("undefined")
    expect(t).toContain("제1조 (목적)")
  })

  it("조문여부=전문(장·절 헤더)은 조문 수에서 제외한다", async () => {
    const t = (await getHistoricalLaw(client, { mst: "273629" })).content[0].text
    expect(t).toContain("조문 (총 2개)")           // 전문 1건을 세면 3개가 된다
    expect(t).not.toContain("제1편 총칙")
  })

  it("가지번호 조문은 '제2조의3'으로 표시하고 항 본문까지 편다", async () => {
    const t = (await getHistoricalLaw(client, { mst: "273629" })).content[0].text
    expect(t).toContain("제2조의3 (적용범위)")
    expect(t).toContain("이 법은 상행위에 적용한다")  // 조문내용은 제목줄뿐 — 항을 안 펴면 빈다
  })

  it("jo 지정 조회가 가지번호까지 맞춰 찾는다", async () => {
    const t = (await getHistoricalLaw(client, { mst: "273629", jo: "제2조의3" })).content[0].text
    expect(t).toContain("제목: 적용범위")
    expect(t).toContain("이 법은 상행위에 적용한다")
    expect(t).not.toContain("[NOT_FOUND]")
  })

  it("없는 조문은 NOT_FOUND와 함께 실제 조문 목록을 안내한다", async () => {
    const t = (await getHistoricalLaw(client, { mst: "273629", jo: "제99조" })).content[0].text
    expect(t).toContain("[NOT_FOUND]")
    expect(t).toContain("- 제1조 목적")
    expect(t).toContain("- 제2조의3 적용범위")
  })
})

// 2026-09-23 리뷰 B12: search_historical_law가 historical-utils의 고친 파서를 쓰지 않고 옛 사본을 들고 있었다.
// 실측 lsHistory(query=지방세법, sort=efasc) 행 원문(OC만 치환). 날짜가 0패딩 없이 온다.
const LSHISTORY_ROWS = [
  `<tr> <td class="ce">5</td> <td><a href="/DRF/lawService.do?OC=test&amp;target=lsHistory&amp;MST=6418&amp;type=HTML&amp;mobileYn=&amp;efYd=19510401" >지방세법</a></td> <td class="ce">행정안전부</td> <td class="ce">일부개정</td> <td class="ce">법률</td> <td class="ce">제 00205호</td> <td class="ce">1951.6.2</td> <td class="ce">1951.4.1</td> <td class="ce">연혁</td> </tr>`,
  `<tr> <td class="ce">25</td> <td><a href="/DRF/lawService.do?OC=test&amp;target=lsHistory&amp;MST=52908&amp;type=HTML&amp;mobileYn=&amp;efYd=19620101" >지방세법</a></td> <td class="ce">행정안전부</td> <td class="ce">폐지제정</td> <td class="ce">법률</td> <td class="ce">제 00827호</td> <td class="ce">1961.12.8</td> <td class="ce">1962.1.1</td> <td class="ce">연혁</td> </tr>`,
  `<tr> <td class="ce">27</td> <td><a href="/DRF/lawService.do?OC=test&amp;target=lsHistory&amp;MST=28290&amp;type=HTML&amp;mobileYn=&amp;efYd=19620101" >지방세법시행령</a></td> <td class="ce">행정안전부</td> <td class="ce">폐지제정</td> <td class="ce">각령</td> <td class="ce">제 00334호</td> <td class="ce">1961.12.30</td> <td class="ce">1962.1.1</td> <td class="ce">연혁</td> </tr>`,
]
const lsHistoryPage = (total: number) =>
  `<html><body><strong>${total}</strong> 건<table>${LSHISTORY_ROWS.join("\n")}</table></body></html>`

describe("searchHistoricalLaw: historical-utils 파서 공용 (B12)", () => {
  const historyClient = { fetchApi: async () => lsHistoryPage(3) } as unknown as LawApiClient

  it("'폐지제정'을 '폐지'로 줄이지 않는다", async () => {
    const t = (await searchHistoricalLaw(historyClient, { lawName: "지방세법", display: 50 })).content[0].text
    expect(t).toContain("시행: 1962.01.01 | 폐지제정")
    expect(t).not.toMatch(/\| 폐지\n/)
  })

  it("0패딩 없는 공포일(1951.6.2)을 읽는다 (종전: N/A)", async () => {
    const t = (await searchHistoricalLaw(historyClient, { lawName: "지방세법", display: 50 })).content[0].text
    expect(t).toContain("공포: 1951.06.02 (제00205호)")
    expect(t).toContain("공포: 1961.12.08 (제00827호)")
    expect(t).not.toContain("공포: N/A")
    expect(t).not.toContain("MST: 28290")          // 시행령 행은 본법 연혁에서 뺀다
  })

  it("display는 표시 버전 수 상한이며 전체 버전 수를 밝힌다", async () => {
    const t = (await searchHistoricalLaw(historyClient, { lawName: "지방세법", display: 1 })).content[0].text
    expect(t).toContain("조회된 1개 버전, 전체 2개 중 최근 1개 표시")
    expect(t).toContain("MST: 52908")                // 시행일 내림차순 첫 버전
  })
})
