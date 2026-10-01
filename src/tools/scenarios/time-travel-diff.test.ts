import { describe, it, expect } from "vitest"
import { changeExcerpt, diffArticles, excerptBudget, extractLawSnapshot, dot, normalizeText, snapToClauseStart } from "./time-travel-diff.js"

describe("normalizeText 법령 원문 표기", () => {
  it("HTML 태그만 공백으로 바꾸고 한글 개정·삭제 표기는 보존한다", () => {
    expect(normalizeText("제1조 내용 <개정 2024.1.1.><br/>다음 내용 <삭제>"))
      .toBe("제1조 내용 <개정 2024.1.1.> 다음 내용 <삭제>")
  })
})

describe("extractLawSnapshot 출처 메타 (#96)", () => {
  const json = {
    법령: {
      기본정보: { 공포번호: "19924", 공포일자: "20231231", 제개정구분: "일부개정" },
      조문: {
        조문단위: [
          { 조문여부: "조문", 조문번호: "1", 조문제목: "목적", 조문내용: "제1조(목적) …", 조문시행일자: "20240101" },
          { 조문여부: "전문", 조문내용: "무시" },
        ],
      },
    },
  }

  it("공포번호·공포일자·제개정구분을 함께 뽑는다", () => {
    const s = extractLawSnapshot(json)
    expect(s.ancNo).toBe("19924")
    expect(s.ancYd).toBe("20231231")
    expect(s.rrCls).toBe("일부개정")
  })

  it("조문시행일자를 조문별로 보존한다", () => {
    expect(extractLawSnapshot(json).articles[0].efYd).toBe("20240101")
  })

  it("조문이 아닌 단위는 제외한다", () => {
    expect(extractLawSnapshot(json).articles).toHaveLength(1)
  })

  it("dot는 YYYYMMDD를 표기용으로 바꾼다", () => {
    expect(dot("20231231")).toBe("2023.12.31")
    expect(dot("")).toBe("")
  })
})

// #150 승계: 항내용+항.호.호내용만 순회해 목(目)·조문 직속 호가 스냅샷에서 빠졌다.
// 목만 개정된 조문은 "본문 동일"로 무음 누락된다 — diff 도구의 무음 누락은 "개정 없음" 단정이다.
// 순회 대상은 article-parser extractHangContent와 같은 대응(hang.목 형제 배열·ho.목).
describe("extractLawSnapshot 목·조문 직속 호 합산 (#150)", () => {
  const lawWithMok = (mokContent: string) => ({
    법령: {
      기본정보: {},
      조문: { 조문단위: [{
        조문여부: "조문", 조문번호: "5", 조문제목: "임원",
        조문내용: "제5조(임원) 조합에 다음 각 호의 임원을 둔다.",
        항: { 항내용: "① 임원은 다음 각 호와 같다.", 호: { 호내용: "1. 이사장 1명", 목: { 목내용: mokContent } } },
      }] },
    },
  })

  it("호 아래 목 텍스트가 스냅샷 본문에 실린다", () => {
    expect(extractLawSnapshot(lawWithMok("가. 상근 이사")).articles[0].body).toContain("가. 상근 이사")
  })

  it("목만 개정돼도 본문 변화로 잡힌다", () => {
    const oldS = extractLawSnapshot(lawWithMok("가. 상근 이사"))
    const newS = extractLawSnapshot(lawWithMok("가. 상근 이사 및 감사"))
    expect(diffArticles(oldS.articles, newS.articles).modified).toHaveLength(1)
  })

  it("항 레벨 형제 배열로 오는 목도 스냅샷에 실린다", () => {
    const law = { 법령: { 기본정보: {}, 조문: { 조문단위: [{
      조문여부: "조문", 조문번호: "6", 조문내용: "제6조(사업) 조합은 다음 사업을 한다.",
      항: { 항내용: "① 다음 각 호의 사업을 한다.", 호: [{ 호내용: "1. 지도 사업" }], 목: [{ 목번호: "가", 목내용: "가. 회원 지도" }] },
    }] } } }
    expect(extractLawSnapshot(law).articles[0].body).toContain("가. 회원 지도")
  })

  it("항 없이 조문 직속으로 오는 호도 스냅샷에 실린다", () => {
    const law = { 법령: { 기본정보: {}, 조문: { 조문단위: [{
      조문여부: "조문", 조문번호: "2", 조문내용: "제2조(정의) 이 법에서 사용하는 용어의 뜻은 다음과 같다.",
      호: [{ 호내용: "1. \"조합\"이란 사업자 단체를 말한다.", 목: { 목내용: "가. 지역 조합" } }],
    }] } } }
    const body = extractLawSnapshot(law).articles[0].body
    expect(body).toContain("\"조합\"이란")
    expect(body).toContain("가. 지역 조합")
  })
})

// #97: 앞에서부터 자르면 개정이 조문 후반에 있을 때 [전]/[후]가 똑같이 나와
// 소비 LLM이 조문을 다시 조회한다. 변경 지점을 중심으로 잡아야 한다.
const HEAD = "이 법에서 사용하는 용어의 뜻은 다음과 같다. ".repeat(12)   // 공통 앞머리(300자 이상)
const OLD = HEAD + "관세청장은 기획재정부장관의 승인을 받아 고시한다."
const CUR = HEAD + "관세청장은 재정경제부장관의 승인을 받아 고시한다."

describe("changeExcerpt 변경 지점 중심 발췌 (#97)", () => {
  it("변경된 부분이 [전]/[후] 양쪽에 실제로 담긴다", () => {
    const ex = changeExcerpt(OLD, CUR, 200)
    expect(ex.before).toContain("기획재정부장관")
    expect(ex.after).toContain("재정경제부장관")
  })

  it("[전]과 [후]가 서로 달라진다 (앞머리 슬라이스는 동일해져 무의미)", () => {
    const ex = changeExcerpt(OLD, CUR, 200)
    expect(ex.before).not.toBe(ex.after)
    // 종전 방식(앞 120자)은 둘이 같아 아무 정보도 주지 못했다
    expect(OLD.slice(0, 120)).toBe(CUR.slice(0, 120))
  })

  it("공통 앞머리는 생략 표시로 줄인다", () => {
    const ex = changeExcerpt(OLD, CUR, 200)
    expect(ex.before.startsWith("…")).toBe(true)
    expect(ex.before.length).toBeLessThan(OLD.length)
  })

  it("변경 구간이 예산 안이면 잘림 표시를 하지 않는다", () => {
    expect(changeExcerpt(OLD, CUR, 200).clipped).toBe(false)
  })

  it("변경 구간이 예산을 넘으면 clipped로 알린다", () => {
    const long = "가".repeat(600)
    const ex = changeExcerpt("머리말 " + long, "머리말 " + "나".repeat(600), 200)
    expect(ex.clipped).toBe(true)
  })

  it("본문이 같으면(제목만 변경) 발췌 대신 그 사실을 알린다", () => {
    const ex = changeExcerpt("동일한 본문", "동일한 본문", 200)
    expect(ex.bodyUnchanged).toBe(true)
    expect(ex.before).toBe("")
    expect(ex.after).toBe("")
  })
})

describe("snapToClauseStart 단서 중간 시작 방지 (#97)", () => {
  const body = "제8조(기간) ① 이 법에 따른 기간의 계산은 민법에 따른다. ② 다음 각 호의 날은 기한에서 제외한다. 1. 토요일 및 일요일 2. 공휴일"

  it("항 머리(①②)로 당긴다", () => {
    const mid = body.indexOf("다음 각 호의")
    expect(body[snapToClauseStart(body, mid)]).toBe("②")
  })

  it("호 머리(1. 2.)로 당긴다", () => {
    const mid = body.indexOf("토요일")
    expect(body.slice(snapToClauseStart(body, mid))).toMatch(/^1\.\s/)
  })

  it("앞으로만 당긴다 — 내용을 잃지 않는다", () => {
    const mid = body.indexOf("공휴일")
    expect(snapToClauseStart(body, mid)).toBeLessThanOrEqual(mid)
  })

  it("탐색 폭 안에 경계가 없으면 그대로 둔다", () => {
    const flat = "경계표시가전혀없는긴한글본문".repeat(20)
    expect(snapToClauseStart(flat, 200)).toBe(200)
  })

  it("시작이 0이면 당기지 않는다", () => {
    expect(snapToClauseStart(body, 0)).toBe(0)
  })
})

describe("excerptBudget 예산 배분 (#97)", () => {
  it("변경 조문이 많으면 조문당 예산을 줄인다", () => {
    expect(excerptBudget(30)).toBeLessThan(excerptBudget(5))
  })

  it("상·하한을 벗어나지 않는다", () => {
    expect(excerptBudget(1)).toBeLessThanOrEqual(260)
    expect(excerptBudget(1000)).toBeGreaterThanOrEqual(120)
  })

  it("총 예산은 상한을 지킨다 (응답이 절단 한도로 밀리지 않게)", () => {
    const shown = 30
    expect(excerptBudget(shown) * 2 * shown).toBeLessThanOrEqual(12000)
  })
})

// ─── 통합 배치 이음새 회귀 (지적 3·4) ────────────────────

describe("지적 3 — normalizeText 가 cleanHtml 을 재사용한다 (Critical Rule 7)", () => {
  it("&amp; 를 먼저 풀지 않는다 — 이중 인코딩이 리터럴 태그로 새지 않는다", () => {
    // 손으로 짠 순서(&amp; → &lt;)는 `&amp;lt;` 를 `<` 까지 두 번 풀었다.
    // 태그 스트립이 이미 지난 뒤라 리터럴 `<` 가 diff 본문에 남는다.
    expect(normalizeText("&amp;lt;p&amp;gt; 조문")).toBe("&lt;p&gt; 조문")
  })

  it("&quot; · &#39; 도 푼다 (손으로 짠 목록에서 빠져 있었다)", () => {
    expect(normalizeText("인용 &quot;가&quot; 및 &#39;나&#39;")).toBe('인용 "가" 및 \'나\'')
  })

  it("단독 &amp; 는 그대로 & 로 푼다", () => {
    expect(normalizeText("A &amp; B")).toBe("A & B")
  })

  it("태그는 공백으로 지운다 — 낱말이 붙으면 diff 가 오탐한다", () => {
    expect(normalizeText("제1조<br/>목적")).toBe("제1조 목적")
  })
})

describe("지적 4 — CLAUSE_START 항 경계가 제16항 이상에서도 산다", () => {
  // 커밋 1c67258 의 목적이 "발췌 시작점을 항·호·목 머리로 당김"인데
  // 원숫자가 ⑮ 에서 끊겨 제16항 이상에서 best === -1 로 떨어져 무음 실패했다.
  it.each(["①", "⑮", "⑯", "⑳", "㉑", "㊱", "㊿"])("%s 를 항 머리로 인식한다", (circled) => {
    const body = `앞부분 채우기 텍스트 ${circled} 이 항의 본문이 여기서 시작한다 변경지점`
    const start = body.indexOf("변경지점")
    expect(snapToClauseStart(body, start)).toBe(body.indexOf(circled))
  })
})
