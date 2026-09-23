import { describe, expect, it } from "vitest"
import { fromAnnexCode, parseLawNameAndHint, toAnnexCode } from "./annex-notation.js"
import { annexQueryKeywords, extractSelectorNumbers, findMatchingAnnex } from "../tools/annex-select.js"

// 단일 원본이 자기 호출자보다 좁으면 원본 노릇을 못 한다(N1). 라우팅 트리거는
// 별표·서식·양식·별지 넷을 인정하는데 이 모듈이 둘만 알아 `별지 제3호`가
// annexNo 대신 법령명/query 로 샜다.
describe("parseLawNameAndHint — 접두 어휘 4종", () => {
  it("별지 표기의 번호를 떼어낸다", () => {
    expect(parseLawNameAndHint("출입국관리법 시행규칙 별지 제3호")).toEqual({
      normalizedLawName: "출입국관리법 시행규칙",
      annexNo: "3",
    })
  })

  it("양식 표기도 인정한다", () => {
    expect(parseLawNameAndHint("관세법 시행규칙 양식 5")).toEqual({
      normalizedLawName: "관세법 시행규칙",
      annexNo: "5",
    })
  })

  it("별지 제20호의3 → 002003 (실호출 확정 코드)", () => {
    expect(parseLawNameAndHint("여권법 시행규칙 별지 제20호의3").annexNo).toBe("002003")
  })

  it("별지 제17호의12 → 001712", () => {
    expect(parseLawNameAndHint("여권법 시행규칙 별지 제17호의12").annexNo).toBe("001712")
  })

  it("꼬리의 '서식'까지 먹어 법령명에 남기지 않는다", () => {
    expect(parseLawNameAndHint("여권법 시행규칙 별지 제3호서식")).toEqual({
      normalizedLawName: "여권법 시행규칙",
      annexNo: "3",
    })
  })

  it("기존 별표 표기는 그대로 동작한다 (회귀)", () => {
    expect(parseLawNameAndHint("도로교통법 시행규칙 별표 제28호")).toEqual({
      normalizedLawName: "도로교통법 시행규칙",
      annexNo: "28",
    })
    expect(parseLawNameAndHint("관세법 별표 1의2").annexNo).toBe("000102")
  })
})

// encode를 세운 커밋이 decode를 남겨 뒀다(N7) — 응답이 알려 준 6자리 코드를
// 사용자가 되돌려주는 왕복이 끊겨 있었다.
describe("fromAnnexCode — toAnnexCode의 짝 연산", () => {
  it("6자리 코드를 번호부로 되돌린다", () => {
    expect(fromAnnexCode("002003")).toEqual({ main: 20, sub: 3 })
    expect(fromAnnexCode("001712")).toEqual({ main: 17, sub: 12 })
    expect(fromAnnexCode("002800")).toEqual({ main: 28, sub: 0 })
  })

  it("왕복이 닫힌다", () => {
    for (const [main, sub] of [[20, 3], [17, 12], [28, 0], [1, 2]] as const) {
      expect(fromAnnexCode(toAnnexCode(main, sub))).toEqual({ main, sub })
    }
  })

  it("코드가 아닌 입력은 undefined", () => {
    expect(fromAnnexCode("28")).toBeUndefined()
    expect(fromAnnexCode("별표28")).toBeUndefined()
    expect(fromAnnexCode("000000")).toBeUndefined()
  })
})

describe("extractSelectorNumbers — 6자리 코드를 가지번호로 읽는다", () => {
  it("BB≠00 이면 'N의M' 으로 낸다", () => {
    expect(extractSelectorNumbers("001712")).toEqual(["17의12"])
    expect(extractSelectorNumbers("000102")).toEqual(["1의2"])
  })

  it("BB=00 은 기존대로 (회귀)", () => {
    expect(extractSelectorNumbers("002800")).toContain("28")
  })

  it("자연어 표기는 그대로 (회귀)", () => {
    expect(extractSelectorNumbers("17의12")).toEqual(["17의12"])
    expect(extractSelectorNumbers("별표4")).toContain("4")
  })
})

describe("annexQueryKeywords — 표기 사본 제거 (N1 네 번째 사본)", () => {
  it("네 어휘 모두 검색어에서 지운다", () => {
    expect(annexQueryKeywords("별지 제3호 여권발급신청서")).toEqual(["여권발급신청서"])
    expect(annexQueryKeywords("양식 5 과태료 부과기준")).toEqual(["과태료", "부과기준"])
    expect(annexQueryKeywords("별표28 운전면허 취소")).toEqual(["운전면허", "취소"])
  })
})

// 제목 매칭도 같은 어휘를 봐야 한다 — annex-select 가 대표 사례로 드는
// `[별지 제4호서식]`이 정작 제 번호에 안 걸리고 있었다 (부록 자체 점검에서 발견).
describe("findMatchingAnnex — 별지 제목도 번호로 잡힌다", () => {
  const list = [
    { 별표명: "[별표4] 대지안의 공지기준", 별표종류: "별표" },
    { 별표명: "[별지 제4호서식] 공개공지 관리대장", 별표종류: "서식" },
  ]

  it("서식 의도면 별지 제목이 선택된다", () => {
    expect(findMatchingAnnex(list, "4", "2")?.별표명).toContain("별지 제4호서식")
  })

  it("별표 의도면 별표 제목이 선택된다 (회귀)", () => {
    expect(findMatchingAnnex(list, "4", "1")?.별표명).toContain("[별표4]")
  })
})

// 2026-09-23 리뷰 C2: ANNEX_HINT_RE 의 `\s*` 들이 공백 덩어리에서 제곱으로 백트래킹했다
// ("관세법 별표" + 공백 10만 자 → 23.6초). get_annexes 는 이 파싱을 fetch 전에 하므로
// 요청 한 건이 업스트림 호출 없이 이벤트 루프를 멈췄다.
describe("parseLawNameAndHint: 공백 덩어리 입력 (리뷰 C2)", () => {
  it("별표 뒤 공백 10만 자에서도 즉시 번호를 뗀다", () => {
    const t0 = performance.now()
    const r = parseLawNameAndHint("관세법 별표" + " ".repeat(100_000) + "4")
    expect(performance.now() - t0).toBeLessThan(200)
    expect(r).toEqual({ normalizedLawName: "관세법", annexNo: "4" })
  })

  it("힌트가 없으면 공백 덩어리도 즉시 끝나고 원문(trim)을 그대로 돌려준다", () => {
    const input = "관세법" + " ".repeat(100_000) + "가"
    const t0 = performance.now()
    const r = parseLawNameAndHint(input)
    expect(performance.now() - t0).toBeLessThan(200)
    expect(r).toEqual({ normalizedLawName: input })
  })

  it("공백이 섞인 정상 표기는 종전과 같다", () => {
    expect(parseLawNameAndHint("관세법  시행령   별표  제4호")).toEqual({ normalizedLawName: "관세법 시행령", annexNo: "4" })
    expect(parseLawNameAndHint("도로교통법\n시행규칙\t별표 28")).toEqual({ normalizedLawName: "도로교통법 시행규칙", annexNo: "28" })
    expect(parseLawNameAndHint("  관세법   시행령  ")).toEqual({ normalizedLawName: "관세법   시행령" })
    expect(parseLawNameAndHint("별표 4")).toEqual({ normalizedLawName: "별표 4", annexNo: "4" })
    expect(parseLawNameAndHint("관세법 [별표 1의2]")).toEqual({ normalizedLawName: "관세법", annexNo: "000102" })
    expect(parseLawNameAndHint("별표28 운전면허")).toEqual({ normalizedLawName: "운전면허", annexNo: "28" })
  })
})
