import { describe, it, expect } from "vitest"
import { adminVersionAt, nfCode, parseAdminRuleRows, pickAdminRuleGroup, type AdminRuleVersion } from "./admin-rule-history.js"

// lawSearch.do?target=admrul&nw=2 실응답 형식 (2026-09-28, 「스프링클러설비의 화재안전」).
const row = (serial: string, id: string, name: string, issued: string, ef: string, no: string, rr: string, cur = "연혁") =>
  `<admrul id="1"><행정규칙일련번호>${serial}</행정규칙일련번호><행정규칙명><![CDATA[${name}]]></행정규칙명><행정규칙종류>고시</행정규칙종류>` +
  `<발령일자>${issued}</발령일자><발령번호>${no}</발령번호><소관부처명>소방청</소관부처명><현행연혁구분>${cur}</현행연혁구분>` +
  `<제개정구분명>${rr}</제개정구분명><행정규칙ID>${id}</행정규칙ID><시행일자>${ef}</시행일자></admrul>`

const NFSC = "스프링클러설비의 화재안전기준(NFSC 103)"
const NFPC = "스프링클러설비의 화재안전성능기준(NFPC 103)"
const NFTC = "스프링클러설비의 화재안전기술기준(NFTC 103)"
const XML = `<AdmRulSearch><totalCnt>7</totalCnt>` + [
  row("2100000270474", "35312", NFPC, "20251224", "20260301", "2025-25", "일부개정", "현행"),
  row("2100000216120", "35312", NFPC, "20221125", "20221201", "2022-33", "전부개정"),
  row("2100000011921", "35312", NFSC, "20150123", "20150324", "2015-23", "일부개정"),
  row("2000000025076", "35312", NFSC, "20130611", "20130712", "2013-21", "타법개정"),
  row("2000000024137", "35312", NFSC, "20130610", "20130811", "2013-18", "일부개정"),
  row("2100000281674", "83616", NFTC, "20260701", "20260701", "2026-35", "일부개정", "현행"),
  row("2100000250560", "83617", "간이스프링클러설비의 화재안전기술기준(NFTC 103A)", "20241201", "20241201", "2024-58", "일부개정", "현행"),
].join("") + `</AdmRulSearch>`

function groups(): Map<string, AdminRuleVersion[]> {
  const m = new Map<string, AdminRuleVersion[]>()
  for (const r of parseAdminRuleRows(XML)) m.set(r.ruleId, [...(m.get(r.ruleId) ?? []), r])
  for (const list of m.values()) list.sort((a, b) => b.efYd.localeCompare(a.efYd))
  return m
}

describe("pickAdminRuleGroup — 행정규칙ID 계보 고르기", () => {
  it("옛 이름 완전일치 → NFSC·NFPC 계보(35312)", () => {
    expect(pickAdminRuleGroup(groups(), NFSC)?.[0].ruleId).toBe("35312")
  })
  it("괄호 코드 없이 부른 이름도 잡는다", () => {
    expect(pickAdminRuleGroup(groups(), "스프링클러설비의 화재안전기준")?.[0].ruleId).toBe("35312")
  })
  it("코드만으로 — NFTC 103 은 기술기준 계보, 103A 와 섞지 않는다", () => {
    expect(pickAdminRuleGroup(groups(), "NFTC 103")?.[0].ruleId).toBe("83616")
    expect(pickAdminRuleGroup(groups(), "NFSC 103")?.[0].ruleId).toBe("35312")
  })
  it("이름이 안 맞으면 묶음이 하나여도 고르지 않는다 (오타 법령명에 엉뚱한 고시로 답하지 않게)", () => {
    const one = new Map([["35312", groups().get("35312")!]])
    expect(pickAdminRuleGroup(one, "상법")).toBeUndefined()
  })
  it("nfCode: 성능(S·P)과 기술(T)을 가른다", () => {
    expect(nfCode(NFSC)).toEqual({ family: "performance", code: "103" })
    expect(nfCode("화재조기진압용 스프링클러설비의 화재안전기술기준(NFTC 103B)")).toEqual({ family: "technical", code: "103B" })
  })
})

describe("adminVersionAt — 기준일 시행 버전", () => {
  const nfsc = () => groups().get("35312")!

  it("2016.5.1. → 2015-23호 (NFSC 시절)", () => {
    const { version, note } = adminVersionAt(nfsc(), "20160501")
    expect(version?.serial).toBe("2100000011921")
    expect(note).toBeUndefined()
  })

  it("발령·시행 순서가 엇갈린 구간은 섞인 개정을 알린다 (2013-21호 본문에 미시행 2013-18호 포함)", () => {
    const { version, note } = adminVersionAt(nfsc(), "20130720")
    expect(version?.issuedNo).toBe("2013-21")
    expect(note).toContain("2013-18")
  })

  it("최초 시행 전이면 버전 없음", () => {
    expect(adminVersionAt(nfsc(), "20100101").version).toBeUndefined()
  })

  // 2013-21호(발령 6.11.) 본문은 2013-18호(발령 6.10.) 개정을 이미 담고, 30층 이상 수원 기준 등만 "삭제＜2013.6.11＞"다.
  // 시행일만 보면 18호 시행(8.11.)부터 2015-23호 시행 전날까지 삭제된 조항이 살아 있는 18호 본문을 냈다.
  it("먼저 발령되고 늦게 시행된 개정본이 뒤 발령본을 덮지 않는다 (2013.8.11.~2015.3.23. → 2013-21호)", () => {
    for (const d of ["20130811", "20140101", "20150323"]) {
      const { version, note } = adminVersionAt(nfsc(), d)
      expect(version?.issuedNo, d).toBe("2013-21")
      expect(note, d).toBeUndefined()
    }
    expect(adminVersionAt(nfsc(), "20150324").version?.issuedNo).toBe("2015-23")
  })

  it("같은 날 발령이면 발령번호가 큰 것 (숫자 마디로 비교: 2020-12 > 2020-5)", () => {
    const g = parseAdminRuleRows(`<AdmRulSearch>` +
      row("A", "1", NFSC, "20200301", "20200301", "2020-5", "일부개정") +
      row("B", "1", NFSC, "20200301", "20200301", "2020-12", "일부개정") + `</AdmRulSearch>`)
    expect(adminVersionAt(g, "20200401").version?.serial).toBe("B")
  })
})
