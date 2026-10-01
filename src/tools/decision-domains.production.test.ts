import { describe, expect, it, vi } from "vitest"
import { getDecisionText } from "./unified-decisions.js"
import type { LawApiClient } from "../lib/api-client.js"

describe("remaining decision domains: wrapped bodies", () => {
  it.each([
    ["tax_tribunal", "SpecialDeccService", "사건명", "이유"],
    ["customs", "CgmExpcService", "안건명", "이유"],
    ["appeal_review", "SpecialDeccService", "사건명", "이유"],
    ["acr_special", "SpecialDeccService", "사건명", "이유"],
    ["school", "AdmRulService", "학칙명", "본문"],
    ["public_corp", "AdmRulService", "규정명", "본문"],
    ["public_inst", "AdmRulService", "규정명", "본문"],
  ] as const)("%s retains wrapped title and all body paragraphs", async (domain, root, title, body) => {
    const fetchApi = vi.fn(async () => JSON.stringify({ [root]: {
      [title]: { "#text": "검증 제목" },
      [body]: [{ "#text": "첫째 판단." }, { _: "둘째 판단." }],
    } }))
    const result = await getDecisionText({ fetchApi } as unknown as LawApiClient, { domain, id: "1", full: true })
    expect(result.isError).not.toBe(true)
    const text = result.content[0].text
    expect(text).toContain("검증 제목")
    expect(text).toContain("첫째 판단.")
    expect(text).toContain("둘째 판단.")
    expect(text).not.toContain("[object Object]")
  })

  it("treaty preserves array body and wrapped metadata", async () => {
    const fetchApi = async () => JSON.stringify({ MultTrtyService: {
      조약기본정보: { 조약명_한글: { "#text": "검증 조약" } },
      조약내용: { 조약내용: [{ "#text": "제1조 본문." }, { _: "제2조 본문." }] },
    } })
    const result = await getDecisionText({ fetchApi } as unknown as LawApiClient, { domain: "treaty", id: "1", full: true })
    expect(result.content[0].text).toContain("검증 조약")
    expect(result.content[0].text).toContain("제2조 본문.")
    expect(result.content[0].text).not.toContain("[object Object]")
  })

  it("English law preserves a single legacy article with array content", async () => {
    const fetchApi = async () => JSON.stringify({ ElawService: {
      영문법령명: { "#text": "TEST ACT" },
      조문: { 조문번호: "1", 조문내용_영문: [{ "#text": "First paragraph." }, { _: "Second paragraph." }] },
    } })
    const result = await getDecisionText({ fetchApi } as unknown as LawApiClient, { domain: "english_law", id: "1", full: true })
    expect(result.content[0].text).toContain("TEST ACT")
    expect(result.content[0].text).toContain("Article 1")
    expect(result.content[0].text).toContain("Second paragraph.")
    expect(result.content[0].text).not.toContain("[object Object]")
  })

  it("options cannot replace the English law ID selected by the caller", async () => {
    const fetchApi = vi.fn(async () => JSON.stringify({ ElawService: { 영문법령명: "TEST ACT" } }))
    await getDecisionText({ fetchApi } as unknown as LawApiClient, {
      domain: "english_law", id: "001706", options: { lawId: "999999" },
    })
    expect(fetchApi.mock.calls[0]?.[0]).toMatchObject({ extraParams: { ID: "001706" } })
  })

  it("does not use an English law promulgation date as its effective date", async () => {
    // Actual elaw MST 248479 exposes InfSection.ancYd without an effective date.
    const fetchApi = async () => JSON.stringify({ Law: { InfSection: { lsNmEng: "CUSTOMS ACT", ancYd: "20230304" } } })
    const result = await getDecisionText({ fetchApi } as unknown as LawApiClient, { domain: "english_law", id: "001556", full: true })
    expect(result.content[0].text).toContain("Effective Date: N/A")
    expect(result.content[0].text).toContain("Promulgation Date: 20230304")
  })
})
