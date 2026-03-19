/**
 * get_annexes Tool - 별표/서식 조회 + 텍스트 추출
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { fetchWithRetry } from "../lib/fetch-with-retry.js"
import { parseAnnexFile } from "../lib/annex-file-parser.js"
import { truncateResponse, MAX_RESPONSE_SIZE } from "../lib/schemas.js"

const LAW_BASE_URL = "https://www.law.go.kr"

export const GetAnnexesSchema = z.object({
  lawName: z.string().describe("법령명 (예: '관세법'). 별표를 바로 지정하려면 '... 별표4'처럼 함께 입력 가능"),
  knd: z.enum(["1", "2", "3", "4", "5"]).optional().describe("1=별표, 2=서식, 3=부칙별표, 4=부칙서식, 5=전체"),
  bylSeq: z.string().optional().describe("별표번호 (예: '000300'). 지정 시 해당 별표 파일을 다운로드하여 텍스트로 추출"),
  annexNo: z.string().optional().describe("별표 번호 (예: '4', '별표4', '제4호'). bylSeq 대체 입력"),
  apiKey: z.string().optional().describe("API 키")
})

export type GetAnnexesInput = z.infer<typeof GetAnnexesSchema>

export async function getAnnexes(
  apiClient: LawApiClient,
  input: GetAnnexesInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const parsedLawInput = parseLawNameAndHint(input.lawName)
    const normalizedLawName = parsedLawInput.normalizedLawName || input.lawName
    const annexSelector = (input.bylSeq || input.annexNo || parsedLawInput.annexNo || "").trim()

    let annexList: any[] = []
    let lawType: string = "law"

    // 법제처 API는 결과 1건일 때 배열 대신 단일 객체를 반환하므로 정규화
    const toArray = (v: unknown): any[] =>
      v == null ? [] : Array.isArray(v) ? v : [v]

    const parseAnnexResponse = (jsonText: string): { list: any[], type: string } => {
      const json = JSON.parse(jsonText)
      const adminResult = json?.admRulBylSearch
      const licResult = json?.licBylSearch
      if (adminResult?.admbyl) return { list: toArray(adminResult.admbyl), type: "admin" }
      if (licResult?.ordinbyl) return { list: toArray(licResult.ordinbyl), type: "ordinance" }
      if (licResult?.licbyl) return { list: toArray(licResult.licbyl), type: "law" }
      return { list: [], type: "law" }
    }

    // 1차: 원래 법령명 + knd 필터
    const result1 = parseAnnexResponse(await apiClient.getAnnexes({
      lawName: normalizedLawName, knd: input.knd, apiKey: input.apiKey
    }))
    annexList = result1.list
    lawType = result1.type

    // 2차: 결과 없으면 knd 제거 (법제처가 "별표"를 "서식"으로 분류하는 경우)
    if (annexList.length === 0 && input.knd) {
      const result2 = parseAnnexResponse(await apiClient.getAnnexes({
        lawName: normalizedLawName, apiKey: input.apiKey
      }))
      annexList = result2.list
      lawType = result2.type
    }

    // 3차: 모법명으로 재검색 ("여권법 시행규칙" → "여권법")
    if (annexList.length === 0) {
      const parentName = extractParentLawName(normalizedLawName)
      if (parentName) {
        const result3 = parseAnnexResponse(await apiClient.getAnnexes({
          lawName: parentName, apiKey: input.apiKey
        }))
        // 원래 법령명 매칭 필터
        const filtered = result3.list.filter((a: any) => {
          const name = String(a.관련법령명 || a.관련자치법규명 || a.관련행정규칙명 || "").replace(/<[^>]+>/g, "")
          return name === normalizedLawName
        })
        annexList = filtered.length > 0 ? filtered : result3.list
        lawType = result3.type
      }
    }

    if (annexList.length === 0) {
      return {
        content: [{ type: "text", text: `"${normalizedLawName}"에 대한 별표/서식이 없습니다.` }]
      }
    }

    // 최신본 우선 정렬
    annexList.sort((a: any, b: any) =>
      (b.자치법규시행일자 || b.공포일자 || "").localeCompare(a.자치법규시행일자 || a.공포일자 || "")
    )

    // 관련법규명 필터링: 사용자 쿼리와 가장 일치하는 조례 우선
    const filtered = filterByRelatedLawName(annexList, normalizedLawName)

    // 별표 선택값 지정 시 → 해당 별표 파일 다운로드 + 텍스트 추출
    if (annexSelector) {
      return await extractAnnexContent(filtered, annexSelector, normalizedLawName)
    }

    // 별표 선택값 미지정 → 기존 목록 반환
    return formatAnnexList(filtered, lawType, input, normalizedLawName)
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
  annexSelector: string,
  normalizedLawName: string
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  // bylSeq / annexNo / lawName 내 힌트로 유연 매칭
  const matched = findMatchingAnnex(annexList, annexSelector)
  if (!matched) {
    const availableBylSeq = annexList.map((a: any) => a.별표번호).filter(Boolean).slice(0, 20).join(", ")
    return {
      content: [{
        type: "text",
        text: `별표 선택값 "${annexSelector}"에 해당하는 항목을 찾을 수 없습니다.\n사용 가능한 별표번호(일부): ${availableBylSeq || "없음"}\n예: get_annexes({ lawName: "${normalizedLawName}", bylSeq: "${annexList[0]?.별표번호 || "000100"}" }) 또는 get_annexes({ lawName: "${normalizedLawName} 별표4" })`
      }]
    }
  }

  const annexTitle = matched.별표명 || "제목 없음"
  const fileLink = matched.별표서식파일링크 || matched.별표서식PDF파일링크 || matched.별표파일링크 || ""

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

  if (result.fileType === "pdf" && result.isImageBased) {
    // 이미지 기반 PDF: 텍스트 추출 불가 → 링크 안내
    const pdfLink = matched.별표서식PDF파일링크 || fileLink
    return {
      content: [{
        type: "text",
        text: `📄 ${annexTitle}\n\n이미지 기반 PDF입니다 (${result.pageCount || "?"}페이지). 텍스트 추출이 불가합니다.\n다운로드 링크: ${LAW_BASE_URL}${pdfLink}`
      }]
    }
  }

  if (!result.success || !result.markdown) {
    // 파싱 실패 시에도 PDF 링크 안내
    const fallbackLink = matched.별표서식PDF파일링크 || fileLink
    return {
      content: [{
        type: "text",
        text: `"${annexTitle}" 텍스트 추출 실패: ${result.error || "알 수 없는 오류"}\n파일 링크: ${LAW_BASE_URL}${fallbackLink}`
      }],
      isError: true
    }
  }

  // 파싱 성공 - 크기 제한 적용
  const header = `📋 ${normalizedLawName} - ${annexTitle}\n(파일 형식: ${result.fileType.toUpperCase()}${result.pageCount ? `, ${result.pageCount}페이지` : ""})\n\n`
  const fullText = header + result.markdown
  return {
    content: [{
      type: "text",
      text: truncateResponse(fullText, MAX_RESPONSE_SIZE)
    }]
  }
}

// ─── 목록 포맷 (기존 동작) ────────────────────────────

function formatAnnexList(
  annexList: any[],
  lawType: string,
  input: GetAnnexesInput,
  normalizedLawName: string
): { content: Array<{ type: string, text: string }> } {
  const kndLabel = input.knd === "1" ? "별표"
                 : input.knd === "2" ? "서식"
                 : input.knd === "3" ? "부칙별표"
                 : input.knd === "4" ? "부칙서식"
                 : "별표/서식"

  let resultText = `법령명: ${normalizedLawName}\n`
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

  resultText += `\n⚠️ 별표 내용을 확인하려면 이 도구(get_annexes)를 bylSeq 파라미터와 함께 다시 호출하세요.\n예: get_annexes({ lawName: "${normalizedLawName}", bylSeq: "${annexList[0]?.별표번호 || '000100'}" })`
  resultText += `\n커넥터에서 bylSeq 입력이 제한되면 lawName에 별표번호를 함께 넣어 호출할 수 있습니다.\n예: get_annexes({ lawName: "${normalizedLawName} 별표4" })`

  return { content: [{ type: "text", text: resultText }] }
}

/**
 * 모법명 추출 (시행규칙/시행령 제거)
 * "여권법 시행규칙" → "여권법", "관세법 시행령" → "관세법"
 */
function extractParentLawName(lawName: string): string | null {
  const cleaned = lawName.replace(/\s*(시행규칙|시행령)$/, '')
  return cleaned !== lawName ? cleaned : null
}

function parseLawNameAndHint(lawName: string): { normalizedLawName: string, annexNo?: string } {
  const trimmedLawName = lawName.trim()
  const annexHintMatch = trimmedLawName.match(/\[?\s*(별표|서식)\s*(?:제)?\s*(\d{1,6})\s*(?:호)?\s*\]?/)

  if (!annexHintMatch) {
    return { normalizedLawName: trimmedLawName }
  }

  const parsedAnnexNo = Number.parseInt(annexHintMatch[2], 10)
  const normalizedLawName = trimmedLawName
    .replace(annexHintMatch[0], " ")
    .replace(/\s+/g, " ")
    .trim()

  return {
    normalizedLawName: normalizedLawName || trimmedLawName,
    annexNo: Number.isNaN(parsedAnnexNo) ? undefined : String(parsedAnnexNo)
  }
}

function findMatchingAnnex(annexList: any[], annexSelector: string): any | undefined {
  const selectorCandidates = buildSelectorCandidates(annexSelector)
  const selectorNumbers = extractSelectorNumbers(annexSelector)

  return annexList.find((annex: any) => {
    const annexNum = String(annex.별표번호 || "").trim()
    const annexTitle = String(annex.별표명 || "")

    if (annexNum && selectorCandidates.has(annexNum)) {
      return true
    }

    return selectorNumbers.some((num) => titleMatchesAnnexNumber(annexTitle, num))
  })
}

function buildSelectorCandidates(selector: string): Set<string> {
  const candidates = new Set<string>()
  const trimmed = selector.trim()

  if (!trimmed) {
    return candidates
  }

  candidates.add(trimmed)

  const numMatch = trimmed.match(/(\d{1,6})/)
  if (!numMatch) {
    return candidates
  }

  const rawDigits = numMatch[1]
  const asNumber = Number.parseInt(rawDigits, 10)
  if (Number.isNaN(asNumber)) {
    return candidates
  }

  candidates.add(rawDigits)
  candidates.add(String(asNumber))

  // 법제처 별표번호는 관행적으로 000100, 000200 형식이 많아 둘 다 허용
  candidates.add(String(asNumber).padStart(6, "0"))
  if (rawDigits.length <= 3) {
    candidates.add(String(asNumber * 100).padStart(6, "0"))
  }

  return candidates
}

function extractSelectorNumbers(selector: string): string[] {
  const numbers = new Set<string>()
  const numMatch = selector.match(/(\d{1,6})/)
  if (!numMatch) {
    return []
  }

  const rawDigits = numMatch[1]
  const asNumber = Number.parseInt(rawDigits, 10)
  if (Number.isNaN(asNumber)) {
    return []
  }

  numbers.add(String(asNumber))

  if (rawDigits.length === 6 && asNumber % 100 === 0) {
    numbers.add(String(asNumber / 100))
  }

  return Array.from(numbers)
}

function titleMatchesAnnexNumber(title: string, annexNumber: string): boolean {
  const escapedNumber = escapeRegex(annexNumber)
  const patterns = [
    new RegExp(`\\[\\s*별표\\s*${escapedNumber}\\s*\\]`),
    new RegExp(`별표\\s*제?\\s*${escapedNumber}\\s*(?:호)?`),
    new RegExp(`\\[\\s*서식\\s*${escapedNumber}\\s*\\]`),
    new RegExp(`서식\\s*제?\\s*${escapedNumber}\\s*(?:호)?`)
  ]

  if (patterns.some((pattern) => pattern.test(title))) {
    return true
  }

  // 묶음 별표 범위 매칭: "[별표1~5]", "[별표 1 ~ 5]" 등
  const num = Number.parseInt(annexNumber, 10)
  if (!Number.isNaN(num)) {
    const rangePattern = /별표\s*(\d+)\s*[~\-]\s*(\d+)/g
    let match: RegExpExecArray | null
    while ((match = rangePattern.exec(title)) !== null) {
      const start = Number.parseInt(match[1], 10)
      const end = Number.parseInt(match[2], 10)
      if (num >= start && num <= end) {
        return true
      }
    }
  }

  return false
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * 관련법규명으로 annexList 필터링: 사용자 쿼리와 가장 일치하는 조례 우선
 * 여러 조례(예: "광진구의회 복무 조례" vs "광진구 복무 조례")가 혼합된 경우 분리
 */
function filterByRelatedLawName(annexList: any[], queryName: string): any[] {
  if (annexList.length <= 1) return annexList

  // 쿼리에서 단어 추출
  const queryWords = queryName.split(/\s+/).filter((w) => w.length > 0)
  if (queryWords.length === 0) return annexList

  // 각 항목에 관련법규명 단어 매칭 점수 부여
  const scored = annexList.map((annex: any) => {
    const relatedName = String(annex.관련자치법규명 || annex.관련법령명 || "")
      .replace(/<[^>]+>/g, "")   // HTML 태그 제거
    const relatedWords = relatedName.split(/\s+/).filter((w) => w.length > 0)
    // 쿼리 단어가 관련법규명에 정확히 포함되는 수
    const score = queryWords.filter((qw) => relatedWords.includes(qw)).length
    return { annex, score }
  })

  const maxScore = Math.max(...scored.map((s) => s.score))
  if (maxScore === 0) return annexList

  // 최고 점수 항목만 필터 (동점 허용)
  const best = scored.filter((s) => s.score === maxScore).map((s) => s.annex)
  return best.length > 0 ? best : annexList
}
