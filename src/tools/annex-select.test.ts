import { describe, expect, it } from "vitest"
import { annexQueryKeywords, buildSelectorCandidates, extractParentLawName, extractSelectorNumbers, filterByAnnexQuery, findMatchingAnnex, type AnnexItem } from "./annex-select.js"
import { parseLawNameAndHint } from "../lib/annex-notation.js"

// 도로교통법 시행규칙 별표 목록 실측 발췌 (총 263건 중)
const LIST: AnnexItem[] = [
  { 별표번호: "012800", 별표명: "(강사, 기능검정원)자격증 기재사항 변경 신청서", 별표종류: "서식" },
  { 별표번호: "002800", 별표명: "운전면허 취소·정지처분 기준", 별표종류: "별표" },
  { 별표번호: "002600", 별표명: "운전면허 결격기간", 별표종류: "별표" },
  { 별표번호: "000600", 별표명: "과태료 부과기준", 별표종류: "별표" },
]

describe("annexQueryKeywords (#94)", () => {
  it("번호 힌트는 키워드에서 뺀다 (selector가 따로 쓴다)", () => {
    expect(annexQueryKeywords("별표28 운전면허")).toEqual(["운전면허"])
  })

  it("가운뎃점으로 이어진 표기도 토큰으로 나눈다", () => {
    expect(annexQueryKeywords("운전면허 취소·정지")).toEqual(["운전면허", "취소", "정지"])
  })

  it("query가 없으면 빈 배열", () => {
    expect(annexQueryKeywords(undefined)).toEqual([])
  })
})

describe("filterByAnnexQuery (#94)", () => {
  it("서로 다른 query는 서로 다른 결과로 좁혀진다", () => {
    const a = filterByAnnexQuery(LIST, "운전면허 취소")
    const b = filterByAnnexQuery(LIST, "과태료")
    expect(a.list.map((x) => x.별표번호)).toEqual(["002800"])
    expect(b.list.map((x) => x.별표번호)).toEqual(["000600"])
    expect(a.list).not.toEqual(b.list)
  })

  it("키워드를 모두 만족해야 한다 (AND)", () => {
    // '운전면허' 하나만으로는 2건이지만 '취소'까지 걸면 1건
    expect(filterByAnnexQuery(LIST, "운전면허").list).toHaveLength(2)
    expect(filterByAnnexQuery(LIST, "운전면허 취소").list).toHaveLength(1)
  })

  it("일치 0건이면 전체를 돌려주되 matched=false로 알린다", () => {
    const r = filterByAnnexQuery(LIST, "존재하지않는키워드")
    expect(r.matched).toBe(false)
    expect(r.list).toHaveLength(LIST.length)
  })

  it("query 미지정이면 목록을 건드리지 않는다", () => {
    const r = filterByAnnexQuery(LIST, undefined)
    expect(r.list).toBe(LIST)
    expect(r.matched).toBe(true)
  })
})

describe("query의 번호 힌트 (#94)", () => {
  it("'별표28'에서 선택값 28을 뽑는다", () => {
    expect(parseLawNameAndHint("별표28").annexNo).toBe("28")
  })

  it("'별표 1의2'는 6자리 코드로 변환한다", () => {
    expect(parseLawNameAndHint("별표 1의2").annexNo).toBe("000102")
  })
})

// ─── 별표번호 6자리 코드 체계 (실측 확정) ──────────────────
//
// 2026-08-17 도로교통법 시행규칙 licbyl 실호출(totalCnt=264)의 실번호 목록으로 확정:
//   [002800] 별표 운전면허 취소·정지처분 기준(제91조제1항관련)   → 별표 28
//   [012800] 서식 (강사, 기능검정원)자격증 기재사항 변경 신청서  → 별지 제128호
//   [002003] [002004] [002005] 서식 어린이통학버스 안전교육 …    → 별지 제20호의3·의4·의5
//   [001708]~[001712] 서식 음주운전 방지장치 …                   → 별지 제17호의8 ~ 의12
// 즉 AAAABB = 번호 4자리 zero-pad + 가지번호(의N) 2자리. JO 코드와 같은 체계다.
describe("buildSelectorCandidates 별표번호 코드 체계", () => {
  it.each([
    ["28", "002800"],
    ["128", "012800"],
    ["20", "002000"],
  ])("본번 %s → 6자리 코드 %s", (selector, code) => {
    expect(buildSelectorCandidates(selector)).toContain(code)
  })

  it.each(["1의2", "별표 1의2", "제1호의2", "별표 제1호의2"])(
    "가지번호 표기 %s 는 000102 로 간다",
    (selector) => { expect(buildSelectorCandidates(selector)).toContain("000102") }
  )

  it("가지번호를 삼키고 본번 별표를 고르지 않는다", () => {
    // 회귀: "1의2" 가 {1, 000001, 000100} 으로 풀려 **별표 1** 이 조용히 선택됐다.
    // NOT_FOUND 보다 나쁜 실패다 — 다른 규범을 정답인 양 돌려준다.
    const c = buildSelectorCandidates("1의2")
    expect(c).not.toContain("000100")
    expect(c).not.toContain("000001")
    expect(extractSelectorNumbers("1의2")).not.toContain("1")
  })

  it("lawName 경로(parseLawNameAndHint)와 같은 코드로 수렴한다", () => {
    for (const [inline, bare] of [["별표 1의2", "1의2"], ["별표 28의3", "28의3"]]) {
      const fromLawName = parseLawNameAndHint(`도로교통법 시행규칙 ${inline}`).annexNo as string
      expect([inline, buildSelectorCandidates(bare).has(fromLawName)]).toEqual([inline, true])
    }
  })

  it("목록에 있기만 하면 본번 선택값이 실제 별표를 집는다", () => {
    // 실호출의 [NOT_FOUND]는 후보 생성이 아니라 목록 페이징(#148, display=100 · totalCnt=264)
    // 때문이다 — 002800은 2페이지에 있어 annexList에 애초에 담기지 않는다.
    expect(findMatchingAnnex(LIST, "28")?.별표번호).toBe("002800")
  })

  it("이미 6자리 코드면 그대로 쓴다 (bylSeq 경로)", () => {
    expect(buildSelectorCandidates("002800")).toContain("002800")
    expect(buildSelectorCandidates("000102")).toContain("000102")
  })

  it("가지번호 요청에 본번 별표가 잡히지 않는다", () => {
    const list: AnnexItem[] = [
      { 별표번호: "000100", 별표명: "별표 1 본번", 별표종류: "별표" },
      { 별표번호: "000102", 별표명: "별표 1의2 가지", 별표종류: "별표" },
    ]
    expect(findMatchingAnnex(list, "1의2")?.별표번호).toBe("000102")
    expect(findMatchingAnnex(list, "1")?.별표번호).toBe("000100")
  })

  // #150-3: 6자리 입력은 이미 정본 코드다. 자연어 번호로 다시 읽으면 "000102"
  // (별표 1의2)가 parseInt를 거쳐 "102" 후보를 만들어 무관한 별표 102를 집는다 —
  // 가지번호 요청에 본번 후보를 금지한 파일 상단 원칙이 코드 입력에서만 뚫린다.
  it("6자리 가지 코드는 해독해 정본 후보만 만든다 — '000102'가 '102'를 내지 않는다", () => {
    const c = buildSelectorCandidates("000102")
    expect(c).toContain("000102")
    expect(c.has("102")).toBe(false)
  })

  it("6자리 본번 코드는 본번으로 해독된다 — '002800'은 28이지 2800이 아니다", () => {
    const c = buildSelectorCandidates("002800")
    expect(c).toContain("002800")
    expect(c).toContain("28")
    expect(c.has("2800")).toBe(false)
  })
})

// #150-4: 법제처 제목은 가지번호에 호를 중위로 끼운다 — "[별지 제59호의2서식]".
// selector의 "59의2"를 리터럴로 찾으면 이 표기를 통째로 놓쳐 NOT_FOUND로 샌다.
describe("제목 매칭 — '제N호의M'(호 중위) 표기 (#150)", () => {
  const FORMS: AnnexItem[] = [
    { 별표번호: "", 별표명: "[별지 제59호서식] 원본", 별표종류: "서식" },
    { 별표번호: "", 별표명: "[별지 제59호의2서식] 가지", 별표종류: "서식" },
  ]

  it("'별지 제59호의2' selector가 호 중위 제목과 매칭된다", () => {
    expect(findMatchingAnnex(FORMS, "별지 제59호의2", "2")?.별표명).toContain("59호의2")
  })

  it("맨 번호 표기 '59의2'도 같은 제목에 도달한다", () => {
    expect(findMatchingAnnex(FORMS, "59의2", "2")?.별표명).toContain("59호의2")
  })

  it("본번 selector가 여전히 본번 제목을 고른다 (회귀)", () => {
    // 패턴 확장이 본번 요청을 가지 제목으로 흘려보내면 안 된다
    expect(findMatchingAnnex([FORMS[0]], "59", "2")?.별표명).toContain("제59호서식")
  })
})

// 2026-09-23 리뷰 C2: ANNEX_NOTATION_RE 의 선두 `\s*` 와 extractParentLawName 의 `\s*(시행규칙|시행령)$` 는
// 공백 덩어리에서 제곱이었다(10만 자 기준 각각 6.3초·13.4초). get_annexes 의 query·lawName 은 길이 제한이 없다.
describe("annexQueryKeywords·extractParentLawName: 공백 덩어리 (리뷰 C2)", () => {
  it("공백 10만 자 query 도 즉시 토큰화한다", () => {
    const t0 = performance.now()
    const kw = annexQueryKeywords("과태료" + " ".repeat(100_000) + "부과기준")
    expect(performance.now() - t0).toBeLessThan(200)
    expect(kw).toEqual(["과태료", "부과기준"])
  })

  it("공백이 여럿인 정상 query 는 종전과 같다", () => {
    expect(annexQueryKeywords("과태료  부과   기준")).toEqual(["과태료", "부과", "기준"])
    expect(annexQueryKeywords("  서식  제3호  신청서 ")).toEqual(["신청서"])
    expect(annexQueryKeywords("별지 제3호서식 신청서")).toEqual(["신청서"])
  })

  it("extractParentLawName: 공백 10만 자에서도 즉시 판정한다", () => {
    const t0 = performance.now()
    expect(extractParentLawName("관세법" + " ".repeat(100_000) + "가")).toBeNull()
    expect(extractParentLawName("관세법" + " ".repeat(100_000) + "시행령")).toBe("관세법")
    expect(performance.now() - t0).toBeLessThan(200)
  })

  it("extractParentLawName: 정상 입력은 종전과 같다", () => {
    expect(extractParentLawName("여권법 시행규칙")).toBe("여권법")
    expect(extractParentLawName("관세법 시행령")).toBe("관세법")
    expect(extractParentLawName("여권법   시행령")).toBe("여권법")
    expect(extractParentLawName("여권법\n시행규칙")).toBe("여권법")
    expect(extractParentLawName("시행령시행규칙")).toBe("시행령")
    expect(extractParentLawName("관세법")).toBeNull()
    expect(extractParentLawName("여권법 시행규칙 ")).toBeNull()
    expect(extractParentLawName("지방공무원 임용령")).toBeNull()
  })
})
