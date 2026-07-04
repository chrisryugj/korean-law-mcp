import { describe, it, expect } from "vitest"
import { parseAntibotUrl } from "./law-antibot.js"

describe("parseAntibotUrl", () => {
  it("패턴 A(concat) — t+h+o 조합으로 리다이렉트 경로 복원", () => {
    const html = `<script>var x={t:'/DRF',h:'/lawService.do',o:'?OC=test&target=law'};location.assign(x.t+x.h+x.o);</script>`
    expect(parseAntibotUrl(html)).toBe("/DRF/lawService.do?OC=test&target=law")
  })

  it("패턴 B(substr) — o.substr 슬라이싱으로 삽입문자 제거", () => {
    // o="/DRF/XXlawService.do", c=5, z=2 → slice(0,5)+slice(7) = "/DRF/" + "lawService.do"
    const html = `<script>var x={o:'/DRF/XXlawService.do',c:5},z=2;location.assign(o.substr(0,c)+o.substr(c+z));</script>`
    expect(parseAntibotUrl(html)).toBe("/DRF/lawService.do")
  })

  it("안티봇 패턴이 없으면 null", () => {
    expect(parseAntibotUrl("<html><body>정상 응답</body></html>")).toBeNull()
    expect(parseAntibotUrl("")).toBeNull()
  })
})
