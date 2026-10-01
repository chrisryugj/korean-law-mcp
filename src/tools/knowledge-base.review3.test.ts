import { describe, expect, it } from "vitest"
import type { LawApiClient } from "../lib/api-client.js"
import { getLegalTermDetail } from "./knowledge-base.js"

describe("legal term definition text", () => {
  it("decodes observed legal-term entities through the shared HTML cleaner", async () => {
    // Actual lstrm query=채권 definition includes middot/lsquo/rsquo entities.
    const api = { fetchApi: async () => `<LsTrmService><법령용어명_한글>채권</법령용어명_한글>
      <법령용어정의><![CDATA[<p>급부&middot;급여와 &lsquo;지급하라&rsquo;는 청구권.</p>]]></법령용어정의>
      <출처><![CDATA[<span>법령 사전</span>]]></출처></LsTrmService>` } as unknown as LawApiClient
    const result = await getLegalTermDetail(api, { query: "채권" })
    expect(result.content[0].text).toContain("급부·급여와 ‘지급하라’는 청구권.")
    expect(result.content[0].text).toContain("출처: 법령 사전")
    expect(result.content[0].text).not.toContain("<p>")
  })

  it("keeps repeated definitions and each source within its serial-number boundary", async () => {
    // Actual lstrm query=채권 repeats 11 flat records; the first has no 출처.
    const api = { fetchApi: async () => `<LsTrmService>
      <법령용어일련번호>30557</법령용어일련번호><법령용어명_한글>채권</법령용어명_한글>
      <법령용어정의>사전의 채권 정의.</법령용어정의><법령용어코드명>법령용어사전</법령용어코드명>
      <법령용어일련번호>5479286</법령용어일련번호><법령용어명_한글>채권</법령용어명_한글>
      <출처>우체국예금자금운용지침</출처><법령용어정의>지침의 채무증권 정의.</법령용어정의>
    </LsTrmService>` } as unknown as LawApiClient
    const result = await getLegalTermDetail(api, { query: "채권" })
    const text = result.content[0].text
    expect(text).toContain("사전의 채권 정의.")
    expect(text).toContain("지침의 채무증권 정의.")
    expect(text.indexOf("지침의 채무증권 정의.")).toBeLessThan(text.indexOf("출처: 우체국예금자금운용지침"))
  })
})
