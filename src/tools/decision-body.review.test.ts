import { describe, expect, it } from "vitest"
import { getConstitutionalDecisionText } from "./constitutional-decisions.js"
import { getAdminAppealText } from "./admin-appeals.js"
import { getInterpretationText } from "./interpretations.js"
import { getFtcDecisionText } from "./committee-decisions.js"

describe("wrapped decision JSON fields", () => {
  it.each([
    ["헌재", getConstitutionalDecisionText, "DetcService", "결정내용"],
    ["행정심판", getAdminAppealText, "DeccService", "이유"],
    ["해석례", getInterpretationText, "ExpcService", "회답"],
    ["공정위", getFtcDecisionText, "FtcService", "결정내용"],
  ] as const)("%s retains wrapped metadata and array body content", async (_label, handler, key, field) => {
    const data = {
      사건명: { "#text": "사건 제목" }, 안건명: { "#text": "안건 제목" },
      사건번호: { _: "2024헌바123" },
      [field]: [{ "#text": "첫째 판단." }, { _: "둘째 판단." }],
    }
    const apiClient = { fetchApi: async () => JSON.stringify({ [key]: data }) } as never
    const result = await handler(apiClient, { id: "1", full: true })
    const text = result.content.map(c => c.text).join("\n")
    expect(result.isError).not.toBe(true)
    expect(text).not.toContain("[object Object]")
    expect(text).toContain("첫째 판단.")
    expect(text).toContain("둘째 판단.")
    expect(text).toContain(key === "ExpcService" ? "안건 제목" : "사건 제목")
  })
})
