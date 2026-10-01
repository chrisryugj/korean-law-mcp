import { describe, expect, it } from "vitest"
import { classifyArticleRefs, parseArticleAnchor } from "./article-anchor.js"

describe("범위 인용의 법령·가지번호 경계", () => {
  it("범위 안의 조번호도 명시된 타법이면 제외한다", () => {
    expect(classifyArticleRefs("형법 제1조부터 제5조까지", parseArticleAnchor("제3조", "민법")!)).toBe("law-mismatch")
    expect(classifyArticleRefs("형법 제1조부터 제5조까지", parseArticleAnchor("제5조", "민법")!)).toBe("law-mismatch")
  })

  it("가지번호 구간 밖의 본조·가지는 제외하고 안쪽은 유지한다", () => {
    for (const jo of ["제1조", "제1조의1", "제1조의5", "제1조의99"]) {
      expect(classifyArticleRefs("민법 제1조의2부터 제1조의4", parseArticleAnchor(jo, "민법")!)).toBe("mismatch")
    }
    expect(classifyArticleRefs("민법 제1조의2부터 제1조의4", parseArticleAnchor("제1조의3", "민법")!)).toBe("match")
    expect(classifyArticleRefs("민법 제1조의2부터 제3조까지", parseArticleAnchor("제2조의4", "민법")!)).toBe("match")
    expect(classifyArticleRefs("민법 제1조의2부터 제3조까지", parseArticleAnchor("제3조의1", "민법")!)).toBe("mismatch")
  })

  it("법령 불명확·구제명 범위는 확정하지 않고 보류한다", () => {
    expect(classifyArticleRefs("제1조~제5조", parseArticleAnchor("제3조", "민법")!)).toBe("hold")
    expect(classifyArticleRefs("구 매장및묘지등에관한법률 제1조부터 제10조", parseArticleAnchor("제5조", "장사 등에 관한 법률")!)).toBe("hold")
  })

  it("타법 범위 뒤의 별도 정탐 인용과 법령축 없는 범위는 유지한다", () => {
    expect(classifyArticleRefs("형법 제1조~제5조, 민법 제3조", parseArticleAnchor("제3조", "민법")!)).toBe("match")
    expect(classifyArticleRefs("제1조~제5조", parseArticleAnchor("제3조")!)).toBe("match")
  })
})
