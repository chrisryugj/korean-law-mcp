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

  // 도구 응답 본문(URL + 설명문이 섞인 텍스트)에도 적용되므로
  // 값 매칭이 공백/개행을 넘어가면 뒷 문장까지 지워버린다
  it("URL이 섞인 자유 텍스트에서 키만 마스킹하고 뒷 내용은 보존", () => {
    expect(
      maskSensitiveUrl("  링크: /DRF/lawService.do?OC=mysecret&target=prec&ID=64849\n  선고일: 20080724"),
    ).toBe("  링크: /DRF/lawService.do?OC=***&target=prec&ID=64849\n  선고일: 20080724")
  })

  it("키 값이 URL 끝일 때 개행 뒤 본문을 삼키지 않음", () => {
    expect(maskSensitiveUrl("https://x/?OC=mysecret\n제1조 목적")).toBe("https://x/?OC=***\n제1조 목적")
  })
})
