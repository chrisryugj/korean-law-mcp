import { describe, it, expect } from "vitest"
import { getHistoricalLaw, searchHistoricalLaw } from "./historical-law.js"
import { UpstreamRecordMissingError } from "../lib/upstream-miss.js"
import { ExecutionLimitError } from "../lib/execution-limits.js"
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

// 감사 실측(MST 212383 + efYd=20200101): 그 MST 의 시행일이 아닌 efYd 면 eflaw 가 HTML 안내로 답한다.
// 종전엔 4회 재시도(3.7초) 뒤 "[EXTERNAL_API_ERROR] 파라미터를 확인해주세요" — v4.14.2 는 efYd 를 무시하고 MST 본문을 줬다.
describe("getHistoricalLaw — 시행일이 아닌 efYd", () => {
  const missClient = (calls: string[], eflaw: () => Promise<string>) => ({
    getLawText: async (p: { mst?: string, efYd?: string, efYdMayMiss?: boolean }) => {
      calls.push(`eflaw:${p.mst}:${p.efYd}:${p.efYdMayMiss}`)
      return eflaw()
    },
    fetchApi: async (p: { target: string, extraParams?: Record<string, string> }) => {
      calls.push(`${p.target}:${p.extraParams?.MST}:${p.extraParams?.efYd ?? ""}`)
      return HIST_JSON
    },
  }) as unknown as LawApiClient

  it("eflaw 미스는 확인 1회 장치로 끊고 target=law&MST 본문으로 물러서며 한 줄로 밝힌다", async () => {
    const calls: string[] = []
    const r = await getHistoricalLaw(missClient(calls, async () => { throw new UpstreamRecordMissingError("url", "html") }), { mst: "212383", efYd: "20200101" })
    const t = r.content[0].text
    expect(r.isError).toBeFalsy()
    expect(t).toContain("법령명: 상법")
    expect(t).toContain("efYd=20200101 기준 조회가 비어(MST 212383의 시행일이 아니면")
    expect(calls).toEqual(["eflaw:212383:20200101:true", "law:212383:"])
  })

  it("eflaw 가 법령 노드 없는 봉투로 와도 물러선다", async () => {
    const calls: string[] = []
    const t = (await getHistoricalLaw(missClient(calls, async () => "{}"), { mst: "212383", efYd: "2020-01-01" })).content[0].text
    expect(t).toContain("법령명: 상법")
    expect(calls).toEqual(["eflaw:212383:20200101:true", "law:212383:"])
  })

  it("시행일이 맞으면 그 슬라이스 본문 그대로 (안내 없음)", async () => {
    const calls: string[] = []
    const t = (await getHistoricalLaw(missClient(calls, async () => HIST_JSON), { mst: "273629", efYd: "20260910" })).content[0].text
    expect(t).toContain("법령명: 상법")
    expect(t).not.toContain("기준 조회가 비어")
    expect(calls).toEqual(["eflaw:273629:20260910:true"])
  })

  it("예산 소진은 물러서지 않는다", async () => {
    const calls: string[] = []
    const r = await getHistoricalLaw(missClient(calls, async () => { throw new ExecutionLimitError("budget") }), { mst: "212383", efYd: "20200101" })
    expect(r.isError).toBe(true)
    expect(calls).toEqual(["eflaw:212383:20200101:true"])
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

// 폐지 후 같은 이름으로 재제정돼 법령ID가 바뀐 법령(근로기준법 1997.3.13.). 계보(LID)는 신법만 줘서 연혁 목록이
// 1997년부터였다 — v4.14.2 는 이름 일치 연혁으로 1953년 제정본부터 보였다(2026-10-01 감사 실측 56 → 54).
describe("search_historical_law — 동명 구법 연혁", () => {
  const LSA = "근로기준법"
  const lrow = (mst: string, efYd: string, rr: string) =>
    `<law id="x"><법령일련번호>${mst}</법령일련번호><법령명한글><![CDATA[${LSA}]]></법령명한글><법령ID>001872</법령ID>` +
    `<공포일자>${efYd}</공포일자><공포번호>1</공포번호><제개정구분명>${rr}</제개정구분명><시행일자>${efYd}</시행일자></law>`
  const LINEAGE = `<LawSearch><totalCnt>2</totalCnt>${lrow("283457", "20260820", "타법개정")}${lrow("53681", "19970313", "제정")}</LawSearch>`
  const tr = (mst: string, efYd: string, rr: string, ancYd: string) =>
    `<tr><td class="ce">1</td><td><a href="/DRF/lawService.do?OC=x&amp;target=lsHistory&amp;MST=${mst}&amp;type=HTML&amp;mobileYn=&amp;efYd=${efYd}" >${LSA}</a></td>` +
    `<td class="ce">고용노동부</td><td class="ce">${rr}</td><td class="ce">법률</td><td class="ce">제 1호</td><td class="ce">${ancYd}</td><td class="ce">${efYd}</td><td class="ce">연혁</td></tr>`
  const HISTORY = `<html><strong>3</strong> 건<table>` +
    tr("4974", "19970313", "폐지", "1997.3.13") + tr("4972", "19900714", "타법개정", "1990.1.13") + tr("4963", "19530809", "제정", "1953.5.10") +
    `</table></html>`
  const api = {
    searchLaw: async () => `<LawSearch><totalCnt>1</totalCnt><law id="1"><법령일련번호>283457</법령일련번호><법령명한글><![CDATA[${LSA}]]></법령명한글><법령ID>001872</법령ID></law></LawSearch>`,
    fetchApi: async (p: { target: string }) => (p.target === "lsHistory" ? HISTORY : LINEAGE),
  } as unknown as LawApiClient

  it("신법 제정 이전의 동명 구법 버전까지 싣고, 구법임을 구분해 밝힌다", async () => {
    const text = (await searchHistoricalLaw(api, { lawName: LSA, display: 100 })).content[0].text
    expect(text).toContain("MST: 4972")
    expect(text).toContain("MST: 4963")
    expect(text).toContain("동명 구법")
    expect(text.indexOf("MST: 53681")).toBeLessThan(text.indexOf("MST: 4972"))
  })
})
