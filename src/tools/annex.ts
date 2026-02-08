/**
 * get_annexes Tool - 별표/서식 조회 + 텍스트 추출
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { fetchWithRetry } from "../lib/fetch-with-retry.js"
import { parseAnnexFile } from "../lib/annex-file-parser.js"

const LAW_BASE_URL = "https://www.law.go.kr"

export const GetAnnexesSchema = z.object({
  lawName: z.string().describe("법령명 (예: '관세법')"),
  knd: z.enum(["1", "2", "3", "4", "5"]).optional().describe("1=별표, 2=서식, 3=부칙별표, 4=부칙서식, 5=전체"),
  bylSeq: z.string().optional().describe("별표번호 (예: '000300'). 지정 시 해당 별표 파일을 다운로드하여 텍스트로 추출"),
  apiKey: z.string().optional().describe("API 키")
})

export type GetAnnexesInput = z.infer<typeof GetAnnexesSchema>

export async function getAnnexes(
  apiClient: LawApiClient,
  input: GetAnnexesInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const jsonText = await apiClient.getAnnexes({
      lawName: input.lawName,
      knd: input.knd,
      apiKey: input.apiKey
    })

    const json = JSON.parse(jsonText)

    // LexDiff 방식: 법령 타입별 응답 구조 분기
    const adminResult = json?.admRulBylSearch
    const licResult = json?.licBylSearch

    let annexList: any[] = []
    let lawType: string = "law"

    if (adminResult?.admbyl && Array.isArray(adminResult.admbyl)) {
      annexList = adminResult.admbyl
      lawType = "admin"
    } else if (licResult?.ordinbyl && Array.isArray(licResult.ordinbyl)) {
      annexList = licResult.ordinbyl
      lawType = "ordinance"
    } else if (licResult?.licbyl && Array.isArray(licResult.licbyl)) {
      annexList = licResult.licbyl
      lawType = "law"
    }

    if (annexList.length === 0) {
      return {
        content: [{ type: "text", text: `"${input.lawName}"에 대한 별표/서식이 없습니다.` }]
      }
    }

    // bylSeq 지정 시 → 해당 별표 파일 다운로드 + 텍스트 추출
    if (input.bylSeq) {
      return await extractAnnexContent(annexList, lawType, input)
    }

    // bylSeq 미지정 → 기존 목록 반환
    return formatAnnexList(annexList, lawType, input)
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true
    }
  }
}

// ─── 별표 텍스트 추출 ─────────────────────────────────

async function extractAnnexContent(
  annexList: any[],
  lawType: string,
  input: GetAnnexesInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  // bylSeq로 매칭
  const matched = annexList.find((a: any) => a.별표번호 === input.bylSeq)
  if (!matched) {
    return {
      content: [{ type: "text", text: `별표번호 "${input.bylSeq}"에 해당하는 항목을 찾을 수 없습니다.\n사용 가능한 별표번호: ${annexList.map((a: any) => a.별표번호).filter(Boolean).join(", ")}` }]
    }
  }

  const annexTitle = matched.별표명 || "제목 없음"
  let fileLink = ""
  if (lawType === "law") {
    fileLink = matched.별표서식파일링크 || matched.별표서식PDF파일링크 || ""
  } else {
    fileLink = matched.별표서식파일링크 || ""
  }

  if (!fileLink) {
    return {
      content: [{ type: "text", text: `"${annexTitle}"의 파일 링크가 없습니다.` }]
    }
  }

  // 파일 다운로드
  const downloadUrl = `${LAW_BASE_URL}${fileLink}`
  const response = await fetchWithRetry(downloadUrl, { timeout: 30000 })
  if (!response.ok) {
    return {
      content: [{ type: "text", text: `파일 다운로드 실패: HTTP ${response.status}\nURL: ${downloadUrl}` }],
      isError: true
    }
  }

  const buffer = await response.arrayBuffer()
  const result = await parseAnnexFile(buffer)

  if (result.fileType === "pdf") {
    // PDF는 LLM이 직접 읽을 수 있으므로 링크 반환
    const pdfLink = matched.별표서식PDF파일링크 || fileLink
    return {
      content: [{
        type: "text",
        text: `📄 ${annexTitle}\n\nPDF 파일입니다. 다음 링크에서 직접 확인할 수 있습니다:\n${LAW_BASE_URL}${pdfLink}`
      }]
    }
  }

  if (!result.success || !result.markdown) {
    return {
      content: [{
        type: "text",
        text: `"${annexTitle}" 텍스트 추출 실패: ${result.error || "알 수 없는 오류"}\n파일 링크: ${LAW_BASE_URL}${fileLink}`
      }],
      isError: true
    }
  }

  return {
    content: [{
      type: "text",
      text: `📋 ${input.lawName} - ${annexTitle}\n(파일 형식: ${result.fileType.toUpperCase()})\n\n${result.markdown}`
    }]
  }
}

// ─── 목록 포맷 (기존 동작) ────────────────────────────

function formatAnnexList(
  annexList: any[],
  lawType: string,
  input: GetAnnexesInput
): { content: Array<{ type: string, text: string }> } {
  const kndLabel = input.knd === "1" ? "별표"
                 : input.knd === "2" ? "서식"
                 : input.knd === "3" ? "부칙별표"
                 : input.knd === "4" ? "부칙서식"
                 : "별표/서식"

  let resultText = `법령명: ${input.lawName}\n`
  resultText += `${kndLabel} 목록 (총 ${annexList.length}건):\n\n`

  const maxItems = Math.min(annexList.length, 20)

  for (let i = 0; i < maxItems; i++) {
    const annex = annexList[i]
    const annexTitle = annex.별표명 || "제목 없음"
    const annexType = annex.별표종류 || ""
    const annexNum = annex.별표번호 || ""

    resultText += `${i + 1}. `
    if (annexNum) resultText += `[${annexNum}] `
    resultText += `${annexTitle}`
    if (annexType) resultText += ` (${annexType})`
    resultText += `\n`

    if (lawType === "ordinance") {
      const relatedLaw = annex.관련자치법규명
      const localGov = annex.지자체기관명
      if (relatedLaw) {
        resultText += `   📚 관련법규: ${relatedLaw.replace(/<[^>]+>/g, '')}\n`
      }
      if (localGov) {
        resultText += `   🏛️  지자체: ${localGov}\n`
      }
    } else if (lawType === "admin") {
      if (annex.관련행정규칙명) resultText += `   📚 행정규칙: ${annex.관련행정규칙명}\n`
      if (annex.소관부처) resultText += `   🏢 소관부처: ${annex.소관부처}\n`
    } else {
      if (annex.관련법령명) resultText += `   📚 관련법령: ${annex.관련법령명}\n`
    }

    resultText += `\n`
  }

  if (annexList.length > maxItems) {
    resultText += `\n... 외 ${annexList.length - maxItems}개 항목 (생략)\n`
  }

  resultText += `\n⚠️ 별표 내용을 확인하려면 이 도구(get_annexes)를 bylSeq 파라미터와 함께 다시 호출하세요.\n예: get_annexes({ lawName: "${input.lawName}", bylSeq: "${annexList[0]?.별표번호 || '000100'}" })`

  return { content: [{ type: "text", text: resultText }] }
}
