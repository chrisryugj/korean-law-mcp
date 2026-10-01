import { describe, expect, it } from "vitest"
import type { LawApiClient } from "../lib/api-client.js"
import { getDecisionText } from "./unified-decisions.js"

describe("special appeal legal grounds", () => {
  it("preserves 관계법령 from actual acrSpecialDecc records", async () => {
    // acrSpecialDecc ID 2071453 has 관계법령, not 관련법령.
    const api = { fetchApi: async () => JSON.stringify({ SpecialDeccService: {
      사건명: "정산보험료부과처분취소청구", 사건번호: "제24-위-000033호",
      이유: "이 처분의 적법성을 검토한다.",
      관계법령: [{ "#text": "국민건강보험법 제70조" }, { _: "국민건강보험법 시행령 제35조" }],
    } }) } as unknown as LawApiClient
    const response = await getDecisionText(api, { domain: "acr_special", id: "2071453", full: true })
    expect(response.isError).toBeFalsy()
    expect(response.content[0].text).toContain("국민건강보험법 제70조")
    expect(response.content[0].text).toContain("국민건강보험법 시행령 제35조")
  })
})
