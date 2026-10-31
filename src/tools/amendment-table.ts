/**
 * amendment_table — 신·구조문대비표 작성 (일부개정 법령안)
 *
 * 개정안 조문 전문만 받으면 현행 조문은 법제처에서 가져와 대조한다. 바뀐 부분 밑줄,
 * 개정안 칸의 같은 부분 "----", 바뀌지 않은 항·호 "(생  략)"/"(현행과 같음)", <신  설>·<삭  제>.
 * 조례·행정규칙·미공포안처럼 자동 조회가 안 되는 현행은 currentText 로 받는다.
 */
import { z } from "zod"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import type { LawApiClient } from "../lib/api-client.js"
import { buildJO } from "../lib/law-parser.js"
import { parseArticle } from "../lib/amendment-units.js"
import { renderArticle, type Row } from "../lib/amendment-render.js"
import { rowsToMarkdown } from "../lib/amendment-format.js"
import { buildAmendmentHwpx } from "../lib/amendment-hwpx.js"
import { fetchCurrentArticle, resolveLaw, type LawRef } from "../lib/amendment-current.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError, LawApiError, ErrorCodes } from "../lib/errors.js"
import type { ToolResponse } from "../lib/types.js"

export const MAX_AMENDED_ARTICLES = 30

export const AmendmentTableSchema = z.object({
  lawName: z.string().optional().describe("개정할 법령명 (예: '건축법', '건축법 시행령') — 현행 조문을 법제처에서 자동 조회"),
  mst: z.string().optional().describe("법령일련번호 (lawName 대신)"),
  lawId: z.string().optional().describe("법령ID (lawName 대신)"),
  title: z.string().optional().describe("대비표 제목 (예: '건축법 일부개정법률안'). 생략 시 법령명으로 만든다"),
  amendments: z.array(z.object({
    jo: z.string().optional().describe("조문 번호 (예: '제22조', '제5조의2'). 생략 시 text 첫머리의 조 번호"),
    text: z.string().min(1).describe("개정안 조문 전문 — 개정 후 모습 그대로(조 머리·항·호·목, 한 줄에 한 단위). 바뀌지 않는 항·호는 그대로 적거나 '② ∼ ⑤ (현행과 같음)'·'1.·2. (현행과 같음)'으로 줄여 쓴다(적지 않은 현행 항·호는 삭제로 본다). 지우는 항·호는 '③ 삭제', 조 전체 삭제는 '제5조 삭제'"),
    currentText: z.string().optional().describe("현행 조문 원문 직접 입력 — 조례·행정규칙 등 자동 조회가 안 될 때. 신설 조는 빈 문자열"),
  })).min(1).max(MAX_AMENDED_ARTICLES).describe("개정하는 조문 목록 (조문 순서대로 정렬해 표를 만든다)"),
  outputPath: z.string().optional().describe("한글(.hwpx) 파일 저장 경로 — 로컬 실행(STDIO·CLI)에서만"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
}).refine(d => d.lawName || d.mst || d.lawId || d.amendments.every(a => a.currentText !== undefined), {
  message: "lawName·mst·lawId 중 하나를 주거나, 모든 조문에 currentText(현행 원문)를 넣으세요",
})

export type AmendmentTableInput = z.infer<typeof AmendmentTableSchema>

let fileOutputEnabled = false
/** STDIO·CLI 진입점만 켠다 — 원격(HTTP) 서버가 요청 인자대로 서버 디스크에 쓰지 않게 */
export function enableAmendmentFileOutput() {
  fileOutputEnabled = true
}

/** 제명 끝으로 개정안 이름: 법률 → 일부개정법률안, 영·부령 → 일부개정령안, 조례 → 일부개정조례안 */
export function draftTitle(lawName: string): string {
  if (!lawName) return "일부개정안"
  if (/조례$/.test(lawName)) return `${lawName} 일부개정조례안`
  if (/(령|시행규칙)$/.test(lawName)) return `${lawName} 일부개정령안`
  if (/법(률)?$/.test(lawName)) return `${lawName} 일부개정법률안`
  return `${lawName} 일부개정안`
}

interface ArticleResult {
  joCode: string
  rows: Row[] | null
  notes: string[]
}

async function buildArticle(
  apiClient: LawApiClient,
  law: LawRef | null,
  a: AmendmentTableInput["amendments"][number],
  apiKey?: string,
): Promise<ArticleResult> {
  const newTree = parseArticle(a.text)
  const jo = (a.jo?.trim() || newTree.num).replace(/\s/g, "")
  if (!jo) throw new LawApiError("조 번호를 알 수 없습니다 — jo 를 주거나 text 를 '제N조(제목)'으로 시작하세요.", ErrorCodes.INVALID_PARAM)
  const joCode = buildJO(jo)
  const current = a.currentText !== undefined ? a.currentText : await fetchCurrentArticle(apiClient, law!, jo, apiKey)
  const oldTree = current?.trim() ? parseArticle(current) : null
  const notes: string[] = []
  if (newTree.num && buildJO(newTree.num) !== joCode) {
    notes.push(`${jo}: jo(${jo})와 개정안 머리(${newTree.num})가 다릅니다 — 현행은 ${jo}로 조회했습니다`)
  }
  if (!newTree.num) {
    newTree.num = oldTree?.num || jo
    newTree.title = oldTree?.title ?? ""
    if (oldTree?.title) notes.push(`${jo}: 개정안에 조 제목이 없어 현행 제목 ${oldTree.title}을 그대로 썼습니다`)
  }
  if (!oldTree && current === null) notes.push(`${jo}: 현행에 없는 조라 신설로 처리했습니다 — 번호가 맞는지 확인하세요`)
  const found: string[] = []
  const rows = renderArticle(oldTree, newTree, found)
  notes.push(...found.map(n => `${jo}: ${n}`))
  if (!rows) notes.push(`${jo}: 현행과 같아 표에서 뺐습니다`)
  return { joCode, rows, notes }
}

async function saveHwpx(outputPath: string, title: string, articles: Row[][]): Promise<string> {
  const target = path.resolve(outputPath)
  if (path.extname(target).toLowerCase() !== ".hwpx") {
    throw new LawApiError("outputPath 는 .hwpx 로 끝나야 합니다.", ErrorCodes.INVALID_PARAM)
  }
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, await buildAmendmentHwpx([title, "신･구조문대비표"], articles))
  return target
}

export async function amendmentTable(apiClient: LawApiClient, input: AmendmentTableInput): Promise<ToolResponse> {
  try {
    const needsFetch = input.amendments.some(a => a.currentText === undefined)
    const law = needsFetch ? await resolveLaw(apiClient, input) : null
    const results = await Promise.all(input.amendments.map(a => buildArticle(apiClient, law, a, input.apiKey)))
    const seen = new Set<string>()
    for (const r of results) {
      if (seen.has(r.joCode)) throw new LawApiError("같은 조를 두 번 넣었습니다 — 한 조는 개정안 하나로 합치세요.", ErrorCodes.INVALID_PARAM)
      seen.add(r.joCode)
    }
    results.sort((x, y) => x.joCode.localeCompare(y.joCode))

    const lawName = law?.lawName || input.lawName || ""
    const title = input.title?.trim() || draftTitle(lawName)
    const articles = results.map(r => r.rows).filter((r): r is Row[] => r !== null)
    const lines: string[] = []
    if (articles.length) {
      lines.push(rowsToMarkdown(`${title} 신･구조문대비표`, articles.flat()), "")
      lines.push("밑줄(<u>…</u>)은 개정되는 부분, '----'는 현행과 같은 부분입니다.")
    } else {
      lines.push("[NO_CHANGE] 입력한 개정안이 모두 현행과 같습니다.")
    }
    if (law) lines.push(`현행 원문: 국가법령정보센터 「${law.lawName}」${law.mst ? ` (MST ${law.mst})` : ""} 현행 조문을 조회해 대조했습니다.`)
    const notes = results.flatMap(r => r.notes)
    if (notes.length) lines.push("", "확인할 점:", ...notes.map(n => `- ${n}`))

    if (input.outputPath && articles.length) {
      if (!fileOutputEnabled) {
        lines.push("", "HWPX 파일 저장은 로컬 실행(STDIO·CLI)에서만 됩니다. 위 표를 한글에 붙여 넣어 쓰세요.")
      } else {
        const saved = await saveHwpx(input.outputPath, title, articles)
        lines.push("", `HWPX 저장: ${saved} (한양신명조 14pt · 줄 간격 180% · 법제업무편람 서식)`)
      }
    }
    return { content: [{ type: "text", text: truncateResponse(lines.join("\n")) }] }
  } catch (error) {
    return formatToolError(error, "amendment_table")
  }
}
