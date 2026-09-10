import { describe, it, expect } from "vitest"
import { analyzeImageOnlyBody, adminRuleSourceUrl, buildImageOnlyWarning } from "./image-only-body.js"

// 실측 (#159): 낙동강유역환경청 「수질오염물질의 배출허용기준 중 별도배출허용기준」
// 고시 2100000248042 의 <조문내용> — 기준 수치·대상 산단 목록이 전부 이미지다.
const REAL_IMAGE_ONLY = `(단위: ㎎/ℓ)
<img id="144740515">
</img>
<img id="144740517">
</img>
<img id="144740519">
</img>`

describe("이미지-only 본문 판정 (#159)", () => {
  it("실측 고시: 이미지 3개 + 실텍스트 8자를 이미지-only로 판정", () => {
    const r = analyzeImageOnlyBody(REAL_IMAGE_ONLY)
    expect(r.imageCount).toBe(3)
    expect(r.textLength).toBe(8) // "(단위:㎎/ℓ)"
    expect(r.imageOnly).toBe(true)
  })

  it("이미지가 섞여도 본문이 충분하면 경고하지 않는다", () => {
    const body = `제1조(목적) ${"이 고시는 배출허용기준을 정함을 목적으로 한다. ".repeat(6)}<img id="1"></img>`
    const r = analyzeImageOnlyBody(body)
    expect(r.imageCount).toBe(1)
    expect(r.imageOnly).toBe(false)
  })

  it("이미지가 없으면 본문이 짧아도 이미지-only가 아니다", () => {
    expect(analyzeImageOnlyBody("삭제 <2024. 1. 1.>").imageOnly).toBe(false)
  })

  it("자기닫음 <img/> 표기도 센다", () => {
    expect(analyzeImageOnlyBody(`<img id="1"/><img id="2"/>`).imageCount).toBe(2)
  })

  it("경고문에 원문 URL·첨부파일·추측 금지가 함께 실린다", () => {
    const info = analyzeImageOnlyBody(REAL_IMAGE_ONLY)
    const w = buildImageOnlyWarning("2100000248042", info, [
      { name: "별도배출허용기준 지정·고시.pdf", link: "http://law.go.kr/flDownload.do?flSeq=144740485" },
    ])
    expect(w).toContain("이미지로만 제공되어 텍스트 추출 불가")
    expect(w).toContain(adminRuleSourceUrl("2100000248042"))
    expect(w).toContain("flSeq=144740485")
    expect(w).toContain("추측/생성하지 마세요")
  })
})
