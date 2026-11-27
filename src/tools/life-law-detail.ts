/**
 * get_life_law: 찾기 쉬운 생활법령정보 본문 전문. search_life_law 결과의 「본문 전문」 식별값으로 부른다.
 * qa = 백문백답(질문·답 전문·관련 법령·관련 해설), guide = 관심규정해설, bylaw = 생활조례 해설, foreign = 외국어 생활법령.
 * 생활법령 Open API 서비스키(EASYLAW_SERVICE_KEY)가 있어야 한다.
 */
import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { callEasylaw, easylawConfigured, easylawItems, type EasylawItem } from "../lib/easylaw-client.js"
import { cleanHtml } from "../lib/article-parser.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"
import type { ToolResponse } from "../lib/types.js"

const id = (d: string) => z.union([z.string(), z.number()]).optional().describe(d)
export const getLifeLawSchema = z.object({
  kind: z.enum(["qa", "guide", "bylaw", "foreign"]).describe("qa=백문백답, guide=관심규정해설, bylaw=생활조례 해설, foreign=외국어 생활법령"),
  onhunqnaAstSeq: id("[qa] 백문백답 분류 일련번호"),
  onhunqueSeq: id("[qa] 백문백답 일련번호"),
  csmSeq: id("[guide] 생활분야 일련번호"),
  ccfNo: id("[guide] 편 번호"),
  cciNo: id("[guide] 장 번호"),
  cnpClsNo: id("[guide] 절 번호"),
  rgnbyCsmodnSeq: id("[bylaw] 생활조례 일련번호"),
  csmfldSeq: id("[foreign] 외국어 생활분야 일련번호"),
  itrfldNo: id("[bylaw·foreign] 편 번호"),
  itritmNo: id("[bylaw·foreign] 장 번호"),
  itrrlNo: id("[bylaw·foreign] 절 번호"),
  withKorean: z.boolean().optional().describe("[foreign] 한국어 원문도 함께"),
})
export type GetLifeLawInput = z.infer<typeof getLifeLawSchema>

const s = (v: unknown) => (v === undefined || v === null ? "" : String(v))
/** 해설 HTML → 문단 줄바꿈을 살린 글 */
export function htmlToText(html: unknown): string {
  return cleanHtml(s(html).replace(/<\/p>|<br\s*\/?>/gi, "\n")).split("\n").map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n")
}
/** 외국어 본문 XML(<paragraph><textstr><![CDATA[…]]></textstr>) → 문단마다 한 줄 */
export function paragraphXmlToText(xml: unknown): string {
  return [...s(xml).matchAll(/<textstr>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/textstr>/g)].map(m => m[1].replace(/\s+/g, " ").trim()).filter(Boolean).join("\n")
}
const list = (v: unknown): EasylawItem[] => (Array.isArray(v) ? v : v && typeof v === "object" ? [v as EasylawItem] : [])

export function renderQa(it: EasylawItem): string {
  const out = [`백문백답: ${s(it.onhunqueCts)}`, `분류: ${s(it.onhunqnaAstNm)}${it.onhunqueCatNm ? ` > ${s(it.onhunqueCatNm)}` : ""}${it.onhunansServiceDt ? ` · 답변 ${s(it.onhunansServiceDt).slice(0, 10)}` : ""}`, "", htmlToText(it.onhunansCts)]
  const laws = list(it.MaskMAnswerAreaLawListItem).map(l => s(l.onhunqueConLsiNm)).filter(Boolean)
  if (laws.length) out.push("", `관련 법령: ${laws.join(", ")}`)
  const guides = list(it.MaskMAnswerAreaInfoListItem)
  if (guides.length) {
    out.push("", "관련 생활법령 해설:")
    for (const g of guides) out.push(`- ${[g.csmTtl, g.ccfTtl, g.cciNm, g.cnpClsNm].map(s).filter(Boolean).join(" > ")} (kind="guide", csmSeq=${s(g.csmSeq)}, ccfNo=${s(g.ccfNo)}, cciNo=${s(g.cciNo)}, cnpClsNo=${s(g.cnpClsNo)})${g.linkUrl ? ` ${s(g.linkUrl)}` : ""}`)
  }
  out.push("", `원문: https://www.easylaw.go.kr/CSP/csp1/lifeLawDetail/getOnhunqueDetail.do?onhunqnaAstSeq=${s(it.onhunqnaAstSeq)}&onhunqueSeq=${s(it.onhunqueSeq)}`)
  return out.join("\n")
}

async function fetchDetail(a: GetLifeLawInput): Promise<string | undefined> {
  if (a.kind === "qa") {
    const it = easylawItems((await callEasylaw("manyaskmanyanswer/getMaskMAnswerAreaItem.do", { onhunqnaAstSeq: s(a.onhunqnaAstSeq), onhunqueSeq: s(a.onhunqueSeq) })).body)[0]
    return it ? renderQa(it) : undefined
  }
  if (a.kind === "guide") {
    const items = easylawItems((await callEasylaw("lifelawinfo/getLifeInterrestRuleSummaryItem.do", { getGbn: 1, csmSeq: s(a.csmSeq), ccfNo: s(a.ccfNo), cciNo: s(a.cciNo), cnpClsNo: s(a.cnpClsNo), pageNo: 1, numOfRows: 50 })).body)
    if (!items.length) return undefined
    return items.map(it => [`관심규정해설: ${s(it.title)}${it.tree ? ` [${s(it.tree).split(">").map(p => p.trim()).filter(Boolean).join(" > ")}]` : ""}`, "", htmlToText(it.ov), "", `원문: ${s(it.cnpClsNmLink)}`].join("\n")).join("\n\n---\n\n")
  }
  if (a.kind === "bylaw") {
    const it = easylawItems((await callEasylaw("easybylaw/getEasyBylawLContents.do", { rgnbyCsmodnSeq: s(a.rgnbyCsmodnSeq), itrfldNo: s(a.itrfldNo), itritmNo: s(a.itritmNo), itrrlNo: s(a.itrrlNo) })).body)[0]
    return it ? [`생활조례 해설: ${s(it.itrrlNm)}`, "", htmlToText(it.itrrlExpstCn)].join("\n") : undefined
  }
  const it = easylawItems((await callEasylaw("multilanglifelaw/getMultiLangLifelawContents.do", { csmfldSeq: s(a.csmfldSeq), itrfldNo: s(a.itrfldNo), itritmNo: s(a.itritmNo), itrrlNo: s(a.itrrlNo) })).body)[0]
  if (!it) return undefined
  const out = [s(it.itrrlNm) || s(it.itritmExpln), "", paragraphXmlToText(it.itrrlExpstCn)]
  if (a.withKorean && it.itrrlExpstCnKor) out.push("", "[한국어 원문]", paragraphXmlToText(it.itrrlExpstCnKor))
  return out.join("\n")
}

export async function getLifeLaw(_apiClient: LawApiClient, input: GetLifeLawInput): Promise<ToolResponse> {
  try {
    if (!easylawConfigured()) {
      return { content: [{ type: "text", text: "[INVALID_PARAMETER] 생활법령 본문 조회는 생활법령 Open API 서비스키(EASYLAW_SERVICE_KEY)가 있는 서버에서만 됩니다. search_life_law 결과의 발췌와 원문 링크를 쓰세요." }], isError: true }
    }
    const t = await fetchDetail(input)
    if (!t) return { content: [{ type: "text", text: `[NOT_FOUND] 생활법령 ${input.kind} 본문을 찾지 못했습니다. search_life_law 결과의 식별값을 그대로 넣으세요.` }], isError: true }
    return { content: [{ type: "text", text: truncateResponse(`${t}\n\n찾기 쉬운 생활법령정보(법제처) 해설입니다. 인용된 조문은 현행 법령 본문으로 확인하세요.`) }] }
  } catch (error) {
    return formatToolError(error, "get_life_law")
  }
}
