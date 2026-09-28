import { describe, it, expect } from "vitest"
import {
  lawNameCandidates,
  lawNameFromCitationContext,
  resolveLawAnaphora,
  parseCitations,
  verifyCitations,
} from "./verify-citations.js"
import type { LawApiClient } from "../lib/api-client.js"

describe("lawNameFromCitationContext — 인용 직전 문맥에서 법령명 추출", () => {
  // 회귀: 「법령명」 제N조 는 법제처·판결문·실무 문서의 표준 표기인데, 닫는 낫표가
  // LAW_NAME_REGEX의 $ 앵커를 막아 법령명이 전혀 추출되지 않았다. 그 결과 조문 실존
  // 검증에 진입하지 못해 없는 조문·없는 항조차 ✗로 잡히지 않았다(환각 탐지 미가동).
  it("낫표로 감싼 표준 표기에서 법령명을 추출한다", () => {
    expect(lawNameFromCitationContext("「식품 등의 표시·광고에 관한 법률」 ")).toBe("식품 등의 표시·광고에 관한 법률")
    expect(lawNameFromCitationContext("이 사건에는 「형법」")).toBe("형법")
    expect(lawNameFromCitationContext("『민법』")).toBe("민법")
  })

  it("낫표 없는 평문은 종전대로 추출 (#55 동작 유지)", () => {
    expect(lawNameFromCitationContext("절도죄는 형법")).toBe("절도죄는 형법")
    expect(lawNameFromCitationContext("전자상거래 등에서의 소비자보호에 관한 법률")).toBe(
      "전자상거래 등에서의 소비자보호에 관한 법률"
    )
  })

  it("접속사·부사 수식어는 제거", () => {
    expect(lawNameFromCitationContext("또한 상법")).toBe("상법")
  })

  it("법령명이 없으면 undefined", () => {
    expect(lawNameFromCitationContext("계약서에 따라")).toBeUndefined()
    expect(lawNameFromCitationContext("")).toBeUndefined()
  })
})

describe("lawNameCandidates", () => {
  it("법령명 직전 캡처(수식어 없음)는 후보 1개", () => {
    expect(lawNameCandidates("형법")).toEqual(["형법"])
  })

  it("앞 수식어가 붙으면 전체→축약 순으로 후보 생성 (#55)", () => {
    expect(lawNameCandidates("절도죄는 형법")).toEqual(["절도죄는 형법", "형법"])
    expect(lawNameCandidates("이혼시 재산분할은 민법")).toEqual([
      "이혼시 재산분할은 민법",
      "재산분할은 민법",
      "민법",
    ])
  })

  it("다어절 법령명은 전체 후보가 먼저 와서 보존된다", () => {
    const cands = lawNameCandidates("전자상거래 등에서의 소비자보호에 관한 법률")
    expect(cands[0]).toBe("전자상거래 등에서의 소비자보호에 관한 법률")
  })

  it("2자 미만 후보는 제외", () => {
    // 마지막 어절이 1자면 후보에서 빠지고, 유효 후보가 없으면 원문 유지
    expect(lawNameCandidates("가 나")).toEqual(["가 나"])
  })

  // 회귀(#70): 앞 어절을 다 떼면 "시행규칙"·"법 시행규칙" 처럼 접미사만 남는 후보가 생기는데,
  // 이것들은 그 자체로 법령명이 될 수 없고 검색에 넣으면 무관한 법령을 물어온다
  // (관측: "시행규칙" → '119긴급신고의 관리 및 운영에 관한 법률 시행규칙').
  it("접미사뿐인 후보는 만들지 않는다", () => {
    expect(lawNameCandidates("같은 법 시행규칙")).toEqual(["같은 법 시행규칙"])
    expect(lawNameCandidates("노인장기요양보험법 시행규칙")).toEqual(["노인장기요양보험법 시행규칙"])
    expect(lawNameCandidates("전자상거래 등에서의 소비자보호에 관한 법률")).not.toContain("법률")
  })

  it("캡처가 접미사뿐이면 후보 없음 — 모른다고 하는 게 무관 법령보다 낫다", () => {
    expect(lawNameCandidates("시행규칙")).toEqual([])
    expect(lawNameCandidates("법 시행규칙")).toEqual([])
    expect(lawNameCandidates("법률")).toEqual([])
  })
})

describe("resolveLawAnaphora — '같은 법'·'동법' 조응 해소 (#70)", () => {
  it("선행 법령명을 승계하고 접미사를 붙인다", () => {
    expect(resolveLawAnaphora("같은 법 시행규칙", "노인장기요양보험법")).toBe(
      "노인장기요양보험법 시행규칙"
    )
    expect(resolveLawAnaphora("동법 시행령", "관세법")).toBe("관세법 시행령")
    expect(resolveLawAnaphora("같은 법", "형법")).toBe("형법")
    expect(resolveLawAnaphora("같은 법률", "상법")).toBe("상법")
  })

  it("선행 법령명이 시행령·시행규칙이면 모법으로 되돌린 뒤 붙인다", () => {
    expect(resolveLawAnaphora("같은 법 시행규칙", "노인장기요양보험법 시행령")).toBe(
      "노인장기요양보험법 시행규칙"
    )
  })

  it("선행 법령명이 없으면 해소 불가 — 법령명 미상이 정직한 답", () => {
    expect(resolveLawAnaphora("같은 법 시행규칙", undefined)).toBeUndefined()
  })

  it("조응이 아닌 법령명은 그대로 통과 ('노동법'처럼 '동'으로 시작해도 건드리지 않음)", () => {
    expect(resolveLawAnaphora("형법", "민법")).toBe("형법")
    expect(resolveLawAnaphora("노동법", "민법")).toBe("노동법")
    expect(resolveLawAnaphora("협동조합기본법", undefined)).toBe("협동조합기본법")
  })
})

describe("parseCitations — 조응 인용의 법령명 승계 (#70)", () => {
  it("「A법」 제N조 및 같은 법 시행규칙 제M조 를 둘 다 해소한다", () => {
    const cites = parseCitations(
      "「노인장기요양보험법」 제38조제1항 및 같은 법 시행규칙 제30조에 따라 장기요양급여비용을 청구합니다.",
      15
    )
    expect(cites.map((c) => c.lawName)).toEqual([
      "노인장기요양보험법",
      "노인장기요양보험법 시행규칙",
    ])
  })

  it("문단이 바뀌면 승계하지 않는다 — 무관 법령을 근거로 판정하는 게 더 나쁘다", () => {
    const cites = parseCitations("「형법」 제250조\n\n같은 법 시행령 제3조", 15)
    expect(cites[0].lawName).toBe("형법")
    expect(cites[1].lawName).toBeUndefined()
  })

  it("선행 법령명 없이 '같은 법'만 있으면 법령명 미상", () => {
    const cites = parseCitations("같은 법 시행규칙 제30조에 따라 청구한다.", 15)
    expect(cites[0].lawName).toBeUndefined()
  })
})

describe("법령명 추출 — 가운뎃점 변형 (#75 후속)", () => {
  // looseMatch 정규화는 5종을 흡수하는데 추출 정규식이 2종만 통과시켜, U+2027 등으로
  // 표기된 법령명이 '광고에 관한 법률'로 절단 추출돼 조문 검증에 진입조차 못 했다.
  const 표기 = { "U+00B7": "·", "U+318D": "ㆍ", "U+2027": "‧", "U+2022": "•", "U+30FB": "・" }
  for (const [name, ch] of Object.entries(표기)) {
    it(`${name} 표기의 법령명을 온전히 추출한다`, () => {
      const cites = parseCitations(`「식품 등의 표시${ch}광고에 관한 법률」 제8조에 따라`, 15)
      expect(cites[0].lawName).toBe(`식품 등의 표시${ch}광고에 관한 법률`)
    })
  }
})

describe("'같은 법' 조응 — 문단 경계 이후", () => {
  // 경계로 승계가 거부돼도 antecedent를 남겨두면, 같은 단락의 두 번째 조응부터는
  // 검사 구간(직전 인용~현재)에 빈 줄이 없어 이전 문단의 법령명을 물려받았다.
  // 그 결과 '형법 시행령'(비실존)이 만들어져 ✗ 환각으로 오탐된다.
  it("문단이 바뀐 뒤 연속된 조응 모두 승계하지 않는다", () => {
    const cites = parseCitations(
      "「형법」 제250조에 따른다.\n\n같은 법 시행령 제3조와 같은 법 시행령 제4조를 본다.",
      15
    )
    expect(cites[0].lawName).toBe("형법")
    expect(cites[1].lawName).toBeUndefined()
    expect(cites[2].lawName).toBeUndefined()
  })

  it("같은 문단 안에서는 종전대로 승계한다", () => {
    const cites = parseCitations("「형법」 제250조와 같은 법 제251조를 본다.", 15)
    expect(cites[0].lawName).toBe("형법")
    expect(cites[1].lawName).toBe("형법")
  })
})

describe("verifyCitations — 판례 인용 검증 범위 (#93)", () => {
  const CIVIL_LAW_XML = `<?xml version="1.0" encoding="UTF-8"?><LawSearch><totalCnt>1</totalCnt>` +
    `<law id="1"><법령일련번호>284415</법령일련번호><법령명한글><![CDATA[민법]]></법령명한글>` +
    `<법령ID>001706</법령ID><법령구분명>법률</법령구분명></law></LawSearch>`

  // 제999조의9는 없고 제1조~제1118조만 있는 응답
  const LAW_JSON = JSON.stringify({
    법령: { 조문: { 조문단위: [
      { 조문여부: "조문", 조문번호: "1", 조문가지번호: "0", 조문제목: "법원" },
      { 조문여부: "조문", 조문번호: "1118", 조문가지번호: "0", 조문제목: "준용규정" },
    ] } },
  })
  const EMPTY_PREC = `<?xml version="1.0" encoding="UTF-8"?><PrecSearch><totalCnt>0</totalCnt><page>1</page></PrecSearch>`

  function client(): LawApiClient {
    return {
      searchLaw: async () => CIVIL_LAW_XML,
      getLawText: async () => LAW_JSON,
      fetchApi: async () => EMPTY_PREC,
    } as unknown as LawApiClient
  }

  it("법령 인용과 함께 사건번호 인용도 검증 대상에 넣는다", async () => {
    const r = await verifyCitations(client(), {
      text: "민법 제999조의9와 대법원 2099다99999 판결에 따르면 가능하다.",
      maxCitations: 15,
    })
    expect(r.content[0].text).toContain("2099다99999")
  })

  it("검증 범위(법령 N건 / 판례 M건)를 헤더에 명시한다", async () => {
    const r = await verifyCitations(client(), {
      text: "민법 제999조의9와 대법원 2099다99999 판결에 따르면 가능하다.",
      maxCitations: 15,
    })
    const text = r.content[0].text
    expect(text).toMatch(/판례 인용 1건/)
    expect(text).toMatch(/법령 인용 1건/)
  })

  it("업스트림 미검색은 부존재 단정이 아니라 '미확인'으로 표기한다", async () => {
    const r = await verifyCitations(client(), {
      text: "대법원 2013다61381 판결 참조.",
      maxCitations: 15,
    })
    const text = r.content[0].text
    expect(text).toContain("미확인")
    expect(text).not.toContain("[HALLUCINATION_DETECTED]")
  })
})

describe("인용 법령명 추출·후보 (2026-09-28 성능 감사)", () => {
  it("앞 인용의 꼬리를 법령명으로 삼키지 않는다 ('민법 제751조와 민법 제756조')", () => {
    const cites = parseCitations("민법 제751조와 민법 제756조에 따라", 10)
    expect(cites.map(c => c.lawName)).toEqual(["민법", "민법"])
  })
})

describe("꼬리 후보 거르기가 실존 법령을 떨어뜨리지 않는다 (2026-09-28 리뷰)", () => {
  it("'구 독립유공자예우에 관한 법률 제4조' → 조사로 끝나는 첫 어절 후보도 검색해 ✓", async () => {
    const LAW = "독립유공자예우에 관한 법률"
    const client = {
      searchLaw: async (q: string) => q.replace(/\s/g, "") === LAW.replace(/\s/g, "")
        ? `<LawSearch><law id="1"><법령일련번호>1</법령일련번호><법령명한글><![CDATA[${LAW}]]></법령명한글><법령ID>1</법령ID><법령구분명>법률</법령구분명></law></LawSearch>`
        : `<LawSearch></LawSearch>`,
      getLawText: async () => JSON.stringify({ 법령: { 조문: { 조문단위: [{ 조문여부: "조문", 조문번호: "4", 조문제목: "적용 대상자" }] } } }),
      fetchApi: async () => `<LawSearch></LawSearch>`,
    } as unknown as LawApiClient
    const text = (await verifyCitations(client, { text: "구 독립유공자예우에 관한 법률 제4조", maxCitations: 5 })).content[0].text
    expect(text).toContain(`✓ ${LAW} 제4조`)
    expect(text).not.toContain("HALLUCINATION")
  })
})
