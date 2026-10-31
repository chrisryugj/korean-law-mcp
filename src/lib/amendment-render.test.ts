/**
 * 신구조문대비표 엔진 — 법제처 신구법비교 원문(실제 개정 대비표)의 표기를 정답으로 둔다.
 * 기대값의 ‹›는 밑줄 구간.
 */
import { describe, it, expect } from "vitest"
import { parseArticle } from "./amendment-units.js"
import { renderArticle, type Row } from "./amendment-render.js"
import { lineToPlain } from "./amendment-format.js"
import { dashify } from "./amendment-marks.js"
import { diffInline } from "./amendment-diff.js"

const show = (rows: Row[] | null) => (rows ?? []).map(r => ({
  old: r.old.map(lineToPlain).join("\n"),
  new: r.new.map(lineToPlain).join("\n"),
}))

const table = (oldText: string | null, newText: string) =>
  show(renderArticle(oldText === null ? null : parseArticle(oldText), parseArticle(newText)))

describe("parseArticle", () => {
  it("조 머리 뒤에 같은 줄로 붙은 ①을 떼고, 호는 항 아래로 넣는다", () => {
    const t = parseArticle("제22조(건축물의 사용승인) ① 건축주는 신청한다. <개정 2013.3.23>\n② 허가권자는 검사한다.\n1. 설계도서\n6의2. 기계설비\n12. 삭제<2009.6.9>")
    expect(t.num).toBe("제22조")
    expect(t.title).toBe("(건축물의 사용승인)")
    expect(t.children.map(c => c.label)).toEqual(["①", "②"])
    expect(t.children[0].body).toBe("건축주는 신청한다.")
    expect(t.children[1].children.map(c => `${c.label}${c.body}`)).toEqual(["1.설계도서", "6의2.기계설비", "12.삭제"])
  })

  it("항 없는 조는 본문이 lead, 괄호 안 괄호 제목도 읽는다", () => {
    const t = parseArticle("제4조(국가ㆍ지방자치단체(시ㆍ도) 및 국민의 책무) 국가는 노력하여야 한다.\n[전문개정 2008.3.21]")
    expect(t.title).toBe("(국가ㆍ지방자치단체(시ㆍ도) 및 국민의 책무)")
    expect(t.lead).toBe("국가는 노력하여야 한다.")
  })
})

describe("자리표시 (현행과 같음)", () => {
  it("범위·가운뎃점·조 본문 자리표시를 현행으로 채운다", () => {
    const old = "제2조(정의) 이 법에서 사용하는 용어의 뜻은 다음과 같다.\n1. 가란 가이다.\n2. 나란 나이다.\n3. 다란 다이다.\n4. 라란 라이다."
    const neu = "제2조(정의) (현행과 같음)\n1.·2. (현행과 같음)\n3. 다란 새 다이다.\n4. (생  략)\n5. 마란 마이다."
    const notes: string[] = []
    const rows = renderArticle(parseArticle(old), parseArticle(neu), notes)
    expect(show(rows)).toEqual([
      { old: "제2조(정의) 이 법에서 사용하는 용어의 뜻은 다음과 같다.", new: "제2조(정의) ------------------------." },
      { old: "1.·2. (생  략)", new: "1.·2. (현행과 같음)" },
      { old: "3. ‹다란› 다이다.", new: "3. ‹다란 새› ---." },
      { old: "4. (생  략)", new: "4. (현행과 같음)" },
      { old: "‹<신  설>›", new: "‹5. 마란 마이다.›" },
    ])
    expect(notes).toEqual([])
  })

  it("현행에 없는 번호를 가리키면 빼고 알린다", () => {
    const notes: string[] = []
    renderArticle(parseArticle("제3조(가) ① 가는 한다.\n② 나는 한다."), parseArticle("제3조(가) ① ∼ ⑤ (현행과 같음)"), notes)
    expect(notes[0]).toContain("① ∼ ⑤이(가) 현행에 없어 뺐습니다")
  })
})

describe("diffInline — 법제처 밑줄 단위", () => {
  const u = (o: string, n: string) => {
    const d = diffInline(o, n)
    return [lineToPlain(d.old), lineToPlain(d.new)]
  }
  it("어절 단위 + 끝 조사는 밑줄 밖 (건축법 제22조 2025 개정)", () => {
    expect(u("국토교통부령으로 정하는 공사완료도서를 첨부하여", "국토교통부령으로 정하는 서류를 첨부하여"))
      .toEqual(["국토교통부령으로 정하는 ‹공사완료도서›를 첨부하여", "국토교통부령으로 정하는 ‹서류›를 첨부하여"])
  })
  it("끼워 넣기는 앞 어절을 붙잡아 양쪽에 긋는다 (동물보호법 제2조)", () => {
    expect(u("도로ㆍ공원 등의 공공장소에서 배회하거나", "도로ㆍ공원 등의 공공장소, 동물병원 또는 업체에서 배회하거나"))
      .toEqual(["도로ㆍ공원 등의 ‹공공장소›에서 배회하거나", "도로ㆍ공원 등의 ‹공공장소, 동물병원 또는 업체›에서 배회하거나"])
  })
  it("빼기도 앞 어절을 붙잡는다 (동물보호법 제9조)", () => {
    expect(u("수면이 보장되도록 노력하여야 한다.", "수면이 보장되도록 한다."))
      .toEqual(["수면이 ‹보장되도록 노력하여야› 한다.", "수면이 ‹보장되도록› 한다."])
  })
})

describe("renderArticle", () => {
  it("뒤에 항을 신설하면 앞 항은 묶어 (생  략), 새 항은 <신  설> (건축법 제11조)", () => {
    const old = "제11조(건축허가) ① 가는 한다.\n② 나는 한다.\n③ 다는 한다."
    expect(table(old, `${old}\n④ 라는 알려야 한다.`)).toEqual([
      { old: "제11조(건축허가) ① ∼ ③ (생  략)", new: "제11조(건축허가) ① ∼ ③ (현행과 같음)" },
      { old: "‹<신  설>›", new: "‹④ 라는 알려야 한다.›" },
    ])
  })

  it("바뀐 항: 개정안 칸은 같은 부분을 줄표로, 호 신설은 머리글 줄을 줄표로 이어 준다", () => {
    const old = "제22조(사용승인) ① 건축주는 공사완료도서를 첨부한다.\n② 허가권자는 검사한다.\n1. 가 여부\n2. 나 여부\n③ 다는 한다."
    const neu = "제22조(사용승인) ① 건축주는 서류를 첨부한다.\n② 허가권자는 검사한다.\n1. 가 여부\n2. 나 여부\n3. 숙박시설 여부\n③ 다는 한다."
    expect(table(old, neu)).toEqual([
      { old: "제22조(사용승인) ① 건축주는 ‹공사완료도서›를 첨부한다.", new: "제22조(사용승인) ① ---- ‹서류›------." },
      { old: "② 허가권자는 검사한다.", new: "② ----------." },
      { old: "1.·2. (생  략)", new: "1.·2. (현행과 같음)" },
      { old: "‹<신  설>›", new: "‹3. 숙박시설 여부›" },
      { old: "③ (생  략)", new: "③ (현행과 같음)" },
    ])
  })

  it("가운데 항을 끼워 번호가 밀려도 번호끼리 짝 — 공식 대비표처럼 밀린 항은 바뀐 항, 끝 번호는 <신  설>", () => {
    const old = "제5조(신고) ① 가는 한다.\n② 나는 한다.\n③ 다는 한다."
    const neu = "제5조(신고) ① 가는 한다.\n② 새로 생긴 항은 이렇게 한다.\n③ 나는 한다.\n④ 다는 한다."
    expect(table(old, neu)).toEqual([
      { old: "제5조(신고) ① (생  략)", new: "제5조(신고) ① (현행과 같음)" },
      { old: "‹② 나는 한다.›", new: "‹② 새로 생긴 항은 이렇게 한다.›" },
      { old: "③ ‹다›는 한다.", new: "③ ‹나›----." },
      { old: "‹<신  설>›", new: "‹④ 다는 한다.›" },
    ])
  })

  it("본문만 있던 조를 항으로 나누면 조 전체를 통째로 (저작권법 제106조의2)", () => {
    expect(table("제106조의2(거부금지) 정당한 이유가 없으면 거부해서는 아니 된다.", "제106조의2(거부금지 등) ① 정당한 이유가 없으면 거부해서는 아니 된다.\n② 원칙에 따라 이용허락을 하여야 한다."))
      .toEqual([{ old: "‹제106조의2(거부금지) 정당한 이유가 없으면 거부해서는 아니 된다.›", new: "‹제106조의2(거부금지 등) ① 정당한 이유가 없으면 거부해서는 아니 된다.›\n‹② 원칙에 따라 이용허락을 하여야 한다.›" }])
  })

  it("옛 법령의 붙여 쓴 라벨(①문화…)과 곧은 따옴표는 원문 모양대로·“ ”로", () => {
    expect(table('제108조(감독) ①장관은 보고를 하게 할 수 있다.\n②장관은 "명령"을 할 수 있다.', '제108조(감독) ①장관은 보고를 하게 할 수 있다.\n②장관은 "시정명령"을 할 수 있다.'))
      .toEqual([
        { old: "제108조(감독) ① (생  략)", new: "제108조(감독) ① (현행과 같음)" },
        { old: "②장관은 ‹“명령”›을 할 수 있다.", new: "②--- ‹“시정명령”›--------." },
      ])
  })

  it("'3. 삭제'로 지운 호는 <삭  제>, 통째로 바뀐 호는 라벨까지 밑줄", () => {
    const old = "제9조(금지) 다음 행위를 하여서는 아니 된다.\n1. 유기하는 행위\n2. 도박에 이용하는 행위\n3. 판매하는 행위"
    const neu = "제9조(금지) 다음 행위를 하여서는 아니 된다.\n1. 유기하는 행위\n2. 봉사동물을 학대하는 일\n3. 삭제"
    expect(table(old, neu)).toEqual([
      { old: "제9조(금지) 다음 행위를 하여서는 아니 된다.", new: "제9조(금지) -----------------." },
      { old: "1. (생  략)", new: "1. (현행과 같음)" },
      { old: "‹2. 도박에 이용하는 행위›", new: "‹2. 봉사동물을 학대하는 일›" },
      { old: "‹3. 판매하는 행위›", new: "‹<삭  제>›" },
    ])
  })

  it("끝에 단서를 붙이면 현행 칸에 <단서 신설> (동물보호법 제18조)", () => {
    expect(table("제18조(허가) ③ 시ㆍ도지사는 기질평가를 거쳐야 한다.", "제18조(허가) ③ 시장ㆍ군수는 기질평가를 거쳐야 한다. 다만, 어려운 경우에는 그러하지 아니하다."))
      .toEqual([{
        old: "제18조(허가) ③ ‹시ㆍ도지사›는 기질평가를 거쳐야 한다. ‹<단서 신설>›",
        new: "제18조(허가) ③ ‹시장ㆍ군수›--------------. ‹다만, 어려운 경우에는 그러하지 아니하다.›",
      }])
  })

  it("제목만 바뀌면 (제목) 밑줄 + 나머지 (현행과 같음)", () => {
    expect(table("제65조(승무정원) ① 가는 한다.\n② 나는 한다.", "제65조(최소승무정원) ① 가는 한다.\n② 나는 한다."))
      .toEqual([{ old: "제65조‹(승무정원)› ①·② (생  략)", new: "제65조‹(최소승무정원)› ①·② (현행과 같음)" }])
  })

  it("조 신설·삭제와 변경 없음", () => {
    expect(table(null, "제5조의2(갱신) ① 3년마다 갱신한다.\n② 절차는 대통령령으로 정한다."))
      .toEqual([{ old: "‹<신  설>›", new: "‹제5조의2(갱신) ① 3년마다 갱신한다.›\n‹② 절차는 대통령령으로 정한다.›" }])
    expect(table("제7조(위원회) 위원회를 둔다.", "제7조 삭제"))
      .toEqual([{ old: "‹제7조(위원회) 위원회를 둔다.›", new: "‹제7조 삭제›" }])
    expect(renderArticle(parseArticle("제7조(위원회) 위원회를 둔다."), parseArticle("제7조(위원회) 위원회를  둔다."))).toBeNull()
  })
})

describe("큰 입력", () => {
  it("5만 자 한 줄·호 900개도 빠르게 끝난다(원격 서버 메모리·시간 보호)", () => {
    const words = (seed: string) => Array.from({ length: 12_000 }, (_, i) => `${seed}${i}`).join(" ")
    const t0 = Date.now()
    const d = diffInline(words("가"), words("나"))
    expect(d.old.length).toBeGreaterThan(0)
    const items = (w: string) => Array.from({ length: 900 }, (_, i) => `${i + 1}. ${w}${i}`).join("\n")
    expect(table(`제1조(목적) 다음과 같다.\n${items("가")}`, `제1조(목적) 다음과 같다.\n${items("나")}`).length).toBe(901)
    expect(Date.now() - t0).toBeLessThan(5_000)
  })
})

describe("리뷰 재현 (2026-10-31)", () => {
  it("A: 같은 층 단위 8천 개 × 8천 개도 n×m 표 없이 끝난다(수정 전 RSS +1.17GB)", () => {
    const many = "제1조(가) " + Array.from({ length: 8_000 }, () => "① 가").join("\n")
    const before = process.memoryUsage().rss
    renderArticle(parseArticle(many), parseArticle(many.replace(/가$/, "나")))
    expect(process.memoryUsage().rss - before).toBeLessThan(200 * 1024 * 1024)
  })

  it("B: 줄 안의 긴 전각 공백·\\r 도 선형으로 처리한다", () => {
    const t0 = Date.now()
    table("제1조(가) ① 가" + "\u3000".repeat(30_000) + "나", "제1조(가) ① 다" + "\u3000".repeat(30_000) + "라")
    table("제1조(가) ① 가" + "\u3000".repeat(30_000) + "나\n② 바", "제1조(가) ① 가" + "\u3000".repeat(30_000) + "나\n② 사")
    expect(Date.now() - t0).toBeLessThan(1_000)
  })

  it("F: 제목의 가운뎃점 표기 차이는 제목 변경이 아니다", () => {
    expect(renderArticle(parseArticle("제4조(국가ㆍ지방자치단체의 책무) 노력한다."), parseArticle("제4조(국가·지방자치단체의 책무) 노력한다."))).toBeNull()
  })

  it("G: '제3조에 따른 …'으로 시작하는 본문을 조 머리로 읽지 않는다", () => {
    const t = parseArticle("제3조에 따른 신고는 서면으로 한다.")
    expect(t.num).toBe("")
    expect(t.lead).toBe("제3조에 따른 신고는 서면으로 한다.")
  })

  it("I: 제목만 바뀐 조의 본문(호 머리글)은 표에서 사라지지 않는다", () => {
    expect(table("제2조(정의) 용어의 뜻은 다음과 같다.\n1. 가\n2. 나", "제2조(용어의 정의) 용어의 뜻은 다음과 같다.\n1. 가\n2. 나")).toEqual([
      { old: "제2조‹(정의)› 용어의 뜻은 다음과 같다.", new: "제2조‹(용어의 정의)› -------------." },
      { old: "1.·2. (생  략)", new: "1.·2. (현행과 같음)" },
    ])
  })
})

describe("표기 원자", () => {
  it("줄표: 글자 수만큼, 문장 끝 마침표와 그 뒤 공백은 남긴다", () => {
    expect(dashify("가는 한다. 나는 한다.")).toBe("-----. -----.")
    expect(dashify(" 제1항에 따라 ")).toBe(" ------- ")
  })
})
