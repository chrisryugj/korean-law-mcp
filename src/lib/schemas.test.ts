import { describe, it, expect } from "vitest"
import { truncateResponse } from "./schemas.js"

// Critical Rule 11 — 도구 응답 본문에도 API 키 마스킹.
// 법제처 검색 API가 돌려주는 *상세링크 필드에는 호출자의 OC 키가 그대로 박혀 있어,
// 마스킹 없이 출력하면 개인 인증키가 대화 로그·공유 세션에 남는다.
// 실제 노출 사례: search_decisions(domain="precedent") 응답의 "링크:" 줄
describe("truncateResponse — API 키 마스킹", () => {
  it("판례 상세링크의 OC 키를 마스킹하고 나머지 파라미터는 보존", () => {
    const out = truncateResponse("  링크: /DRF/lawService.do?OC=a97a52261e68be&target=prec&ID=64849&type=HTML")
    expect(out).not.toContain("a97a52261e68be")
    expect(out).toContain("OC=***")
    expect(out).toContain("target=prec")
    expect(out).toContain("ID=64849")
  })

  it("잘라내기가 일어나지 않는 짧은 응답에도 적용", () => {
    expect(truncateResponse("https://www.law.go.kr/DRF/lawService.do?OC=mysecret")).toBe(
      "https://www.law.go.kr/DRF/lawService.do?OC=***",
    )
  })

  it("키가 없는 본문은 그대로 통과", () => {
    expect(truncateResponse("제1조(목적) 이 법은 ...")).toBe("제1조(목적) 이 법은 ...")
  })

  it("길이 초과로 잘리는 경우에도 마스킹이 유지된다", () => {
    const long = "링크: /DRF/lawService.do?OC=mysecret&target=prec\n" + "가".repeat(500)
    const out = truncateResponse(long, 200)
    expect(out).not.toContain("mysecret")
    expect(out).toContain("OC=***")
  })
})
