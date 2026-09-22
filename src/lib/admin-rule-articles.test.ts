import { describe, it, expect } from "vitest"
import { parseAdminRuleArticles, normalizeAdminJo, normalizeChapter, findArticle } from "./admin-rule-articles.js"
import { buildPartialBody, paginateFullText, pickPartialMode } from "./admin-rule-views.js"

// 외국환거래규정 실측 패턴 축약 픽스처 — 하이픈형(제{장}-{조}조) 체계
const HYPHEN_BODY = [
  "제1장 총칙",
  "제1-1조(목적) 이 규정은 「외국환거래법」에서 위임된 사항을 정함을 목적으로 한다.",
  "제1-2조(용어의 정의) 이 규정에서 사용하는 용어의 정의는 다음과 같다.",
  "  1. \"매매기준율\"이라 함은 …을 말한다.",
  "제2장 외국환업무취급기관 등",
  "제2-6조의2 (예금 및 신탁)", // 조번호와 괄호 사이 공백
  " ① 외국환은행이 개설할 수 있는 예금계정의 종류는 다음과 같다.",
  "제1-2조 제1항의 규정은 이 조에 준용한다.", // 라인 시작 역행 참조(헤더 모양) — 단조증가 검사로 걸러져야 한다
  "제2-15조(투자중개업자) <삭 제>", // 삭제 조문도 하나의 조문
  "제9장 직접투자 및 부동산 취득",
  "제9-5조(해외직접투자의 신고 등)",
  " ① 거주자가 해외직접투자를 하고자 하는 경우 지정거래외국환은행의 장에게 신고하여야 한다.",
  "   이 경우 제9-9조제1항의 보고 의무는 별도로 적용된다.", // 본문 중간(들여쓰기) 참조
  "제9-9조(사후관리)",
  " ① 해외직접투자자는 연간사업실적보고서를 제출하여야 한다.",
  "제10장 보칙",
  "제10-1조(보고) 한국은행총재는 보고할 수 있다.",
].join("\n")

// 일반형(하이픈 없음) 체계
const PLAIN_BODY = [
  "제1조(목적) 이 고시는 …을 목적으로 한다.",
  "제10조(급여) 급여는 다음과 같다.",
  "제10조의2(가산) 가산은 다음과 같다.",
].join("\n")

// 조문 체계가 없는 항목식 훈령
const ITEMIZED_BODY = ["1. 일반 원칙", "  가. 성실히 수행한다.", "2. 세부 지침"].join("\n")

describe("parseAdminRuleArticles — 헤더 패턴 (AC#10)", () => {
  const parsed = parseAdminRuleArticles(HYPHEN_BODY)

  it("괄호 제목·공백 괄호·조의N·삭제 조문·하이픈 조문을 전부 분리한다", () => {
    expect(parsed.articles.map((a) => a.key)).toEqual([
      "1-1", "1-2", "2-6의2", "2-15", "9-5", "9-9", "10-1",
    ])
  })

  it("일반형 조문·조의N도 동일 로직으로 분리한다", () => {
    const p = parseAdminRuleArticles(PLAIN_BODY)
    expect(p.articles.map((a) => a.key)).toEqual(["1", "10", "10의2"])
  })

  it("라인 시작의 역행 참조는 새 조문으로 분리하지 않는다 (단조증가 검사)", () => {
    const a = parsed.articles.find((x) => x.key === "2-6의2")!
    expect(a.lines.join("\n")).toContain("제1-2조 제1항의 규정은")
    expect(parsed.articles.filter((x) => x.key === "1-2")).toHaveLength(1)
  })

  it("본문 중간 참조는 ^ 앵커로 걸러진다", () => {
    const a = parsed.articles.find((x) => x.key === "9-5")!
    expect(a.lines.join("\n")).toContain("제9-9조제1항의 보고 의무")
    expect(parsed.articles.filter((x) => x.key === "9-9")).toHaveLength(1)
  })

  it("장 헤더를 인식하고 조문을 장에 귀속시킨다", () => {
    expect(parsed.chapters.map((c) => c.num)).toEqual([1, 2, 9, 10])
    expect(parsed.articles.find((a) => a.key === "9-5")!.chapter).toBe(9)
  })

  it("항목식 본문은 조문 0개로 파싱된다", () => {
    expect(parseAdminRuleArticles(ITEMIZED_BODY).articles).toHaveLength(0)
  })
})

describe("normalizeAdminJo — 입력 정규화", () => {
  it.each([
    ["제9-5조", "9-5"],
    ["9-5", "9-5"],
    ["제9-5조의2", "9-5의2"],
    ["9-5-2", "9-5의2"],
    ["제10조", "10"],
    ["10", "10"],
    ["제10조의2", "10의2"],
    ["제 9 - 5 조", "9-5"],
    ["제9-5조제3항", "9-5"],
  ])("%s → 최우선 후보 %s", (input, first) => {
    expect(normalizeAdminJo(input)[0]).toBe(first)
  })

  it("'10-2'는 하이픈형 우선, 일반형 조의2를 후보로 남긴다", () => {
    expect(normalizeAdminJo("10-2")).toEqual(["10-2", "10의2"])
  })

  it("일반형 규칙에서 '10-2' 입력이 제10조의2로 폴백 매칭된다", () => {
    const p = parseAdminRuleArticles(PLAIN_BODY)
    expect(findArticle(p, "10-2")!.key).toBe("10의2")
  })

  it("normalizeChapter — 제9장·9장·9 모두 9", () => {
    expect([normalizeChapter("제9장"), normalizeChapter("9장"), normalizeChapter("9")]).toEqual([9, 9, 9])
  })
})

describe("buildPartialBody — 뷰 동작", () => {
  it("jo: 지정 조문만 반환하고 다른 장 내용이 섞이지 않는다", () => {
    const v = buildPartialBody(HYPHEN_BODY, HYPHEN_BODY, { jo: "제9-5조" })
    expect(v.text).toContain("제9-5조(해외직접투자의 신고 등)")
    expect(v.text).not.toContain("제1-1조")
    expect(v.text).not.toContain("제2-6조의2")
  })

  it("chapter: 해당 장의 첫 조문부터 다음 장 직전까지", () => {
    const v = buildPartialBody(HYPHEN_BODY, HYPHEN_BODY, { chapter: "제9장" })
    expect(v.text).toContain("제9-5조")
    expect(v.text).toContain("제9-9조")
    expect(v.text).not.toContain("제10-1조")
  })

  it("keyword: 포함 조문 목록 반환", () => {
    const v = buildPartialBody(HYPHEN_BODY, HYPHEN_BODY, { keyword: "해외직접투자" })
    expect(v.text).toContain("제9-5조")
    expect(v.text).toContain("제9-9조")
    expect(v.text).not.toContain("제1-1조")
  })

  it("조문 체계 없는 본문에 jo 요청 → graceful 안내 (AC#7)", () => {
    const v = buildPartialBody(ITEMIZED_BODY, ITEMIZED_BODY, { jo: "제1조" })
    expect(v.text).toContain("조문 체계가 없습니다")
    expect(v.text).toContain("keyword 또는 page")
  })

  it("복수 파라미터는 jo만 적용하고 무시 목록을 명시한다", () => {
    const { mode, ignored } = pickPartialMode({ jo: "제9-5조", keyword: "예금", page: 2 })
    expect(mode).toBe("jo")
    expect(ignored).toEqual(["keyword", "page"])
    const v = buildPartialBody(HYPHEN_BODY, HYPHEN_BODY, { jo: "제9-5조", keyword: "예금", page: 2 })
    expect(v.note).toContain("'jo'만 적용")
  })
})

describe("paginateFullText — 비중첩 페이징 (AC#6)", () => {
  const full = Array.from({ length: 200 }, (_, i) => `라인 ${i} — ${"내용".repeat(30)}`).join("\n")

  it("모든 페이지를 이으면 원문과 같고 서로 겹치지 않는다", () => {
    const first = paginateFullText(full, 1, 1000)
    const pages = Array.from({ length: first.totalPages }, (_, i) => paginateFullText(full, i + 1, 1000))
    expect(pages.map((p) => p.text).join("")).toBe(full)
    expect(pages[0].text).not.toBe(pages[1].text)
    expect(first.totalPages).toBeGreaterThan(1)
  })

  it("범위 밖 page는 경계로 클램프된다", () => {
    expect(paginateFullText(full, 999, 1000).page).toBe(paginateFullText(full, 1, 1000).totalPages)
    expect(paginateFullText(full, 0, 1000).page).toBe(1)
  })
})
