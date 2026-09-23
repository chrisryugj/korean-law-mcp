import { describe, it, expect } from "vitest"
import { parseArticleAnchor, classifyArticleRefs, classifyLawName } from "./article-anchor.js"

describe("parseArticleAnchor — jo 입력 정규화 (#98)", () => {
  it("자연어 표기를 받는다", () => {
    expect(parseArticleAnchor("제103조")).toMatchObject({ code: "010300", display: "제103조" })
    expect(parseArticleAnchor("103조")).toMatchObject({ code: "010300", display: "제103조" })
    expect(parseArticleAnchor("제10조의2")).toMatchObject({ code: "001002", display: "제10조의2" })
  })

  it("6자리 JO 코드를 받는다 — get_law_text와 같은 계약", () => {
    expect(parseArticleAnchor("010300")).toMatchObject({ code: "010300", display: "제103조" })
    expect(parseArticleAnchor("001002")).toMatchObject({ code: "001002", display: "제10조의2" })
  })

  it("해석 불가 입력은 null", () => {
    expect(parseArticleAnchor("")).toBeNull()
    expect(parseArticleAnchor("조문")).toBeNull()
    expect(parseArticleAnchor("어딘가")).toBeNull()
  })

  // 적대적 리뷰 지적: buildJO는 조번호를 4자리로 pad할 뿐 상한이 없어 "10300"이
  // 7자리 코드가 된다. 통과시키면 헤더·검색어·JO가 전부 깨진 채 0건이 사실로 보고된다.
  it("6자리로 떨어지지 않는 숫자 입력은 거부한다 (#98 잔여)", () => {
    expect(parseArticleAnchor("10300")).toBeNull()
    expect(parseArticleAnchor("0010300")).toBeNull()
    expect(parseArticleAnchor("000000")).toBeNull()
  })
})

describe("classifyArticleRefs — 조번호 경계 앵커 (#90)", () => {
  const a103 = parseArticleAnchor("제103조")!
  const a10_2 = parseArticleAnchor("제10조의2")!

  it("제103조 질의에 제1032조·제1030조는 불일치", () => {
    expect(classifyArticleRefs("민법 제1032조 위헌소원", a103)).toBe("mismatch")
    expect(classifyArticleRefs("민법 제1030조 위헌확인", a103)).toBe("mismatch")
    expect(classifyArticleRefs("민법 제103조 위헌소원", a103)).toBe("match")
  })

  it("의X 가지번호를 구분한다", () => {
    expect(classifyArticleRefs("상법 제10조의2 관련", a10_2)).toBe("match")
    expect(classifyArticleRefs("상법 제10조 관련", a10_2)).toBe("mismatch")
    expect(classifyArticleRefs("상법 제10조의2 관련", a103)).toBe("mismatch")
    expect(classifyArticleRefs("민법 제103조의2", a103)).toBe("mismatch")
  })

  it("조문 표기가 없으면 판정 보류(silent) — 사건명만 있는 항목을 죽이지 않는다", () => {
    expect(classifyArticleRefs("손해배상(기)", a103)).toBe("silent")
    expect(classifyArticleRefs("동해시 시민법률상담 운영 조례", a103)).toBe("silent")
  })

  it("낫표·공백·한자 표기 변형에서도 정방향 매칭이 산다 (v4.9.0 표기 내성)", () => {
    expect(classifyArticleRefs("「민법」 제103조 위헌소원", a103)).toBe("match")
    expect(classifyArticleRefs("민법 제 103 조", a103)).toBe("match")
    expect(classifyArticleRefs("민법　제103조", a103)).toBe("match")  // 전각 공백
    expect(classifyArticleRefs("民法 第103條", a103)).toBe("match")
    expect(classifyArticleRefs("민법 제10조의2·제103조 관련", a103)).toBe("match")
  })

  it("항·호 표기는 조번호 경계를 흐리지 않는다", () => {
    expect(classifyArticleRefs("민법 제103조 제1항 제2호", a103)).toBe("match")
    expect(classifyArticleRefs("민법 제1032조 제1항", a103)).toBe("mismatch")
  })

  // 적대적 리뷰 지적 — 정당한 자료가 죽던 두 경계
  it("범위 표기 안에 드는 조문은 살린다", () => {
    const a104 = parseArticleAnchor("제104조")!
    expect(classifyArticleRefs("「민법」 제103조부터 제105조까지 관련", a104)).toBe("match")
    expect(classifyArticleRefs("민법 제103조~제105조", a104)).toBe("match")
    expect(classifyArticleRefs("「민법」 제103조부터 제105조까지 관련", parseArticleAnchor("제200조")!))
      .toBe("mismatch")
  })

  it("가지번호 하이픈 표기를 앵커가 스스로 알아본다", () => {
    const a10_2 = parseArticleAnchor("제10조-2")!
    expect(a10_2.code).toBe("001002")
    expect(classifyArticleRefs("상법 제10조-2 관련", a10_2)).toBe("match")
    expect(classifyArticleRefs("상법 제10조의2 관련", a10_2)).toBe("match")
  })
})

describe("classifyLawName — 법령명 축 (#116)", () => {
  it("정규화·약칭으로 같은 법령이면 same", () => {
    expect(classifyLawName("형법", "형법")).toBe("same")
    expect(classifyLawName("민법", " 민법 ")).toBe("same")
  })

  it("대상보다 길거나 같은 이름은 약칭일 수 없으므로 different", () => {
    expect(classifyLawName("군형법", "형법")).toBe("different")   // #116 판정 기준
    expect(classifyLawName("상법", "민법")).toBe("different")
    expect(classifyLawName("민사집행법", "민법")).toBe("different")
  })

  it("하위법령 여부가 다르면 different — 같은 조번호라도 다른 규범이다", () => {
    expect(classifyLawName("민법시행령", "민법")).toBe("different")
    expect(classifyLawName("시행령", "국토의 계획 및 이용에 관한 법률")).toBe("different")
  })

  it("짧고 축약 가능한 표기는 different가 되지 않는다 — 등록되면 확정으로 승격", () => {
    // 통합 전 '도교법'은 미등록이라 unknown(보류)이었다. #107이 별칭을 등재한 뒤로는
    // same(확정)으로 승격된다 — 보류→확정 방향만 존재하고 제외로 바뀌는 경로는 없다(#116 시너지 고정).
    expect(classifyLawName("도교법", "도로교통법")).toBe("same")
    expect(classifyLawName("국토계획법", "국토의 계획 및 이용에 관한 법률")).not.toBe("different")
  })

  it("짧아도 축약으로 볼 수 없으면 different", () => {
    expect(classifyLawName("민법", "도로교통법")).toBe("different")
  })

  // 보류 정책 증명: 정규화가 **실패하는** 표기를 일부러 넣어도 different가 되지 않아야 한다.
  // (different가 되면 impact_map이 정탐을 제외한다 = #116 해결이 아니라 새 결함)
  it("사전에 없는 약칭은 전부 unknown으로 남는다 — 제외하지 않는다", () => {
    const target = "식품 등의 표시·광고에 관한 법률"
    for (const variant of ["식품표시법", "식표법"]) {
      expect(classifyLawName(variant, target)).toBe("unknown")
    }
  })

  // 반대 증명 ①: 보류가 "아무 판단도 안 함"이 아니다 — 사전에 있으면 해소해 확정한다.
  it("등록된 약칭은 풀어서 확정한다", () => {
    expect(classifyLawName("정보통신망법", "정보통신망 이용촉진 및 정보보호 등에 관한 법률")).toBe("same")
    // 등록 약칭이 실제로 다른 법령을 가리키면 확정적으로 다르다
    expect(classifyLawName("표시광고법", "식품 등의 표시·광고에 관한 법률")).toBe("different")
  })

  // 반대 증명 ②: 가운뎃점 5종·공백 변형은 같은 법령으로 접힌다.
  // (normalizeAliasKey는 `·•`만 지운다 — 나머지 3종을 안 접으면 글자 수가 같아
  //  '확정적으로 다름'이 되어 정탐이 제거된다. #75와 같은 함정.)
  it("공백·가운뎃점 변형은 보류가 아니라 same으로 확정된다", () => {
    const target = "식품 등의 표시·광고에 관한 법률"
    expect(classifyLawName("식품등의표시·광고에관한법률", target)).toBe("same")
    for (const dot of ["ㆍ", "‧", "•", "・"]) {
      expect(classifyLawName(`식품 등의 표시${dot}광고에 관한 법률`, target)).toBe("same")
    }
  })
})

describe("classifyArticleRefs — 법령명 축 결합 (#116)", () => {
  const a1 = parseArticleAnchor("제1조", "형법")!

  // #150: 제외 사유를 축별로 보고하기 위해 "조번호 불일치(mismatch)"와
  // "조번호 일치·타법 확정(law-mismatch)"을 구분한다 — 둘 다 제외 대상인 것은 그대로다.
  it("다른 법령의 같은 조번호는 제외한다 (형법 제1조 → 군형법 제1조)", () => {
    expect(classifyArticleRefs("군형법 제1조 제3항 제3호 등 위헌소원", a1)).toBe("law-mismatch")
  })

  it("같은 법령은 확정 매칭", () => {
    expect(classifyArticleRefs("형법 제1조 위헌소원", a1)).toBe("match")
    expect(classifyArticleRefs("「형법」 제1조 위헌소원", a1)).toBe("match")
    expect(classifyArticleRefs("구 형법 제1조 위헌소원", a1)).toBe("match")
  })

  it("법령명을 못 읽으면 제외가 아니라 보류(hold) — 유지된다", () => {
    expect(classifyArticleRefs("제1조 위헌소원", a1)).toBe("hold")
    expect(classifyArticleRefs("위헌소원 제1조", a1)).toBe("hold")
  })

  it("미등록 약칭 표기는 보류 — false drop을 만들지 않는다", () => {
    const aFood = parseArticleAnchor("제4조", "식품 등의 표시·광고에 관한 법률")!
    expect(classifyArticleRefs("식표법 제4조 위반", aFood)).toBe("hold")
  })

  it("등록 약칭은 보류 없이 확정 매칭한다 (#107 등재 후 승격)", () => {
    const a44 = parseArticleAnchor("제44조", "도로교통법")!
    expect(classifyArticleRefs("도교법 제44조 위반", a44)).toBe("match")
  })

  it("법령명을 주지 않으면 종전대로 조번호만 본다 (법령 축 미적용)", () => {
    const noName = parseArticleAnchor("제1조")!
    expect(classifyArticleRefs("군형법 제1조 위헌소원", noName)).toBe("match")
  })
})

describe("classifyArticleRefs — 구 법령 접두 보류 (#150)", () => {
  const aJangsa = parseArticleAnchor("제5조", "장사 등에 관한 법률")!

  // 위헌심판은 행위시법 심사라 "구 OO법 제N조 위헌소원" 사건명이 흔하다. 제명변경 전신
  // (매장및묘지등에관한법률 → 장사 등에 관한 법률)은 문자열만으로 알 수 없으므로,
  // "구 " 신호가 있으면 확정 제외(different)를 보류로 완화한다 — false drop이 최악이다.
  it("'구 ' 접두 인용의 타법 판정은 제외가 아니라 보류다", () => {
    expect(classifyArticleRefs("구 매장및묘지등에관한법률 제5조 위헌소원", aJangsa)).toBe("hold")
  })

  it("낫표·한자 舊 표기도 같은 보류를 받는다", () => {
    expect(classifyArticleRefs("구 「매장및묘지등에관한법률」 제5조 위헌소원", aJangsa)).toBe("hold")
    expect(classifyArticleRefs("舊 매장및묘지등에관한법률 제5조 위헌소원", aJangsa)).toBe("hold")
  })

  // #116의 경계는 그대로다 — 접두 없는 진짜 타법은 계속 확정 제외.
  it("접두 없는 타법은 계속 제외된다", () => {
    expect(classifyArticleRefs("매장및묘지등에관한법률 제5조 위헌소원", aJangsa)).toBe("law-mismatch")
  })

  // '구'로 끝나는 보통 어절(행정구역 등)은 구 법령 신호가 아니다.
  it("어절 끝의 '구'는 구 법령 신호로 읽지 않는다", () => {
    const a5 = parseArticleAnchor("제5조", "형법")!
    expect(classifyArticleRefs("동대문구 조례 제5조", a5)).toBe("law-mismatch")
  })

  // 보류는 법령 축에만 적용된다 — 조번호가 다르면 구법령이라도 살릴 이유가 없다.
  it("'구 ' 접두라도 조번호 불일치는 제외", () => {
    expect(classifyArticleRefs("구 매장및묘지등에관한법률 제17조 위헌소원", aJangsa)).toBe("mismatch")
  })
})

// 2026-09-23 리뷰 C7: ARTICLE_REF_RE 의 `\s*[」』】〕]?\s*` 는 공백 덩어리에서 세제곱이었다
// (인용 앞 공백 800자 228ms, 1,600자 1.35초). 자치법규 본문 전체(원시 JSON)에 적용되므로
// 업스트림 한 건에 긴 공백이 섞이면 그대로 멈춘다. 판정 입구에서 공백을 접는다.
describe("classifyArticleRefs: 공백 덩어리 (리뷰 C7)", () => {
  const anchor = parseArticleAnchor("제12조", "주차장법")!

  it("인용 앞 공백 10만 자에서도 즉시 판정한다", () => {
    const t0 = performance.now()
    expect(classifyArticleRefs("이 조례는" + " ".repeat(100_000) + "「주차장법」제12조에 따라", anchor)).toBe("match")
    expect(classifyArticleRefs("가" + " ".repeat(100_000) + "가", anchor)).toBe("silent")
    expect(performance.now() - t0).toBeLessThan(200)
  })

  it("공백 길이는 판정에 영향이 없다 (종전과 같다)", () => {
    const a103 = parseArticleAnchor("제103조", "민법")!
    const a103NoLaw = parseArticleAnchor("제103조")!
    const CASES: Array<[string, string, string]> = [
      ["민법 제103조 위반", "match", "match"],
      ["「민법」   제103조", "match", "match"],
      ["민법 제1032조 위헌소원", "mismatch", "mismatch"],
      ["형법  제103조", "law-mismatch", "match"],
      ["구   민법 제103조", "match", "match"],
      ["제100조부터\n\n제105조까지", "match", "match"],
      ["손해배상(기)", "silent", "silent"],
      ["민법  제 103 조", "match", "match"],
    ]
    for (const [text, withLaw, withoutLaw] of CASES) {
      expect([classifyArticleRefs(text, a103), classifyArticleRefs(text, a103NoLaw)]).toEqual([withLaw, withoutLaw])
    }
  })

  it("classifyLawName: 대상 법령명의 공백 덩어리도 즉시 끝난다", () => {
    const t0 = performance.now()
    expect(classifyLawName("민법", "민" + " ".repeat(100_000) + "법")).toBe("same")
    expect(performance.now() - t0).toBeLessThan(200)
  })
})
