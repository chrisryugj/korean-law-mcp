/**
 * get_annexes Tool - 별표/서식 조회 + 텍스트 추출
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { fetchWithRetry } from "../lib/fetch-with-retry.js"
import { readResponseArrayBuffer } from "../lib/response-body.js"
import { isDownloadNoticeOnly, parseAnnexFile } from "../lib/annex-file-parser.js"
import { truncateResponse, MAX_RESPONSE_SIZE } from "../lib/schemas.js"
import { ErrorCodes, formatToolError, LawApiError, notFoundResponse } from "../lib/errors.js"
import { ExecutionLimitError } from "../lib/execution-limits.js"
import { getRequestSignal } from "../lib/session-state.js"
import { getLawSiteBaseUrl } from "../lib/law-url-config.js"
import { fetchLawAnnexUnits, findMissingUnits, pickAnnexUnit, type LawAnnexUnit } from "../lib/annex-canonical.js"
import { parseLawNameAndHint } from "../lib/annex-notation.js"
import { collectAnnexList, collectAdminAnnexList, ANNEX_PAGE_SIZE, MAX_ANNEX_PAGES, type AnnexTruncationReason } from "./annex-list.js"
import {
  buildSelectorCandidates, extractBundledSection, extractParentLawName, extractSelectorNumbers,
  filterByAnnexQuery, filterByArticle, filterByRelatedLawName, findMatchingAnnex, isBranchNumber,
  isBundledAnnex, listBundledSections,
  type AnnexItem,
} from "./annex-select.js"

const LAW_BASE_URL = getLawSiteBaseUrl()

export const GetAnnexesSchema = z.object({
  lawName: z.string().describe("법령명 (예: '관세법'). 별표를 바로 지정하려면 '... 별표4' 또는 '... 별표1의2'처럼 함께 입력 가능"),
  knd: z.enum(["1", "2", "3", "4", "5"]).optional().describe("1=별표, 2=서식, 3=부칙별표, 4=부칙서식, 5=전체"),
  bylSeq: z.string().optional().describe("별표번호 (예: '000300'). 지정 시 해당 별표 파일을 다운로드하여 텍스트로 추출"),
  annexNo: z.string().optional().describe("별표 번호 (예: '4', '별표4', '제4호'). bylSeq 대체 입력"),
  query: z.string().optional().describe("별표명으로 좁히기 (예: '운전면허 취소·정지', '과태료'). 번호를 모를 때 사용. 1건으로 좁혀지면 그 별표 본문을 바로 추출"),
  jo: z.string().optional().describe("위임 조문 (예: '제38조', '38'). 조문 동반 질의('관세법 제38조 별표2')의 조문 맥락 — 별표명의 '(제38조 관련)' 표기와 대조해 좁히고, 응답에 위임 관계를 표기"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
})

export type GetAnnexesInput = z.infer<typeof GetAnnexesSchema>

export async function getAnnexes(
  apiClient: LawApiClient,
  input: GetAnnexesInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const parsedLawInput = parseLawNameAndHint(input.lawName)
    const normalizedLawName = parsedLawInput.normalizedLawName || input.lawName
    // query에 "별표28"처럼 번호가 실려오면 그것도 선택값으로 인정한다 (#94)
    const queryHint = input.query ? parseLawNameAndHint(input.query).annexNo : undefined
    const annexSelector = (input.bylSeq || input.annexNo || parsedLawInput.annexNo || queryHint || "").trim()

    let annexList: AnnexItem[] = []
    let lawType: string = "law"
    // 100건 창에 갇힌 목록을 완전한 목록으로 보여주면 "그 별표는 없다"는 오답이 된다 (#148).
    // 절단 표시는 **실제로 표시되는 목록을 채운 단계**의 것만 채택한다 — 빈손으로 끝난
    // 단계의 절단을 남겨 두면 다른 모집단의 절단을 이 목록의 것처럼 알린다(N5).
    let listTruncated = false
    let listReason: AnnexTruncationReason | undefined

    const adopt = (r: { list: AnnexItem[], type: string, truncated: boolean, reason?: AnnexTruncationReason }) => {
      annexList = r.list
      lawType = r.type
      listTruncated = r.truncated
      listReason = r.reason
    }

    // 2026-09-23 리뷰 C9: 현행 본문(target=law, 실측 3.8MB)을 목록 병합과 본문 추출이 각각 받았다(fetchApi 캐시 없음).
    // 한 요청 안에서 MST 별로 기억한다. 실패는 기억하지 않아 종전처럼 추출 단계가 다시 시도한다.
    const unitsByMst = new Map<string, LawAnnexUnit[]>()
    const loadUnits = async (mst: string): Promise<LawAnnexUnit[]> => {
      const hit = unitsByMst.get(mst)
      if (hit) return hit
      const units = await fetchLawAnnexUnits(apiClient, mst, input.apiKey)
      unitsByMst.set(mst, units)
      return units
    }

    // "rung이 던졌다(장애)"와 "정상 응답인데 0건(부존재)"은 다른 사실이다 (#150).
    // 장애를 삼키고 전멸 끝에 "DB에 없습니다"를 내면 일시 장애가 부존재 단정으로 둔갑한다.
    const rungFailures: string[] = []
    const noteRungFailure = (error: unknown): void => {
      // 예산 소진·취소는 장애 관측이 아니라 중단 명령 — 다음 단으로 넘어가면 안 된다.
      if (error instanceof ExecutionLimitError || getRequestSignal()?.aborted) throw error
      rungFailures.push(error instanceof Error ? error.message : String(error))
    }

    // 1차: 원래 법령명 + knd 필터
    try {
      adopt(await collectAnnexList(apiClient, {
        lawName: normalizedLawName, knd: input.knd, apiKey: input.apiKey
      }))
    } catch (error) {
      noteRungFailure(error)
    }

    // 2차: 결과 없으면 knd 제거 (법제처가 "별표"를 "서식"으로 분류하는 경우)
    if (annexList.length === 0 && input.knd) {
      try {
        adopt(await collectAnnexList(apiClient, {
          lawName: normalizedLawName, apiKey: input.apiKey
        }))
      } catch (error) {
        noteRungFailure(error)
      }
    }

    // 3차: 모법명으로 재검색 ("여권법 시행규칙" → "여권법")
    if (annexList.length === 0) {
      const parentName = extractParentLawName(normalizedLawName)
      if (parentName) {
        try {
          const result3 = await collectAnnexList(apiClient, {
            lawName: parentName, apiKey: input.apiKey
          })
          // 원래 법령명 매칭 필터
          const filtered = result3.list.filter((a: AnnexItem) => {
            const name = String(a.관련법령명 || a.관련자치법규명 || a.관련행정규칙명 || "").replace(/<[^>]+>/g, "")
            return name === normalizedLawName
          })
          // 필터가 걸리면 표시 모집단이 모법 전체가 아니다 — 그때의 절단은 이 목록의 사실이 아니다
          const narrowed = filtered.length > 0
          adopt({
            list: narrowed ? filtered : result3.list,
            type: result3.type,
            truncated: narrowed ? false : result3.truncated,
            reason: narrowed ? undefined : result3.reason,
          })
        } catch (error) {
          noteRungFailure(error)
        }
      }
    }

    // 4차: 행정규칙(고시/훈령/예규) 별표 admin fallback.
    // "사료 등의 기준 및 규격"처럼 제목에 '고시·훈령' 등 종류 키워드가 없는 행정규칙은
    // detectLawType이 'law'로 분류해 licbyl만 조회하고 admbyl 경로를 놓친다(#58).
    // 앞 단계가 모두 비면 종류 무관하게 admbyl로 재조회한다.
    if (annexList.length === 0) {
      try {
        const result4 = await collectAdminAnnexList(apiClient, {
          lawName: normalizedLawName, apiKey: input.apiKey
        })
        if (result4.list.length > 0) adopt({ ...result4, type: "admin" })
      } catch (error) {
        noteRungFailure(error)
      }
    }

    if (annexList.length === 0) {
      // 어느 단도 정상 목록을 주지 못했고 장애 관측이 있다 — 부존재를 단정할 근거가 없다.
      if (rungFailures.length > 0) {
        return formatToolError(new LawApiError(
          `"${normalizedLawName}" 별표/서식 조회 실패 — 존재 여부를 확인할 수 없습니다 (업스트림 장애: ${rungFailures[0]})`,
          ErrorCodes.UPSTREAM_NO_DATA,
          [
            "⚠️ 이 응답은 별표/서식의 부존재를 증명하지 않습니다. '해당 별표 없음'으로 단정하지 마세요.",
            "잠시 후 같은 호출을 다시 시도하세요.",
          ],
        ), "get_annexes")
      }
      return notFoundResponse(
        `"${normalizedLawName}"에 대한 별표/서식이 법제처 DB에 없습니다.`,
        [
          "법령명 오탈자 확인 (예: '관세법 시행령' vs '관세법')",
          `search_law({ query: "${normalizedLawName}" }) 로 정확한 법령명 확인`,
          "모법에 별표가 있을 수 있음 (시행규칙 대신 시행령으로 재시도)",
        ]
      )
    }

    // 최신본 우선 정렬
    annexList.sort((a: AnnexItem, b: AnnexItem) =>
      (b.자치법규시행일자 || b.공포일자 || "").localeCompare(a.자치법규시행일자 || a.공포일자 || "")
    )

    // 관련법규명 필터링: 사용자 쿼리와 가장 일치하는 조례 우선
    const filtered = filterByRelatedLawName(annexList, normalizedLawName)

    // 별표 선택값 지정 시 → 해당 별표 파일 다운로드 + 텍스트 추출
    if (annexSelector) {
      return await extractAnnexContent(apiClient, filtered, annexSelector, normalizedLawName, lawType, input, loadUnits)
    }

    // 별표 선택값 미지정 → 목록 반환. 법령은 현행 본문 별표단위와 대조해
    // licbyl 인덱스에 없는 항목(개정 신설 별표 등)을 병합 표시 (#77 후속)
    let listForDisplay = filtered
    let mergeIssue: string | undefined
    if (lawType === "law") {
      const msts = new Set(filtered.map((a) => String(a.관련법령일련번호 || "")))
      const mst = msts.size === 1 ? [...msts][0] : ""
      if (mst) {
        try {
          const units = await loadUnits(mst)
          const missing = findMissingUnits(filtered, units)
          listForDisplay = [
            ...filtered,
            ...missing.map((u): AnnexItem => ({
              별표번호: u.code6,
              별표명: `${u.title} [현행 본문 신규 — 검색 인덱스 미등재]`,
              별표종류: u.kind,
              별표서식파일링크: u.hwpLink,
              별표서식PDF파일링크: u.pdfLink,
              관련법령명: normalizedLawName,
            })),
          ]
        } catch {
          // 병합 실패를 삼키면 신설 별표가 빠진 목록이 완전한 목록으로 보인다 (#127).
          // 목록 자체는 유효하므로 isError가 아니라 마커로 알린다.
          mergeIssue = "현행 본문 조회 실패"
        }
      } else {
        mergeIssue = "대상 법령일련번호 미확정"
      }
    }

    // query 키워드로 목록을 좁힌다 (#94). 번호를 모르는 호출자에게는 이것이
    // 특정 별표(도로교통법 시행규칙 별표28 등)에 도달하는 유일한 경로이므로,
    // 1건으로 확정되면 목록 대신 본문까지 바로 준다.
    // 조문 슬롯이 오면 별표명의 위임 표기와 대조해 먼저 좁힌다 (#133)
    const byArticle = filterByArticle(listForDisplay, input.jo)
    const scoped = filterByAnnexQuery(byArticle.list, input.query)
    const onlySeq = scoped.list.length === 1 ? String(scoped.list[0].별표번호 || "").trim() : ""
    if (scoped.matched && scoped.keywords.length > 0 && onlySeq) {
      return await extractAnnexContent(apiClient, scoped.list, onlySeq, normalizedLawName, lawType, input, loadUnits)
    }
    return formatAnnexList(scoped.list, lawType, input, normalizedLawName, scoped, mergeIssue, listTruncated, listReason, byArticle)
  } catch (error) {
    return formatToolError(error, "get_annexes")
  }
}

// ─── 별표 텍스트 추출 ─────────────────────────────────

async function extractAnnexContent(
  apiClient: LawApiClient,
  annexList: AnnexItem[],
  annexSelector: string,
  normalizedLawName: string,
  lawType: string,
  input: GetAnnexesInput,
  loadUnits: (mst: string) => Promise<LawAnnexUnit[]> = (mst) => fetchLawAnnexUnits(apiClient, mst, input.apiKey)
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  const knd = input.knd
  // bylSeq / annexNo / lawName 내 힌트로 유연 매칭 (별표/서식 구분 위해 knd 전달)
  let matched = findMatchingAnnex(annexList, annexSelector, knd)

  // 법령은 현행 본문(lawService)의 별표단위 링크를 정본으로 우선 사용 (#77 — licbyl
  // 인덱스가 구본/결함 파일을 가리키거나 신설 별표를 누락하는 사례). 실패 시 licbyl 폴백.
  let canonicalIssue = false
  if (lawType === "law") {
    const mst = matched?.관련법령일련번호 || annexList[0]?.관련법령일련번호
    if (mst) {
      try {
        const units = await loadUnits(String(mst))
        const unit = pickAnnexUnit(units, {
          code6: matched?.별표번호 ? String(matched.별표번호).trim() : undefined,
          kind: matched?.별표종류 ? String(matched.별표종류) : undefined,
          selectorCandidates: matched ? undefined : buildSelectorCandidates(annexSelector),
          knd,
        })
        if (unit) {
          matched = {
            ...(matched ?? {}),
            별표번호: matched?.별표번호 || unit.code6,
            별표명: matched?.별표명 || unit.title,
            별표종류: matched?.별표종류 || unit.kind,
            별표서식파일링크: unit.hwpLink || matched?.별표서식파일링크,
            별표서식PDF파일링크: unit.pdfLink || matched?.별표서식PDF파일링크,
          }
        }
      } catch {
        // 정본 조회 실패 → licbyl 링크로 진행. 그 링크가 구본을 가리킬 수 있다는
        // 사실을 삼키면 구본 내용이 현행으로 읽힌다 (#127, #77과 같은 손실).
        canonicalIssue = true
      }
    }
  }

  if (!matched) {
    const availableBylSeq = annexList.map((a) => a.별표번호).filter(Boolean).slice(0, 20).join(", ")
    return notFoundResponse(
      `별표 선택값 "${annexSelector}"에 해당하는 항목을 찾을 수 없습니다. (법령: ${normalizedLawName})`,
      [
        `사용 가능한 별표번호(일부): ${availableBylSeq || "없음"}`,
        `예: get_annexes({ lawName: "${normalizedLawName}", bylSeq: "${annexList[0]?.별표번호 || "000100"}" })`,
        `예: get_annexes({ lawName: "${normalizedLawName} 별표4" })`,
      ]
    )
  }

  const annexTitle = matched.별표명 || "제목 없음"
  const fileLink = matched.별표서식파일링크 || matched.별표서식PDF파일링크 || matched.별표파일링크 || ""

  if (!fileLink) {
    return notFoundResponse(
      `"${annexTitle}"의 파일 링크가 법제처 응답에 포함되지 않았습니다.`,
      ["법령 전체 별표 목록을 다시 조회하세요: get_annexes({ lawName: '...' })"]
    )
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

  const buffer = await readResponseArrayBuffer(response)
  const result = await parseAnnexFile(buffer)

  if (result.fileType === "pdf" && result.isImageBased) {
    // 이미지 기반 PDF: 텍스트 추출 불가 → 링크 안내
    const pdfLink = matched.별표서식PDF파일링크 || fileLink
    return {
      content: [{
        type: "text",
        text: `${annexTitle}\n\n이미지 기반 PDF입니다 (${result.pageCount || "?"}페이지). 텍스트 추출이 불가합니다.\n다운로드 링크: ${LAW_BASE_URL}${pdfLink}`
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

  // 파싱은 성공했지만 파일에 내용이 없고 다운로드 안내만 담긴 경우 (#91).
  // 그대로 성공 반환하면 호출자가 "내용이 짧은 별표"로 오인해 빈 근거로 답을 만든다.
  if (isDownloadNoticeOnly(result.markdown)) {
    const link = matched.별표서식PDF파일링크 || fileLink
    return {
      content: [{
        type: "text",
        text: `[${ErrorCodes.ANNEX_BODY_UNAVAILABLE}] ${normalizedLawName} - ${annexTitle}\n\n` +
          `이 별표는 파일에 내용이 인라인돼 있지 않고 다운로드 안내만 들어 있습니다 ` +
          `(파일 형식: ${result.fileType.toUpperCase()}).\n` +
          `⚠️ 별표 본문을 확보하지 못했습니다. 이 응답을 근거로 별표 내용을 서술하지 마세요.\n` +
          `원문 파일: ${LAW_BASE_URL}${link}`
      }],
      isError: true
    }
  }

  // 파싱 성공 - 묶음 별표면 요청 섹션만 추출
  let markdown = result.markdown
  const selectorNumbers = extractSelectorNumbers(annexSelector)
  if (selectorNumbers.length > 0 && isBundledAnnex(annexTitle)) {
    const extracted = extractBundledSection(markdown, selectorNumbers[0])
    if (extracted) {
      markdown = extracted
    } else if (isBranchNumber(selectorNumbers[0])) {
      // 가지번호를 못 찾았는데 묶음 전체를 주면, 그 안에 실재하는 옆 번호(별표 17)를
      // 요청한 별표 17의12로 읽는다 — 근처에 그럴듯한 오답이 있는 상황이라
      // 조용한 폴백이 곧 오답이 된다. 명시 실패로 돌린다.
      const sections = listBundledSections(markdown)
      return notFoundResponse(
        `${normalizedLawName} - ${annexTitle}: 묶음 문서에서 별표 ${selectorNumbers[0]} 섹션을 찾지 못했습니다.`,
        [
          sections.length > 0
            ? `이 문서가 담은 섹션: ${sections.join(", ")}`
            : "이 문서에서 섹션 표제를 찾지 못했습니다.",
          "get_annexes를 번호 없이 호출해 별표 목록을 먼저 확인하세요.",
        ],
      )
    }
  }

  const canonicalNote = canonicalIssue
    ? `⚠️ 정본 링크 확인 불가 (현행 본문 조회 실패) — 검색 인덱스(licbyl) 링크로 조회했습니다.\n` +
      `   최신 개정이 반영되지 않은 구본일 수 있습니다.\n`
    : ""
  const header = `${normalizedLawName} - ${annexTitle}\n(파일 형식: ${result.fileType.toUpperCase()}${result.pageCount ? `, ${result.pageCount}페이지` : ""})\n${canonicalNote}\n`
  const fullText = header + markdown
  return {
    content: [{
      type: "text",
      text: truncateResponse(fullText, MAX_RESPONSE_SIZE)
    }]
  }
}

// ─── 목록 포맷 (기존 동작) ────────────────────────────

/** 실제로 일어난 중단을 그대로 적는다 — 건수도 사유도 추정하지 않는다 */
function describeTruncation(collected: number, reason?: AnnexTruncationReason): string {
  switch (reason) {
    case "no-progress":
      return `별표 목록을 ${collected}건까지 받은 뒤 업스트림이 새 항목을 주지 않아 중단했습니다 — 뒤쪽 별표가 빠졌을 수 있습니다.`
    case "unknown-total":
      return `업스트림이 전체 건수를 밝히지 않아 첫 ${collected}건(한 페이지)만 받았습니다 — 뒤쪽 별표가 더 있을 수 있습니다.`
    case "page-cap":
    default:
      return `별표가 많아 ${collected}건까지만 수집했습니다 (상한 ${MAX_ANNEX_PAGES * ANNEX_PAGE_SIZE}건) — 뒤쪽 별표는 이 목록에 없습니다.`
  }
}

function formatAnnexList(
  annexList: AnnexItem[],
  lawType: string,
  input: GetAnnexesInput,
  normalizedLawName: string,
  scope?: { keywords: string[], matched: boolean },
  mergeIssue?: string,
  truncated?: boolean,
  truncationReason?: AnnexTruncationReason,
  articleScope?: { article?: string, matched: boolean }
): { content: Array<{ type: string, text: string }> } {
  const kndLabel = input.knd === "1" ? "별표"
                 : input.knd === "2" ? "서식"
                 : input.knd === "3" ? "부칙별표"
                 : input.knd === "4" ? "부칙서식"
                 : "별표/서식"

  let resultText = `법령명: ${normalizedLawName}\n`
  resultText += `${kndLabel} 목록 (총 ${annexList.length}건`
  if (scope?.keywords.length && scope.matched) {
    resultText += `, query="${scope.keywords.join(" ")}" 적용`
  }
  resultText += `):\n\n`
  // 필터가 0건이면 전체 목록을 주되 그 사실을 밝힌다 — 조용히 전체를 주면
  // "필터가 걸린 결과"로 오인된다(#94가 보고한 증상 그 자체)
  if (scope?.keywords.length && !scope.matched) {
    resultText = `법령명: ${normalizedLawName}\n` +
      `⚠️ query="${scope.keywords.join(" ")}"와 일치하는 별표명이 없어 전체 목록을 표시합니다.\n` +
      `${kndLabel} 목록 (총 ${annexList.length}건):\n\n`
  }

  // 조문 맥락은 목록 바로 위에 — 어떤 조문으로 좁힌 목록인지(또는 못 좁혔는지) 밝힌다 (#133)
  if (articleScope?.article) {
    resultText = (articleScope.matched
      ? `▶ ${articleScope.article} 위임 별표로 좁힌 목록입니다 (별표명의 "(${articleScope.article} 관련)" 표기 기준).\n\n`
      : `⚠️ ${articleScope.article}을(를) 근거로 밝힌 별표가 없어 전체 목록을 표시합니다 — 아래 별표들이 그 조문의 위임이라는 뜻이 아닙니다.\n\n`
    ) + resultText
  }

  // 수집 상한도 맨 앞에 — 부분 목록을 전체로 읽으면 "그 별표는 없다"는 오답이 된다 (#148).
  // 사유를 구분해 적는다: 셋 중 둘은 500건과 무관한데 한 문구로 뭉치면 틀린 원인을
  // 알리고 "500건까지는 봤다"는 잘못된 안심을 준다(N3).
  if (truncated) {
    resultText = `⚠️ ${describeTruncation(annexList.length, truncationReason)}\n` +
      `   찾는 별표가 없으면 lawName에 별표번호를 함께 넣어(예: "${normalizedLawName} 별표4") 직접 호출하세요.\n\n` +
      resultText
  }

  // 병합 미수행은 목록 맨 앞에 — 20건 표시 상한이나 절단에 밀려 사라지면 안 된다 (#127)
  if (mergeIssue) {
    resultText = `⚠️ 신설 별표 병합 확인 불가 (${mergeIssue}) — 아래는 검색 인덱스(licbyl) 기준 목록이며,\n` +
      `   최근 개정으로 신설된 별표가 빠져 있을 수 있습니다. 찾는 별표가 없으면 법령 본문에서 직접 확인하세요.\n\n` +
      resultText
  }

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
        resultText += `   관련법규: ${relatedLaw.replace(/<[^>]+>/g, '')}\n`
      }
      if (localGov) {
        resultText += `   지자체: ${localGov}\n`
      }
    } else if (lawType === "admin") {
      if (annex.관련행정규칙명) resultText += `   행정규칙: ${annex.관련행정규칙명}\n`
      const dept = annex.소관부처명 || annex.소관부처
      if (dept) resultText += `   소관부처: ${dept}\n`
    } else {
      if (annex.관련법령명) resultText += `   관련법령: ${annex.관련법령명}\n`
    }

    resultText += `\n`
  }

  if (annexList.length > maxItems) {
    resultText += `\n... 외 ${annexList.length - maxItems}개 항목 (생략)\n`
  }

  resultText += `\n[주의] 별표 내용을 확인하려면 이 도구(get_annexes)를 bylSeq 파라미터와 함께 다시 호출하세요.\n예: get_annexes({ lawName: "${normalizedLawName}", bylSeq: "${annexList[0]?.별표번호 || '000100'}" })`
  resultText += `\n커넥터에서 bylSeq 입력이 제한되면 lawName에 별표번호를 함께 넣어 호출할 수 있습니다.\n예: get_annexes({ lawName: "${normalizedLawName} 별표4" })`

  return { content: [{ type: "text", text: truncateResponse(resultText) }] }
}
