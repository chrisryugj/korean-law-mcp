import { describe, it, expect } from "vitest"
import { searchEnglishLaw } from "./english-law.js"
import type { LawApiClient } from "../lib/api-client.js"

// 2026-09-23 리뷰 D9: 실측 영문법령 검색(target=elaw, query=Customs) 응답 원문(OC만 치환).
// 법령명영문에 검색어 하이라이트 태그가 그대로 실려 온다.
const ELAW_SEARCH_XML =
  `<?xml version="1.0" encoding="UTF-8"?><LawSearch><target>elaw</target><키워드>Customs</키워드><section>lawNm</section>` +
  `<totalCnt>10</totalCnt><page>1</page><law id="1"><법령일련번호>248479</법령일련번호><현행연혁코드>연혁</현행연혁코드>` +
  `<법령명한글>관세법</법령명한글><법령명영문><strong class="tbl_tx_type">CUSTOMS</strong> ACT</법령명영문>` +
  `<법령ID>001556</법령ID><공포일자>20230304</공포일자><공포번호>19228</공포번호><제개정구분명>타법개정</제개정구분명>` +
  `<소관부처명>재정경제부</소관부처명><법령구분명>법률</법령구분명><시행일자>20230304</시행일자>` +
  `<법령상세링크>/DRF/lawService.do?OC=test&amp;target=elaw&amp;MST=248479&amp;type=HTML</법령상세링크></law></LawSearch>`

describe("searchEnglishLaw: 영문명 하이라이트 태그 제거 (D9)", () => {
  it("법령명영문의 <strong> 하이라이트를 벗겨 순수 영문명을 낸다", async () => {
    const client = { fetchApi: async () => ELAW_SEARCH_XML } as unknown as LawApiClient
    const r = await searchEnglishLaw(client, { query: "Customs", display: 20, page: 1 })
    const text = r.content[0].text
    expect(r.isError).toBeFalsy()
    expect(text).toContain("[001556] CUSTOMS ACT")
    expect(text).not.toContain("<strong")
    expect(text).toContain("한글명: 관세법")
  })
})
