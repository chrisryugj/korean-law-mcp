import { describe, expect, it } from "vitest"
import type { LawApiClient } from "../lib/api-client.js"
import { getEnglishLawText } from "./english-law.js"

function apiWith(body: unknown): LawApiClient {
  return { fetchApi: async () => JSON.stringify(body) } as unknown as LawApiClient
}

describe("English law structural headings", () => {
  it("preserves chapter and section headings without labelling them as articles", async () => {
    // Actual elaw MST 248479: headings share joNo with the following article;
    // joYn=N identifies headings, while joYn=Y identifies article records.
    const api = apiWith({ Law: {
      InfSection: { lsNmEng: "CUSTOMS ACT", ancYd: "20230304" },
      JoSection: { Jo: [
        { joNo: "0001", joYn: "N", joCts: "CHAPTER I GENERAL PROVISIONS", chapNo: "00000100000000000000", No: "1", joBrNo: "00" },
        { joNo: "0001", joYn: "N", joCts: "SECTION 1 Common Provisions", chapNo: "00000100010000000000", No: "2", joBrNo: "00" },
        { joNo: "0001", joYn: "Y", joTtl: "Purpose", joCts: "Article 1 (Purpose) The purpose of this Act is to properly administer customs duties.", No: "3", joBrNo: "00" },
      ] },
    } })
    const result = await getEnglishLawText(api, { mst: "248479" })
    const text = result.content[0].text
    expect(result.isError).not.toBe(true)
    expect(text).toContain("Articles:\n\nCHAPTER I GENERAL PROVISIONS\n\nSECTION 1 Common Provisions\n\nArticle 0001\nArticle 1 (Purpose)")
    expect(text.match(/^Article 0001$/gm)).toHaveLength(1)
    expect(text).toContain("Effective Date: N/A")
    expect(text).toContain("Promulgation Date: 20230304")
  })

  it("preserves a wrapped single heading title and content", async () => {
    const api = apiWith({ Law: { JoSection: { Jo: {
      joNo: "0001", joYn: { "#text": "N" },
      조문제목_영문: { "#text": "PART I" },
      joCts: [{ "#text": "CHAPTER I GENERAL PROVISIONS" }, { _: "SECTION 1 Common Provisions" }],
    } } } })
    const result = await getEnglishLawText(api, { mst: "1" })
    const text = result.content[0].text
    expect(text).toContain("PART I\nCHAPTER I GENERAL PROVISIONS")
    expect(text).toContain("SECTION 1 Common Provisions")
    expect(text).not.toContain("Article 0001")
    expect(text).not.toContain("[object Object]")
  })
})
