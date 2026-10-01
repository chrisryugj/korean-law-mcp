import { describe, expect, it } from "vitest"
import type { LawApiClient } from "../lib/api-client.js"
import { getPublicCorpRuleText, getPublicInstitutionRuleText, getSchoolRuleText } from "./institutional-rules.js"

describe("기관 규정 상세 실응답 구조", () => {
  it.each([["학칙", getSchoolRuleText], ["공사공단", getPublicCorpRuleText], ["공공기관", getPublicInstitutionRuleText]] as const)(
    "%s 행정규칙기본정보와 본문을 함께 보존한다", async (_label, handler) => {
      const api = { fetchApi: async () => JSON.stringify({ AdmRulService: {
        행정규칙기본정보: { 행정규칙명: { "#text": "인사규정" }, 소관부처명: "테스트 기관", 발령일자: "20260101", 시행일자: "20260201" },
        조문내용: "제1조 이 규정은 기관의 인사에 관한 사항을 정한다.",
      } }) } as unknown as LawApiClient
      const result = await handler(api, { id: "1" })
      const text = result.content[0].text
      expect(result.isError).toBeFalsy()
      for (const value of ["=== 인사규정 ===", "테스트 기관", "20260101", "20260201", "기관의 인사"]) expect(text).toContain(value)
    })
})
