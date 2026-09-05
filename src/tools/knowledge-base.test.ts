import { describe, it, expect } from "vitest"
import { getRelatedLaws, getTermArticles, getDailyToLegal, getLegalToDaily } from "./knowledge-base.js"
import type { LawApiClient } from "../lib/api-client.js"

// 실측 응답 축약. 조회링크 필드는 인증키(OC)가 박혀 있고 파싱 대상도 아니라 뺐다.
//
// 세 응답 모두 항목이 한글 래퍼(<관련법령>/<연계법령>/<연계용어>)에 들어 있고,
// <검색결과개수>는 기준 법령·기준 용어의 개수(=1)이지 연계 항목 수가 아니다.

// lawSearch.do?target=lsRlt&query=건축법
const RELATED_LAWS_XML = `<?xml version="1.0" encoding="UTF-8"?><lsRltSearch><target>lsRlt</target><키워드>건축법</키워드><검색결과개수>1</검색결과개수>
<법령 id="1"><기준법령ID>001766</기준법령ID><기준법령명><![CDATA[건축법]]></기준법령명>
<관련법령 id="1"><관련법령ID>010594</관련법령ID><관련법령명><![CDATA[건축기본법]]></관련법령명><법령간관계코드>140503</법령간관계코드><법령간관계>3유형(기본법)</법령간관계></관련법령>
<관련법령 id="2"><관련법령ID>001767</관련법령ID><관련법령명><![CDATA[건축법 시행령]]></관련법령명><법령간관계코드>140506</법령간관계코드><법령간관계>6유형(하위법)</법령간관계></관련법령>
<관련법령 id="3"><관련법령ID>001768</관련법령ID><관련법령명><![CDATA[건축법 시행규칙]]></관련법령명><법령간관계코드>140506</법령간관계코드><법령간관계>6유형(하위법)</법령간관계></관련법령>
</법령></lsRltSearch>`

// lawService.do?target=lstrmRltJo&query=임대차
// 조문제목 필드가 따로 없어 조문내용 머리에서 뽑는다. 농지법은 제24조와 제24조의2가 나란히 온다.
const TERM_ARTICLES_XML = `<?xml version="1.0" encoding="UTF-8"?><lstrmRltJoService><target>lstrmRltJo</target><키워드>임대차</키워드><검색결과개수>1</검색결과개수>
<법령용어 id="1"><법령용어명>임대차</법령용어명>
<연계법령 id="1"><법령명><![CDATA[농어촌정비법]]></법령명><조번호>0085</조번호><조가지번호>00</조가지번호><조문내용><![CDATA[제85조(농어촌관광휴양지사업자의 신고 등) ① 농어촌 관광휴양단지사업은 …]]></조문내용><용어구분>핵심용어</용어구분></연계법령>
<연계법령 id="2"><법령명><![CDATA[농지법]]></법령명><조번호>0024</조번호><조가지번호>00</조가지번호><조문내용><![CDATA[제24조(임대차ㆍ사용대차 계약 방법과 확인) ① 임대차계약과 사용대차계약은 …]]></조문내용><용어구분>핵심용어</용어구분></연계법령>
<연계법령 id="3"><법령명><![CDATA[농지법]]></법령명><조번호>0024</조번호><조가지번호>02</조가지번호><조문내용><![CDATA[제24조의2(임대차 기간) ① 제23조제1항 각 호(제8호는 제외한다)의 임대차 기간은 3년 이상으로 하여야 한다. …]]></조문내용><용어구분>핵심용어</용어구분></연계법령>
</법령용어></lstrmRltJoService>`

// lawService.do?target=lstrmRlt&query=임대차
const RELATED_TERMS_XML = `<?xml version="1.0" encoding="UTF-8"?><lstrmRltService><target>lstrmRlt</target><키워드>임대차</키워드><검색결과개수>1</검색결과개수>
<법령용어 id="1"><법령용어명>임대차</법령용어명>
<연계용어 id="1"><일상용어명><![CDATA[반전세]]></일상용어명><용어관계코드>140305</용어관계코드><용어관계>연관어</용어관계></연계용어>
<연계용어 id="2"><일상용어명><![CDATA[월세]]></일상용어명><용어관계코드>140305</용어관계코드><용어관계>연관어</용어관계></연계용어>
</법령용어></lstrmRltService>`

// 오타 target에 대한 법제처 응답. HTTP 200 + 빈 본문이라 예외가 안 난다.
const EMPTY_BODY = ""

type FetchArgs = Parameters<LawApiClient["fetchApi"]>[0]

/** fetchApi 호출 인자를 잡아 두는 스텁 — target/endpoint 회귀를 막는 것이 목적 */
function recordingStub(xml: string) {
  const calls: FetchArgs[] = []
  const client = {
    fetchApi: async (options: FetchArgs) => {
      calls.push(options)
      return xml
    },
  } as unknown as LawApiClient
  return { client, calls }
}

describe("지식베이스 연계 도구의 법제처 target (#428)", () => {
  it("get_related_laws는 lawSearch.do의 lsRlt를 부른다", async () => {
    const { client, calls } = recordingStub(RELATED_LAWS_XML)
    await getRelatedLaws(client, { lawName: "건축법", display: 20 })

    expect(calls[0].endpoint).toBe("lawSearch.do")
    expect(calls[0].target).toBe("lsRlt")
  })

  it("get_term_articles는 lawService.do의 lstrmRltJo를 부른다", async () => {
    const { client, calls } = recordingStub(TERM_ARTICLES_XML)
    await getTermArticles(client, { term: "임대차", display: 20 })

    expect(calls[0].endpoint).toBe("lawService.do")
    expect(calls[0].target).toBe("lstrmRltJo")
  })

  it("용어 연계 두 도구는 lawService.do의 lstrmRlt를 부른다", async () => {
    const daily = recordingStub(RELATED_TERMS_XML)
    await getDailyToLegal(daily.client, { dailyTerm: "월세" })
    const legal = recordingStub(RELATED_TERMS_XML)
    await getLegalToDaily(legal.client, { legalTerm: "임대차" })

    for (const calls of [daily.calls, legal.calls]) {
      expect(calls[0].endpoint).toBe("lawService.do")
      expect(calls[0].target).toBe("lstrmRlt")
    }
  })

  it("lstrmRlt에 없는 relType은 보내지 않는다", async () => {
    const { client, calls } = recordingStub(RELATED_TERMS_XML)
    await getDailyToLegal(client, { dailyTerm: "월세" })

    expect(calls[0].extraParams).not.toHaveProperty("relType")
  })
})

describe("지식베이스 연계 응답 파싱", () => {
  it("관련법령을 한글 래퍼에서 읽고 관계유형·법령ID를 함께 낸다", async () => {
    const { client } = recordingStub(RELATED_LAWS_XML)
    const r = await getRelatedLaws(client, { lawName: "건축법", display: 20 })

    expect(r.isError).toBeUndefined()
    const text = r.content[0].text
    expect(text).toContain("관련법령 (3건)")
    expect(text).toContain("건축기본법")
    expect(text).toContain("3유형(기본법)")
    expect(text).toContain("010594")
  })

  it("연계 항목 수를 총건수로 쓴다 — <검색결과개수>는 기준 법령 개수(1)다", async () => {
    const { client } = recordingStub(RELATED_LAWS_XML)
    const r = await getRelatedLaws(client, { lawName: "건축법", display: 20 })

    expect(r.content[0].text).not.toContain("관련법령 (1건)")
  })

  it("가지번호 조문은 제24조의2로 적는다 (제24의2조 아님)", async () => {
    const { client } = recordingStub(TERM_ARTICLES_XML)
    const r = await getTermArticles(client, { term: "임대차", display: 20 })

    const text = r.content[0].text
    expect(text).toContain("제24조의2 (임대차 기간)")
    expect(text).not.toContain("제24의2조")
    // 가지번호 없는 조문은 종전대로
    expect(text).toContain("제85조 (농어촌관광휴양지사업자의 신고 등)")
  })

  it("lawService.do가 display를 무시하므로 건수는 파서에서 자른다", async () => {
    const { client, calls } = recordingStub(TERM_ARTICLES_XML)
    const r = await getTermArticles(client, { term: "임대차", display: 2 })

    expect(calls[0].extraParams).not.toHaveProperty("display")
    expect(r.content[0].text).toContain("(2건)")
    expect(r.content[0].text).not.toContain("제24조의2")
  })

  it("연계용어를 읽어 양방향 연계를 낸다", async () => {
    const daily = recordingStub(RELATED_TERMS_XML)
    const dailyResult = await getDailyToLegal(daily.client, { dailyTerm: "월세" })
    expect(dailyResult.content[0].text).toContain("반전세")

    const legal = recordingStub(RELATED_TERMS_XML)
    const legalResult = await getLegalToDaily(legal.client, { legalTerm: "임대차" })
    expect(legalResult.content[0].text).toContain("월세")
  })
})

describe("오타 target의 빈 본문 (HTTP 200 + 0바이트)", () => {
  it("get_related_laws는 예외 없이 NOT_FOUND로 끝난다", async () => {
    const { client } = recordingStub(EMPTY_BODY)
    const r = await getRelatedLaws(client, { lawName: "건축법", display: 20 })

    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain("[NOT_FOUND]")
  })

  it("get_term_articles는 예외 없이 NOT_FOUND로 끝난다", async () => {
    const { client } = recordingStub(EMPTY_BODY)
    const r = await getTermArticles(client, { term: "임대차", display: 20 })

    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain("[NOT_FOUND]")
  })
})
