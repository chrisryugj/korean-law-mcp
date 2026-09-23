import { describe, it, expect } from "vitest"
import { stripHtml, toArray, extractTag, parseSearchXML } from "./xml-parser.js"

describe("stripHtml — 검색결과 하이라이트 태그 제거", () => {
  it('<strong class="...">지방</strong>자치법 → 지방자치법', () => {
    expect(stripHtml('<strong class="tbl_tx_type">지방</strong>자치법')).toBe("지방자치법")
  })
  it("태그 없으면 원문 유지", () => {
    expect(stripHtml("민법")).toBe("민법")
  })
})

// Critical Rule 6: API 응답의 배열 필드가 단일 객체로 올 수 있음
describe("toArray — 단일 객체 정규화", () => {
  it("단일 객체 → 길이 1 배열", () => {
    expect(toArray({ a: 1 })).toEqual([{ a: 1 }])
  })
  it("배열은 그대로", () => {
    expect(toArray([1, 2])).toEqual([1, 2])
  })
  it("null / undefined → 빈 배열", () => {
    expect(toArray(null)).toEqual([])
    expect(toArray(undefined)).toEqual([])
  })
})

describe("extractTag — XML 태그 텍스트 추출", () => {
  it("일반 태그", () => {
    expect(extractTag("<법령명한글>민법</법령명한글>", "법령명한글")).toBe("민법")
  })
  it("CDATA 우선 처리", () => {
    expect(extractTag("<본문><![CDATA[제1조 내용]]></본문>", "본문")).toBe("제1조 내용")
  })
  it("self-closing 태그는 빈 문자열", () => {
    expect(extractTag("<조문내용/>", "조문내용")).toBe("")
  })
  it("없는 태그는 빈 문자열", () => {
    expect(extractTag("<a>x</a>", "b")).toBe("")
  })
})

// 2026-09-23 리뷰 D9: 실측 공정위 결정문 검색(target=ftc, query=담합) 응답 원문.
// 닫는 태그가 `</사건번호 >`로 온다. 엄격 매칭이면 사건번호가 목록에서 빠졌다.
const FTC_SEARCH_XML =
  `<?xml version="1.0" encoding="UTF-8"?><Ftc><target>ftc</target><키워드>담합</키워드><section>evtNm</section>` +
  `<totalCnt>1</totalCnt><page>1</page><기관명>공정거래위원회</기관명><ftc id="1"><결정문일련번호>9721</결정문일련번호>` +
  `<사건명><![CDATA[군납유류 입찰담합 관련 과징금 재산정에 대한 현대오일뱅크(주)의 이의신청에 대한 건]]></사건명>` +
  `<사건번호>2009협심0509</사건번호 ><문서유형>의결서</문서유형><회의종류>전 원 회 의</회의종류>` +
  `<결정번호><![CDATA[재 결  제 2009 - 013호]]></결정번호><결정일자>2009.4.15.</결정일자>` +
  `<결정문상세링크>/DRF/lawService.do?OC=test&amp;target=ftc&amp;ID=9721&amp;type=HTML&amp;mobileYn=</결정문상세링크></ftc></Ftc>`

describe("extractTag: 닫는 태그 공백 내성 (D9)", () => {
  it("실측 FTC 항목에서 `</사건번호 >`의 사건번호를 읽는다", () => {
    const { items } = parseSearchXML(FTC_SEARCH_XML, "Ftc", "ftc", c => ({
      사건번호: extractTag(c, "사건번호"),
      사건명: extractTag(c, "사건명"),
      결정일자: extractTag(c, "결정일자"),
    }), { useIndexOf: true })
    expect(items).toEqual([{
      사건번호: "2009협심0509",
      사건명: "군납유류 입찰담합 관련 과징금 재산정에 대한 현대오일뱅크(주)의 이의신청에 대한 건",
      결정일자: "2009.4.15.",
    }])
  })

  it("CDATA 값도 닫는 태그 공백을 허용한다", () => {
    expect(extractTag("<사건명><![CDATA[가 사건]]></사건명 >", "사건명")).toBe("가 사건")
  })

  it("공백 허용이 이름이 긴 이웃 태그를 닫는 태그로 오인하지 않는다", () => {
    // `</사건번호명>`은 `</사건번호\s*>`가 아니다. 다음 진짜 닫는 태그까지 가야 한다.
    expect(extractTag("<사건번호>A</사건번호명></사건번호>", "사건번호")).toBe("A</사건번호명>")
  })
})
