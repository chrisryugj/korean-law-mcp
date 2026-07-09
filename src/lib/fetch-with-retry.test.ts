import { describe, it, expect } from "vitest"
import { maskSensitiveUrl } from "./fetch-with-retry.js"

// Critical Rule 11: URL/에러 메시지 외부 노출 전 API 키 마스킹 (회귀 시 키 유출)
describe("maskSensitiveUrl — API 키 마스킹", () => {
  it("법제처 OC 키를 *** 처리 (다른 파라미터는 보존)", () => {
    expect(
      maskSensitiveUrl("http://www.law.go.kr/DRF/lawService.do?OC=mysecret&target=law&MST=160001"),
    ).toBe("http://www.law.go.kr/DRF/lawService.do?OC=***&target=law&MST=160001")
  })
  it("소문자 oc 및 흔한 키 파라미터 이름들도 마스킹", () => {
    expect(maskSensitiveUrl("https://x/?oc=k")).toBe("https://x/?oc=***")
    expect(maskSensitiveUrl("https://x/?apiKey=abc&q=1")).toBe("https://x/?apiKey=***&q=1")
    expect(maskSensitiveUrl("https://x/?auth_key=abc")).toBe("https://x/?auth_key=***")
  })
  it("키가 없으면 원본 그대로", () => {
    expect(maskSensitiveUrl("https://www.law.go.kr/DRF/lawSearch.do?query=민법")).toBe(
      "https://www.law.go.kr/DRF/lawSearch.do?query=민법",
    )
  })
  it("빈 문자열은 안전하게 통과", () => {
    expect(maskSensitiveUrl("")).toBe("")
  })
})
