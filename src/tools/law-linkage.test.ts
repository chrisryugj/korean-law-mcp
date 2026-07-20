import { describe, it, expect } from "vitest"
import { getDelegatedLaws, getLinkedLawsFromOrdinance } from "./law-linkage.js"
import type { LawApiClient } from "../lib/api-client.js"

// 실측 응답 축약: lnkDep의 루트는 소문자 시작 lnkDepSearch, 항목 태그는 law.
// 종전 코드는 LawSearch→LnkDepSearch(대문자)만 시도해 매 호출 0건이었다.
const LNKDEP_XML = `<?xml version="1.0" encoding="UTF-8"?><lnkDepSearch><target>lnkDep</target><section>lsNm</section><totalCnt>107792</totalCnt><page>1</page>
<law id="1"><법령명한글>119구조ㆍ구급에 관한 법률 시행령</법령명한글><법령ID>011452</법령ID><자치법규명><![CDATA[강원특별자치도 119구급상황관리센터 설치 및 운영 규칙]]></자치법규명><자치법규ID>2161837</자치법규ID><공포일자>20250605</공포일자></law>
<law id="2"><법령명한글>관세법 시행령</법령명한글><법령ID>001590</법령ID><자치법규명><![CDATA[부산광역시 보세구역 운영 조례]]></자치법규명><자치법규ID>999001</자치법규ID><공포일자>20240101</공포일자></law>
</lnkDepSearch>`

const LNKORD_XML = `<?xml version="1.0" encoding="UTF-8"?><OrdinSearch><totalCnt>7</totalCnt><page>1</page>
<law id="1"><자치법규명><![CDATA[서울특별시 경관 조례]]></자치법규명><법령명한글>경관법</법령명한글><법령ID>009682</법령ID></law>
</OrdinSearch>`

const stub = (xml: string) => ({ fetchApi: async () => xml }) as unknown as LawApiClient

describe("law-linkage — 루트 태그 실형상 파싱 부활", () => {
  it("lnkDep: 소문자 루트(lnkDepSearch)를 파싱하고 페이지 내 클라이언트 필터+한계 명시", async () => {
    const r = await getDelegatedLaws(stub(LNKDEP_XML), { query: "관세법", display: 20, page: 1 })
    const t = r.content[0].text
    expect(r.isError).toBeUndefined()
    expect(t).toContain("관세법 시행령")           // 매칭 행만
    expect(t).not.toContain("119구조")             // 무관 행 제외
    expect(t).toContain("매칭 1건")
    expect(t).toContain("검색 필터를 지원하지 않아")  // 전수 아님 명시
    expect(t).toContain("get_linked_ordinances")     // 대안 유도
  })

  it("lnkDep: 페이지 내 매칭 0건이어도 부재 단정 대신 범위 한계 안내", async () => {
    const r = await getDelegatedLaws(stub(LNKDEP_XML), { query: "소득세법", display: 20, page: 1 })
    const t = r.content[0].text
    expect(r.isError).toBe(true)
    expect(t).toContain("매칭 없음")
    expect(t).toContain("전수 결과가 아닙니다")
  })

  it("lnkOrd: 실측 루트 OrdinSearch 파싱 (종전 LnkOrdSearch 가정으로 0건)", async () => {
    const r = await getLinkedLawsFromOrdinance(stub(LNKORD_XML), { query: "서울특별시 경관 조례", display: 20, page: 1 })
    expect(r.isError).toBeUndefined()
    expect(r.content[0].text).toContain("경관법")
  })
})
