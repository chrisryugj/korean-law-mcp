import { describe, expect, it } from "vitest"
import { getExternalLinks } from "./external-links.js"

describe("external law links", () => {
  it("uses the live lsInfoP endpoint and lsId parameter for a stable law ID", async () => {
    const response = await getExternalLinks({ linkType: "law", lawId: "001706" })
    expect(response.content[0].text).toContain("/LSW/lsInfoP.do?lsId=001706")
    expect(response.content[0].text).not.toContain("lsiSeq=001706")
  })

  it("links to the verified English search portal without asserting a translation exists for the Korean ID", async () => {
    const response = await getExternalLinks({ linkType: "law", lawId: "001706" })
    expect(response.content[0].text).toContain("[영문법령 검색](https://www.law.go.kr/LSW/eng/engMain.do)")
    expect(response.content[0].text).not.toContain("/eng/LSW/lawLsInfoP.do")
  })

  it("keeps identifier text inside its own query parameter", async () => {
    const response = await getExternalLinks({ linkType: "precedent", precedentId: "616245&other=1" })
    const link = response.content[0].text.match(/\[법제처 판례 상세\]\(([^)]+)\)/)![1]
    const parsed = new URL(link)
    expect(parsed.searchParams.get("precSeq")).toBe("616245&other=1")
    expect(parsed.searchParams.has("other")).toBe(false)
  })

  it("labels the MST system-tree endpoint as a law system tree", async () => {
    const response = await getExternalLinks({ linkType: "law", mst: "283481" })
    expect(response.content[0].text).toContain("[법령체계도]")
    expect(response.content[0].text).not.toContain("[법령 연혁]")
  })

  it("uses an ordinance detail link when only its sequence is supplied", async () => {
    const response = await getExternalLinks({ linkType: "ordinance", mst: "1234567" })
    expect(response.content[0].text).toContain("/LSW/ordinInfoP.do?ordinSeq=1234567")
    expect(response.content[0].text).not.toContain("lsStmdInfoP.do")
    expect(response.content[0].text).not.toContain("[자치법규 연혁]")
  })

  it("uses the official interpretation detail endpoint and identifier", async () => {
    const response = await getExternalLinks({ linkType: "interpretation", interpretationId: "342457&other=1" })
    const link = response.content[0].text.match(/\[법제처 해석례 상세\]\(([^)]+)\)/)![1]
    const parsed = new URL(link)
    expect(parsed.pathname).toBe("/LSW/expcInfoP.do")
    expect(parsed.searchParams.get("expcSeq")).toBe("342457&other=1")
    expect(parsed.searchParams.has("other")).toBe(false)
  })

  it("uses the official ordinance search page", async () => {
    const response = await getExternalLinks({ linkType: "ordinance", mst: "1234567" })
    expect(response.content[0].text).toContain("[국가법령정보센터 자치법규](https://www.law.go.kr/LSW/ordinSc.do?menuId=3&subMenuId=27&tabMenuId=139)")
    expect(response.content[0].text).not.toContain("lsRvsRqInfoListP.do")
  })
})
