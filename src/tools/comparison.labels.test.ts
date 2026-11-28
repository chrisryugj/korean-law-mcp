/** compare_old_new. 조 라벨은 조 머리에서만, 항·호 줄은 앞 조에 딸린다 (법제처 law-mcp 대조 실측: 도로교통법 호 줄이 "제43조"·"조문 2" 로 찍힘) */
import { describe, expect, it } from "vitest"
import { compareOldNew } from "./comparison.js"
import type { LawApiClient } from "../lib/api-client.js"

const pair = (o: string, n: string) => [o, n]
const rows = [
  pair("<P>제2조(정의) 이 법에서 사용하는 용어의 뜻은 다음과 같다.</P>", "<P>제2조(정의) 이 법에서 사용하는 용어의 뜻은 다음과 같다.</P>"),
  pair("<P>  23. 운전이란 제43조에 따른 …</P>", "<P>  23. 운전이란 제43조·제44조에 따른 …</P>"),
  pair("", "<P>제137조의2(신설 조) 새 조문</P>"),
]
const xml = `<OldAndNewService><법령명>도로교통법</법령명><구조문_기본정보><공포일자>20250101</공포일자></구조문_기본정보><신조문_기본정보><공포일자>20260101</공포일자></신조문_기본정보>`
  + `<구조문목록>${rows.map(r => `<조문>${r[0]}</조문>`).join("")}</구조문목록><신조문목록>${rows.map(r => `<조문>${r[1]}</조문>`).join("")}</신조문목록></OldAndNewService>`
const client = { compareOldNew: async () => xml } as unknown as LawApiClient

describe("compare_old_new 조 라벨", () => {
  it("호 줄은 앞 조(제2조)에 붙고, 본문 속 인용 조(제43조)를 라벨로 쓰지 않으며 <P> 를 걷는다", async () => {
    const t = (await compareOldNew(client, { mst: "1" })).content[0].text
    expect(t).toMatch(/---\n제2조\n---/)
    expect(t).not.toMatch(/---\n제43조\n---/)
    expect(t).not.toContain("조문 2")
    expect(t).not.toContain("<P>")
    expect(t).toMatch(/---\n제137조의2\n---\n\n\[개정 전\] \(신설\)/)
  })
  it("jo 로 한 조만, 없는 조면 바뀐 조 목록", async () => {
    const t = (await compareOldNew(client, { mst: "1", jo: "137의2" })).content[0].text
    expect(t).toContain("제137조의2")
    expect(t).not.toContain("제2조")
    const none = (await compareOldNew(client, { mst: "1", jo: "제5조" })).content[0].text
    expect(none).toContain("바뀐 조: 제2조, 제137조의2")
  })
})
