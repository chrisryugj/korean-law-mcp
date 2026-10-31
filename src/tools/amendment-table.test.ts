/**
 * amendment_table — 현행 조회·직접 입력·신설 판정·HWPX 저장(로컬만)
 *
 * 업스트림은 mock. 조문 JSON 은 법제처 eflaw 조문단위 모양(조문내용 = 조 머리, 항 배열).
 */
import { describe, it, expect } from "vitest"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { parse } from "kordoc"
import { amendmentTable, enableAmendmentFileOutput, draftTitle, AmendmentTableSchema } from "./amendment-table.js"
import { legalAnalysis, LegalAnalysisSchema } from "./legal-analysis.js"
import type { LawApiClient } from "../lib/api-client.js"

const ARTICLE_22 = JSON.stringify({
  법령: {
    기본정보: { 법령명_한글: "건축법" },
    조문: {
      조문단위: {
        조문여부: "조문", 조문번호: "22", 조문제목: "건축물의 사용승인", 조문내용: "제22조(건축물의 사용승인)",
        항: [
          { 항내용: "① 건축주는 공사완료도서를 첨부하여 신청하여야 한다. <개정 2013.3.23>" },
          { 항내용: "② 허가권자는 검사한다." },
        ],
      },
    },
  },
})
const NO_ARTICLE = JSON.stringify({ 법령: { 기본정보: { 법령명_한글: "건축법" } } })

const SEARCH_HIT = `<?xml version="1.0" encoding="UTF-8"?><LawSearch><totalCnt>1</totalCnt><law id="1">` +
  `<법령명한글><![CDATA[건축법]]></법령명한글><법령ID>001823</법령ID><법령일련번호>273437</법령일련번호>` +
  `<시행일자>20260227</시행일자><현행연혁코드>현행</현행연혁코드><법령구분명>법률</법령구분명></law></LawSearch>`

// 업스트림이 JO 를 무시하고 다른 조를 돌려준 경우(법령 전체·제1조)
const WRONG_ARTICLE = JSON.stringify({ 법령: { 조문: { 조문단위: { 조문여부: "조문", 조문번호: "1", 조문내용: "제1조(목적) 이 법은 목적이 있다." } } } })

function stub(): LawApiClient & { calls: string[] } {
  const calls: string[] = []
  const client = {
    calls,
    async getLawText(p: { mst?: string; lawId?: string; jo?: string }) {
      calls.push(`law:${p.mst ?? p.lawId}:${p.jo}`)
      return p.jo === "002200" ? ARTICLE_22 : p.jo === "009900" ? WRONG_ARTICLE : NO_ARTICLE
    },
    async searchLaw(query: string) {
      calls.push(`search:${query}`)
      return SEARCH_HIT
    },
  }
  return client as unknown as LawApiClient & { calls: string[] }
}

const NEW_22 = "제22조(건축물의 사용승인) ① 건축주는 서류를 첨부하여 신청하여야 한다.\n② 허가권자는 검사한다.\n③ 숙박시설은 알려야 한다."

describe("amendment_table", () => {
  it("법령명으로 현행을 조회해 대조하고, 연혁 표기는 빼고, 바뀐 곳만 밑줄", async () => {
    const api = stub()
    const r = await amendmentTable(api, AmendmentTableSchema.parse({ lawName: "건축법", amendments: [{ text: NEW_22 }] }))
    const text = r.content[0].text
    expect(r.isError).toBeFalsy()
    expect(api.calls).toEqual(["search:건축법", "law:273437:002200"])
    expect(text).toContain("### 건축법 일부개정법률안 신･구조문대비표")
    expect(text).toContain("| 제22조(건축물의 사용승인) ① 건축주는 **공사완료도서**를 첨부하여 신청하여야 한다. | 제22조(건축물의 사용승인) ① ---- **서류**---------------. |")
    expect(text).toContain("| ② (생  략) | ② (현행과 같음) |")
    expect(text).toContain("| **<신  설>** | **③ 숙박시설은 알려야 한다.** |")
    expect(text).not.toContain("개정 2013")
  })

  it("현행에 없는 조는 신설로 처리하고 번호 확인을 알린다", async () => {
    const r = await amendmentTable(stub(), AmendmentTableSchema.parse({ mst: "273437", lawName: "건축법", amendments: [{ text: "제22조의2(숙박시설 안내) 허가권자는 안내하여야 한다." }] }))
    expect(r.content[0].text).toContain("| **<신  설>** | **제22조의2(숙박시설 안내) 허가권자는 안내하여야 한다.** |")
    expect(r.content[0].text).toContain("현행에 없는 조라 신설로 처리했습니다")
  })

  it("currentText 를 주면 법제처를 부르지 않는다 (조례·행정규칙)", async () => {
    const api = stub()
    const r = await amendmentTable(api, AmendmentTableSchema.parse({
      title: "서울특별시 광진구 복무 조례 일부개정조례안",
      amendments: [{ currentText: "제3조(근무시간) 근무시간은 9시부터 18시까지로 한다.", text: "제3조(근무시간) 근무시간은 8시부터 17시까지로 한다." }],
    }))
    expect(api.calls).toEqual([])
    expect(r.content[0].text).toContain("**9시부터 18시까지**로")
    expect(r.content[0].text).toContain("제3조(근무시간) ----- **8시부터 17시까지**----.")
  })

  it("조문 순서대로 정렬하고, 현행과 같은 조는 빼며 알린다", async () => {
    const r = await amendmentTable(stub(), AmendmentTableSchema.parse({
      amendments: [
        { currentText: "제9조(나) 나는 한다.", text: "제9조(나) 나는 하지 아니한다." },
        { currentText: "제3조(가) 가는 한다.", text: "제3조(가) 가는 한다." },
        { currentText: "제2조(다) 다는 한다.", text: "제2조(다) 다를 한다." },
      ],
    }))
    const text = r.content[0].text
    expect(text.indexOf("제2조(다)")).toBeLessThan(text.indexOf("제9조(나)"))
    expect(text).toContain("제3조: 현행과 같아 표에서 뺐습니다")
  })

  it("바뀐 항만 적으면 빠진 항을 <삭  제>로 적되 알리고, '(현행과 같음)' 자리표시는 현행으로 채운다", async () => {
    const partial = await amendmentTable(stub(), AmendmentTableSchema.parse({ mst: "273437", lawName: "건축법", amendments: [{ text: "제22조(건축물의 사용승인) ① 건축주는 서류를 첨부하여 신청하여야 한다." }] }))
    expect(partial.content[0].text).toContain("| **② 허가권자는 검사한다.** | **<삭  제>** |")
    expect(partial.content[0].text).toContain("제22조: 개정안에 없는 ②을(를) <삭  제>로 적었습니다")

    const marked = await amendmentTable(stub(), AmendmentTableSchema.parse({ mst: "273437", lawName: "건축법", amendments: [{ text: "제22조(건축물의 사용승인) ① 건축주는 서류를 첨부하여 신청하여야 한다.\n② (현행과 같음)\n③ 숙박시설은 알려야 한다." }] }))
    const text = marked.content[0].text
    expect(text).toContain("| ② (생  략) | ② (현행과 같음) |")
    expect(text).not.toContain("확인할 점")
  })

  it("C: 업스트림이 다른 조를 주면 그 조와 대조하지 않는다", async () => {
    const r = await amendmentTable(stub(), AmendmentTableSchema.parse({ mst: "273437", lawName: "건축법", amendments: [{ text: "제99조(새 조) 새로 정한다." }] }))
    expect(r.content[0].text).not.toContain("제1조")
    expect(r.content[0].text).toContain("| **<신  설>** |")
  })

  it("H: 빈 jo 는 머리 번호로, jo 와 머리 번호가 다르면 알리고, 같은 조를 두 번 주면 막는다", async () => {
    const empty = await amendmentTable(stub(), AmendmentTableSchema.parse({ mst: "273437", lawName: "건축법", amendments: [{ jo: "", text: NEW_22 }] }))
    expect(empty.isError).toBeFalsy()
    const differ = await amendmentTable(stub(), AmendmentTableSchema.parse({ mst: "273437", lawName: "건축법", amendments: [{ jo: "제22조", text: NEW_22.replace("제22조", "제23조") }] }))
    expect(differ.content[0].text).toContain("jo(제22조)와 개정안 머리(제23조)가 다릅니다")
    const dup = await amendmentTable(stub(), AmendmentTableSchema.parse({ mst: "273437", lawName: "건축법", amendments: [{ text: NEW_22 }, { jo: "제22조", text: NEW_22 }] }))
    expect(dup.isError).toBe(true)
  })

  it("legal_analysis(mode=amendment_table)로도 같은 표를 만들고, 인자가 빠지면 알린다", async () => {
    const r = await legalAnalysis(stub(), LegalAnalysisSchema.parse({ mode: "amendment_table", lawName: "건축법", amendments: [{ text: NEW_22 }] }))
    expect(r.content[0].text).toContain("| ② (생  략) | ② (현행과 같음) |")
    const bad = await legalAnalysis(stub(), LegalAnalysisSchema.parse({ mode: "amendment_table", lawName: "건축법" }))
    expect(bad.isError).toBe(true)
  })

  it("굵은 글씨 경계에 붙은 괄호는 밖으로 빼서 채팅 화면에서 깨지지 않는다", async () => {
    const r = await amendmentTable(stub(), AmendmentTableSchema.parse({ amendments: [{ currentText: "제65조(승무정원) 정원을 정한다.", text: "제65조(최소승무정원) 정원을 정한다." }] }))
    expect(r.content[0].text).toContain("| 제65조(**승무정원**) (생  략) | 제65조(**최소승무정원**) (현행과 같음) |")
  })

  it("lawName·mst·lawId 도 currentText 도 없으면 스키마에서 막는다", () => {
    expect(() => AmendmentTableSchema.parse({ amendments: [{ text: NEW_22 }] })).toThrow()
  })

  it("개정안 이름: 법률·영·부령·조례", () => {
    expect(draftTitle("건축법")).toBe("건축법 일부개정법률안")
    expect(draftTitle("건축법 시행령")).toBe("건축법 시행령 일부개정령안")
    expect(draftTitle("건축법 시행규칙")).toBe("건축법 시행규칙 일부개정령안")
    expect(draftTitle("서울특별시 광진구 주차장 설치 및 관리 조례")).toBe("서울특별시 광진구 주차장 설치 및 관리 조례 일부개정조례안")
  })

  it("HWPX 는 로컬 실행에서만 쓰고, 쓴 파일은 한글 문서로 다시 읽힌다(밑줄 유지)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "amd-"))
    const outputPath = path.join(dir, "대비표.hwpx")
    const input = AmendmentTableSchema.parse({ mst: "273437", lawName: "건축법", amendments: [{ text: NEW_22 }], outputPath })

    const remote = await amendmentTable(stub(), input)
    expect(remote.content[0].text).toContain("HWPX 파일 저장은 로컬 실행(STDIO·CLI)에서만 됩니다")
    await expect(readFile(outputPath)).rejects.toThrow()

    enableAmendmentFileOutput()
    const local = await amendmentTable(stub(), input)
    expect(local.content[0].text).toContain(`HWPX 저장: ${outputPath}`)
    const parsed = await parse(await readFile(outputPath))
    expect(parsed.success).toBe(true)
    const md = parsed.success ? parsed.markdown : ""
    expect(md).toContain("신･구조문대비표")
    expect(md).toContain("<u>공사완료도서</u>")
    expect(md).toContain("<u>서류</u>")

    // K: XML 에 못 쓰는 제어문자가 섞여도 한글 문서가 깨지지 않는다
    const ctrl = await amendmentTable(stub(), { ...input, amendments: [{ text: NEW_22.replace("서류", "서\u0001류") }] })
    expect(ctrl.isError).toBeFalsy()
    expect((await parse(await readFile(outputPath))).success).toBe(true)

    const bad = await amendmentTable(stub(), { ...input, outputPath: path.join(dir, "대비표.docx") })
    expect(bad.isError).toBe(true)
  })
})
