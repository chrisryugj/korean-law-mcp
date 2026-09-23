/**
 * risk-rules 정규식 백트래킹 회귀 (2026-09-23 리뷰 C1)
 *
 * analyze_document·legal_research(document_review)의 text 는 길이 제한 없는 사용자 입력이다.
 * 라벨 뒤 `[^0-9]*` 와 금액 캡처 `[0-9,]+` 가 쉼표에서 겹쳐 제곱으로 백트래킹했고
 * ("계약금액" + 쉼표 10만 자 → 13.5초), 충돌 규칙의 `.*\d+` 는 숫자 10만 자에서 24.4초였다.
 * 업스트림 호출 없이 이벤트 루프를 멈추므로 요청 한 건으로 서버 전체가 선다.
 */
import { describe, it, expect } from "vitest"
import { extractAmounts, extractPeriods, detectConflictsInText, detectConflicts, extractClauses } from "./risk-rules.js"

// 기대치는 수 ms 다. CI 부하를 감안해 넉넉히 잡는다
const LIMIT_MS = 200
function elapsed(fn: () => unknown): number {
  const t0 = performance.now()
  fn()
  return performance.now() - t0
}

describe("C1: 비정상 입력 10만 자도 선형 시간", () => {
  it("금액 라벨 뒤 쉼표 덩어리", () => {
    expect(elapsed(() => extractAmounts("계약금액" + ",".repeat(100_000)))).toBeLessThan(LIMIT_MS)
  })

  it("금액 라벨 반복 (숫자 없음)", () => {
    expect(elapsed(() => extractAmounts("계약금액".repeat(25_000)))).toBeLessThan(LIMIT_MS)
  })

  it("여러 금액 라벨 교차 반복", () => {
    const unit = "계약금액보증금위약금손해배상투자금로열티공사대금기성금"
    expect(elapsed(() => extractAmounts(unit.repeat(Math.ceil(100_000 / unit.length))))).toBeLessThan(LIMIT_MS)
  })

  it("기간 라벨 반복", () => {
    expect(elapsed(() => extractPeriods("해지통보".repeat(25_000)))).toBeLessThan(LIMIT_MS)
  })

  it("충돌 규칙: 해지통보 뒤 숫자 덩어리", () => {
    expect(elapsed(() => detectConflictsInText("해지통보" + "1".repeat(100_000)))).toBeLessThan(LIMIT_MS)
  })

  it("충돌 규칙: 해지통보 뒤 공백·줄바꿈 덩어리", () => {
    expect(elapsed(() => detectConflictsInText("해지통보" + " ".repeat(50_000) + "\n".repeat(50_000) + "끝"))).toBeLessThan(LIMIT_MS)
  })

  it("충돌 규칙: 라벨 교차 반복", () => {
    const unit = "일체책임손해배상제3자해지통보계약기간"
    expect(elapsed(() => detectConflictsInText(unit.repeat(Math.ceil(100_000 / unit.length))))).toBeLessThan(LIMIT_MS)
  })
})

// 리뷰 전 구현으로 뽑은 기준값 (2026-09-23). 간격을 묶은 뒤에도 정상 문서 결과는 같아야 한다.
const LEASE = [
  "제1조(목적) 이 계약은 임대인 갑과 임차인 을 사이의 주택 임대차에 관한 사항을 정한다.",
  "제2조(보증금) 보증금은 금 50,000,000원으로 하며 계약 시 계약금 5,000,000원을 지급한다.",
  "제3조(차임) 월 임대료는 1,200,000원으로 하고 매월 말일에 지급한다.",
  "제4조(계약기간) 계약기간은 2년으로 하며 2024.01.01 ~ 2025.12.31 로 한다.",
  "제5조(해지) 임차인은 해지 통보를 3개월 전까지 하여야 한다. 임대인은 차임 연체 시 즉시 해지할 수 있다.",
  "제6조(위약금) 위약금은 계약금액의 10%로 한다.",
  "제7조(원상복구) 임차인은 계약 종료 시 원상복구하여야 하며, 보증금 반환은 명도 후 정산한다.",
  "제8조(관할) 분쟁 시 관할 법원은 임대인의 본점 소재지 법원으로 한다.",
].join("\n")

const TERMS = [
  "제1조(목적) 본 약관은 회사가 제공하는 서비스의 이용 조건을 정한다.",
  "제2조(면책) 회사는 천재지변으로 인한 손해에 대하여 일체의 책임을 지지 않는다.",
  "제3조(손해배상) 회원은 약관 위반으로 회사에 손해를 끼친 경우 이를 배상하여야 한다.",
  "제4조(환불) 디지털 콘텐츠는 구매 후 환불이 불가하다.",
  "제5조(자동결제) 구독은 해지 의사를 밝히지 않으면 자동 갱신된다.",
  "제6조(변경) 회사는 사전고지 없이 변경할 수 있다.",
].join("\n")

const UNSTRUCTURED = [
  "본 계약의 해지 통지는 30일 전까지 서면으로 한다. 다만 중대한 위반이 있으면 즉시 해지할 수 있다.",
  "계약기간은 2024.3.1부터 2025.2.28까지로 하고, 기간 만료 시 자동 연장된다.",
  "공사대금은 금 300,000,000원이며 기성금은 매월 지급한다. 하자보수 기간은 2년으로 한다.",
  "라이선스 사용료는 매출의 5%로 한다. 로열티 1,000,000원을 선지급한다.",
  "갑은 을에게 일체의 책임을 지지 아니하며, 을은 손해배상 책임을 진다.",
].join("\n")

const NDA = [
  "제1조 비밀유지 기간은 계약 종료 후 3년으로 한다.",
  "제2조 경업금지 기간은 퇴직 후 1년으로 한다.",
  "제3조 투자금 1,000,000,000원은 회수할 수 없다.",
  "제4조 손해배상 예정액은 50,000,000원으로 한다.",
  "제5조 독점적 라이선스를 부여하되 제3자에게 재실시를 허락할 수 있다.",
].join("\n")

const types = (cs: Array<{ type: string }>) => cs.map(c => c.type)

describe("C1: 정상 문서 결과는 종전과 같다", () => {
  it("임대차 계약", () => {
    expect(extractAmounts(LEASE)).toEqual([
      { label: "위약금", value: "10%" }, { label: "보증금", value: "50,000,000원" },
      { label: "월세/임대료", value: "1,200,000원" }, { label: "금액", value: "50,000,000원" },
      { label: "금액", value: "5,000,000원" },
    ])
    expect(extractPeriods(LEASE)).toEqual([
      { label: "계약기간", value: "2년" }, { label: "해지 통보 기간", value: "3개월 전" },
      { label: "기간", value: "2024.01.01 ~ 2025.12.31" },
    ])
    expect(types(detectConflictsInText(LEASE))).toEqual(["해지통보 vs 즉시해지"])
    expect(detectConflicts(extractClauses(LEASE, 15))).toEqual([])
  })

  it("이용약관 (조항 간 충돌)", () => {
    expect(extractAmounts(TERMS)).toEqual([])
    expect(extractPeriods(TERMS)).toEqual([])
    expect(types(detectConflictsInText(TERMS))).toEqual(["면책 vs 손해배상"])
    expect(detectConflicts(extractClauses(TERMS, 15)).map(c => [c.type, c.clauseA, c.clauseB]))
      .toEqual([["면책 vs 손해배상", "제2조", "제3조"]])
  })

  it("조항 구분 없는 전문", () => {
    expect(extractAmounts(UNSTRUCTURED)).toEqual([
      { label: "로열티", value: "5%" }, { label: "로열티", value: "1,000,000원" },
      { label: "공사대금", value: "300,000,000원" }, { label: "금액", value: "300,000,000원" },
    ])
    expect(extractPeriods(UNSTRUCTURED)).toEqual([
      { label: "해지 통보 기간", value: "30일 전" }, { label: "보증기간", value: "2년" },
    ])
    expect(types(detectConflictsInText(UNSTRUCTURED)))
      .toEqual(["해지통보 vs 즉시해지", "자동갱신 vs 계약기간 확정", "면책 vs 손해배상"])
  })

  it("비밀유지·투자 조항", () => {
    expect(extractAmounts(NDA)).toEqual([
      { label: "손해배상", value: "50,000,000원" }, { label: "투자금", value: "1,000,000,000원" },
      { label: "금액", value: "1,000,000,000원" },
    ])
    expect(extractPeriods(NDA)).toEqual([
      { label: "비밀유지 기간", value: "3년" }, { label: "경업금지 기간", value: "1년" },
    ])
    expect(types(detectConflictsInText(NDA))).toEqual(["독점 vs 제3자 허용"])
  })

  it("라벨과 숫자 사이 줄바꿈·긴 간격(500자 이내)은 종전처럼 잡는다", () => {
    const multiline = "계약금액\n금 30,000,000원\n해지 통보는\n30일 전까지 한다.\n보증금 :   20,000,000 원"
    expect(extractAmounts(multiline)).toEqual([
      { label: "계약금액", value: "30,000,000원" }, { label: "보증금", value: "20,000,000 원" },
      { label: "금액", value: "30,000,000원" },
    ])
    expect(extractPeriods(multiline)).toEqual([{ label: "해지 통보 기간", value: "30일 전" }])
    const longGap = "위약금은 계약 당사자 중 일방이 본 계약을 위반하여 상대방에게 손해를 입힌 경우 그 상대방에게 지급하여야 하는 금액으로서 10%로 한다."
    expect(extractAmounts(longGap)).toEqual([{ label: "위약금", value: "10%" }])
    // 괄호 삽입구가 긴 한 문단짜리 조항: 라벨과 금액 사이 300자도 잡는다(200자 창일 때는 놓쳤다)
    const longClause = "보증금(" + "계약금 및 잔금을 포함하며 임대인이 지정하는 계좌로 지급한 금액을 말한다. ".repeat(8) + ")은 금 50,000,000원으로 한다."
    expect(extractAmounts(longClause).map(a => a.value)).toContain("50,000,000원")
    // 충돌 규칙의 `\s*` 는 줄을 넘는다: 라벨 다음 줄의 "30일 전"도 종전처럼 잡는다
    expect(types(detectConflictsInText("해지 통보\n\n  30일 전까지 한다. 즉시 해지 가능."))).toEqual(["해지통보 vs 즉시해지"])
  })
})

describe("C1: 의도한 차이", () => {
  it("쉼표만 든 쓰레기 금액(', 원')은 더 만들지 않는다", () => {
    // 종전 구현은 "하되, 원상복구"의 쉼표와 '원'을 이어 금액 ', 원'을 뽑았다
    expect(extractAmounts("보증금 반환 시기는 명도 완료 후로 하되, 원상복구 비용을 공제한다.")).toEqual([])
  })
})
