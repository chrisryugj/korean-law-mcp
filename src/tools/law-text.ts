/**
 * get_law_text Tool - 법령 조문 조회
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { buildJO } from "../lib/law-parser.js"
import { lawCache } from "../lib/cache.js"
import { formatArticleUnit } from "../lib/article-parser.js"
import { getStrategyWarning } from "../lib/article-warnings.js"
import { formatToolError } from "../lib/errors.js"
import { rethrowIfFatal } from "../lib/fatal-errors.js"
import { fetchLineageVersions, versionInForce } from "../lib/law-lineage.js"
import { formatDateDot } from "../lib/schemas.js"
import { normalizeDate } from "./applicable-law.js"

import { MAX_RESPONSE_SIZE, truncateResponse } from "../lib/schemas.js"

export const GetLawTextSchema = z.object({
  mst: z.string().optional().describe("법령일련번호 (search_law에서 획득)"),
  lawId: z.string().optional().describe("법령ID (search_law에서 획득)"),
  jo: z.string().optional().describe("조문 번호. 자연어 표기 권장 — '제38조'·'제148조의2'를 그대로 넣으면 서버가 변환한다. 6자리 JO 코드 직접 지정 시 조번호 4자리 zero-pad + 의X 2자리: 제38조→003800, 제10조의2→001002, 제234조의2→023402(234002 아님)"),
  efYd: z.string().optional().describe("기준일 또는 시행일자 (YYYYMMDD). 시행일이면 그 버전, 시행일이 아닌 날짜(건축허가일·사건일 같은 조회 기준일)면 그날 시행 중이던 버전으로 자동 보정한다(제명이 바뀌기 전 버전 포함). 현행 본문은 efYd 없이 조회할 것. 시행예정본은 search_law 가 안내한 efYd 를 그대로 쓴다."),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
}).refine(data => data.mst || data.lawId, {
  message: "mst 또는 lawId 중 하나는 필수입니다"
})

export type GetLawTextInput = z.infer<typeof GetLawTextSchema>

type LawTextResponse = { content: Array<{ type: string, text: string }>, isError?: boolean }

export async function getLawText(
  apiClient: LawApiClient,
  input: GetLawTextInput
): Promise<LawTextResponse> {
  try {
    return await renderLawText(apiClient, input)
  } catch (error) {
    return formatToolError(error, "get_law_text")
  }
}

/** 본문 조회·렌더. 오류를 던진다 — 기준일 보정의 재귀 호출이 예산 소진·취소를 "시행일 없음"으로 삼키지 않게 */
async function renderLawText(apiClient: LawApiClient, input: GetLawTextInput): Promise<LawTextResponse> {
  {
    // 조문 번호가 한글이면 JO 코드로 변환
    let joCode = input.jo
    if (joCode && /제\d+조/.test(joCode)) {
      try {
        joCode = buildJO(joCode)
      } catch (e) {
        return {
          content: [{
            type: "text",
            text: `조문 번호 변환 실패: ${e instanceof Error ? e.message : String(e)}`
          }],
          isError: true
        }
      }
    }

    // Check cache first (efYd 정규화: 미지정 → 'current'로 통일)
    // mst·lawId 는 번호 체계가 달라 같은 값이 다른 법령이다(001706: mst=사방사업법, lawId=민법) — 접두로 가른다
    const cacheKey = `lawtext:${input.mst ? `m${input.mst}` : `i${input.lawId}`}:${joCode || 'full'}:${input.efYd || 'current'}`
    // MST·efYd 는 버전을 못박으므로 하루를 둔다. lawId 만 준 "현행" 조회는 개정 시행일을 넘기면
    // 다른 본문이 현행이 되므로 1시간만 둔다(24시간이면 시행일 당일 옛 본문이 나갔다, 리뷰 A8).
    const cacheTtl = input.mst || input.efYd ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000
    const cached = lawCache.get<string>(cacheKey)
    if (cached) {
      return {
        content: [{
          type: "text",
          text: cached
        }]
      }
    }

    let jsonText: string
    try {
      jsonText = await apiClient.getLawText({
        mst: input.mst,
        lawId: input.lawId,
        jo: joCode,
        efYd: input.efYd,
        efYdMayMiss: true,   // 사용자가 준 efYd 는 시행일이 아닐 수 있다 — 미스면 사다리 대신 확인 1회 뒤 아래 보정으로
        apiKey: input.apiKey
      })
    } catch (error) {
      // 없는 시행일에 조문(JO)까지 붙으면 빈 봉투가 아니라 HTML 미스로 온다 — 아래 빈 봉투와 같이 기준일 보정을 시도한다
      if (!input.efYd) throw error
      rethrowIfFatal(error)
      const redirected = await retryAtVersionInForce(apiClient, input, joCode)
      if (!redirected) throw error
      lawCache.set(cacheKey, redirected, cacheTtl)
      return { content: [{ type: "text", text: redirected }] }
    }

    const json = JSON.parse(jsonText)

    // JSON 구조 파싱 (LexDiff 방식 적용)
    const lawData = json?.법령
    if (!lawData) {
      // efYd 가 시행일이 아니면(흔히 "조회 기준일"로 오늘·사건일을 넣는다, #160) 그날 시행 중이던 버전으로 다시 조회한다
      if (input.efYd) {
        const redirected = await retryAtVersionInForce(apiClient, input, joCode)
        if (redirected) {
          lawCache.set(cacheKey, redirected, cacheTtl)
          return { content: [{ type: "text", text: redirected }] }
        }
      }
      // efYd 가 붙어 있으면 그게 1순위 용의자다. 종전 메시지는 무조건 mst/lawId 를 탓해,
      // 식별자가 멀쩡한데도 "search_law 로 유효한 mst 를 확인하라"고 엉뚱한 곳을 가리켰다
      // (#160: search_law 가 준 mst/lawId 그대로인데 efYd 에 오늘 날짜를 넣어 NOT_FOUND).
      const retryArg = input.mst ? `mst="${input.mst}"` : `lawId="${input.lawId || ""}"`
      const hint = input.efYd
        ? `⚠️ efYd=${input.efYd} 에 시행 중이던 버전을 찾지 못했습니다 (그 법령의 최초 시행일보다 앞선 날짜이거나 연혁 조회가 실패했을 수 있습니다).\n→ 현행 본문: get_law_text(${retryArg}) 로 efYd 없이 재조회\n→ 시행예정본: search_law 가 안내한 efYd 를 그대로 사용\n→ 그 시점 적용 법령 판단: legal_analysis(mode="applicable_law")\nmst/lawId 자체는 유효할 수 있습니다.`
        : `⚠️ 법제처 API가 해당 mst/lawId에 대해 데이터를 반환하지 않았습니다. search_law로 유효한 mst를 먼저 확인하세요.`
      return {
        content: [{
          type: "text",
          text: `[NOT_FOUND] 법령 데이터를 찾을 수 없습니다.\n\n${hint}\n\nLLM이 조문을 추측/생성하지 마세요.`
        }],
        isError: true
      }
    }

    // 조문 범위 파싱 함수
    const extractArticleRange = (data: any): { min: number, max: number, count: number } | null => {
      const rawUnits = data.조문?.조문단위
      if (!rawUnits) return null

      const units = Array.isArray(rawUnits) ? rawUnits : [rawUnits]
      const articleNumbers: number[] = []

      for (const unit of units) {
        if (unit.조문여부 === "조문" && unit.조문번호) {
          const num = parseInt(unit.조문번호, 10)
          if (!isNaN(num)) articleNumbers.push(num)
        }
      }

      if (articleNumbers.length === 0) return null

      return {
        min: Math.min(...articleNumbers),
        max: Math.max(...articleNumbers),
        count: articleNumbers.length
      }
    }

    const basicInfo = lawData.기본정보 || lawData
    const lawName = basicInfo?.법령명_한글 || basicInfo?.법령명한글 || basicInfo?.법령명 || "알 수 없음"
    const promDate = basicInfo?.공포일자 || ""
    const effDate = basicInfo?.시행일자 || basicInfo?.최종시행일자 || ""
    const prevLawName = basicInfo?.이전법령명 || ""

    let resultText = `법령명: ${lawName}\n`
    if (prevLawName) resultText += `(구 법령명: ${prevLawName} — 개정/분법으로 명칭 변경됨)\n`
    if (promDate) resultText += `공포일: ${promDate}\n`
    if (effDate) resultText += `시행일: ${effDate}\n`

    // 현행성 라벨: LLM이 옛 버전 조문을 현행으로 오인하지 않도록
    // 조회 시점 날짜와 시행일자를 비교해 명시
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "")
    if (input.efYd) {
      resultText += `⚠️ 특정 시행일자(efYd=${input.efYd}) 버전 조회 — 현행 법령이 아닐 수 있음. 현행 기준 답변에는 efYd 없이 재조회할 것.\n`
    } else if (effDate && String(effDate) > today) {
      resultText += `⚠️ 시행 예정 버전 (조회기준일 ${today} 현재 미시행). 현재 효력 있는 조문과 다를 수 있음.\n`
    } else if (effDate) {
      resultText += `ℹ️ 조회기준일 ${today} — 위 시행일 버전 본문. 연혁 MST로 조회한 경우 과거 버전일 수 있으니, 개정 여부가 의심되면 search_law로 [현행] MST를 재확인할 것.\n`
    }
    resultText += `\n`

    // 조문 내용 추출 (정확한 경로: 법령.조문.조문단위)
    // 주의: 조문단위는 배열 또는 객체일 수 있음
    const rawUnits = lawData.조문?.조문단위
    let articleUnits: any[] = []

    if (Array.isArray(rawUnits)) {
      articleUnits = rawUnits
    } else if (rawUnits && typeof rawUnits === 'object') {
      articleUnits = [rawUnits]  // 단일 객체를 배열로 변환
    }

    if (articleUnits.length === 0) {
      // 조문 범위 확인
      const range = extractArticleRange(lawData)
      let errorMsg = resultText + "[NOT_FOUND] 조문 내용을 찾을 수 없습니다.\n⚠️ LLM은 조문을 추측/생성하지 말고 아래 안내대로 재조회하세요."

      if (input.jo) {
        // 특정 조문 요청했는데 없는 경우
        if (range) {
          errorMsg += `\n\n이 법령은 제${range.min}조~제${range.max}조까지 총 ${range.count}개 조문만 존재합니다.`
          errorMsg += `\n\n해결 방법:`
          errorMsg += `\n   1. 전체 조회:`
          if (input.mst) {
            errorMsg += `\n      get_law_text(mst="${input.mst}")`
          } else if (input.lawId) {
            errorMsg += `\n      get_law_text(lawId="${input.lawId}")`
          }
          errorMsg += `\n\n   2. 유사 조문 조회 예시:`
          const suggestJo = Math.max(1, range.max - 3)
          if (input.mst) {
            errorMsg += `\n      get_law_text(mst="${input.mst}", jo="제${range.max}조")`
            errorMsg += `\n      get_law_text(mst="${input.mst}", jo="제${suggestJo}조")`
          } else if (input.lawId) {
            errorMsg += `\n      get_law_text(lawId="${input.lawId}", jo="제${range.max}조")`
            errorMsg += `\n      get_law_text(lawId="${input.lawId}", jo="제${suggestJo}조")`
          }
          errorMsg += `\n\n   3. 키워드 검색:`
          errorMsg += `\n      execute_tool(tool_name="search_all", params={query:"${lawName.replace(/\s+(시행령|시행규칙)/, '')}"})`
        } else {
          errorMsg += `\n\n[NOT_FOUND] 조문을 찾을 수 없습니다. 다음을 시도해보세요:`
          errorMsg += `\n   - 전체 법령 조회 (jo 파라미터 생략)`
          errorMsg += `\n   - 키워드 검색 (search_all 도구 사용)`
        }
      }

      return {
        content: [{
          type: "text",
          text: errorMsg
        }],
        isError: true
      }
    }

    // 조문 미지정 시 전체 법령 대신 목차(조문 제목 목록)만 반환
    // 대형 법령(국가공무원법 등)의 "too large content" 에러 방지
    if (!input.jo && articleUnits.length > 20) {
      const tocItems: string[] = []
      for (const unit of articleUnits) {
        if (unit.조문여부 !== "조문") continue
        const joNum = unit.조문번호 || ""
        const joBranch = unit.조문가지번호 || ""
        const joTitle = unit.조문제목 || ""
        if (joNum) {
          const displayNum = joBranch && joBranch !== "0" ? `제${joNum}조의${joBranch}` : `제${joNum}조`
          tocItems.push(`${displayNum}${joTitle ? ` ${joTitle}` : ""}`)
        }
      }

      let tocText = resultText
      tocText += `목차 (총 ${tocItems.length}개 조문)\n\n`
      tocText += tocItems.join("\n")
      tocText += `\n\n특정 조문 조회: get_law_text(`
      if (input.mst) {
        tocText += `mst="${input.mst}", jo="제XX조")`
      } else if (input.lawId) {
        tocText += `lawId="${input.lawId}", jo="제XX조")`
      }
      tocText += `\n여러 조문 일괄 조회: get_batch_articles 도구 사용`

      // 절단본을 캐시 — 캐시 히트 경로는 절단 없이 반환하므로 미절단 캐시 시 5만 자 제한 우회됨
      const truncatedToc = truncateResponse(tocText)
      lawCache.set(cacheKey, truncatedToc, cacheTtl)
      return {
        content: [{
          type: "text",
          text: truncatedToc
        }]
      }
    }

    for (const unit of articleUnits) {
      const formatted = formatArticleUnit(unit)
      if (!formatted) continue

      if (formatted.header) resultText += `${formatted.header}\n`
      if (formatted.body) resultText += `${formatted.body}\n\n`

      // 민법 의사표시 하자 조문(107~110)에 전략 경고 주입
      const warning = getStrategyWarning(lawName, unit.조문번호 || "", unit.조문가지번호 || "")
      if (warning) resultText += `${warning}\n\n`
    }

    // 응답 크기 제한 - 조문 경계에서 자르기 (mid-article 절단 방지)
    if (resultText.length > MAX_RESPONSE_SIZE) {
      const totalArticles = articleUnits.filter(u => u.조문여부 === "조문").length

      // 조문 헤더 위치를 역순으로 찾아서 MAX_RESPONSE_SIZE 이내의 마지막 완전한 조문 경계에서 자르기
      const articleHeaderPattern = /^제\d+조(?:의\d+)?/gm
      let lastSafePos = 0
      let includedCount = 0
      let match
      while ((match = articleHeaderPattern.exec(resultText)) !== null) {
        if (match.index > MAX_RESPONSE_SIZE - 200) break // 200자 여유 (안내 메시지용)
        lastSafePos = match.index
        includedCount++
      }

      // 마지막 조문 이후의 내용도 포함 (조문 본문)
      if (lastSafePos > 0 && includedCount > 0) {
        // 다음 조문 헤더 전까지 또는 끝까지
        const nextArticlePattern = /^제\d+조(?:의\d+)?/gm
        nextArticlePattern.lastIndex = lastSafePos + 1
        const nextMatch = nextArticlePattern.exec(resultText)
        const cutPos = nextMatch && nextMatch.index <= MAX_RESPONSE_SIZE - 200
          ? nextMatch.index
          : Math.min(resultText.length, MAX_RESPONSE_SIZE - 200)
        resultText = resultText.slice(0, cutPos)
      } else {
        resultText = resultText.slice(0, MAX_RESPONSE_SIZE - 200)
      }

      // 포함된 조문 번호 추출
      const includedArticles: string[] = []
      const finalHeaderPattern = /^(제\d+조(?:의\d+)?)/gm
      let m
      while ((m = finalHeaderPattern.exec(resultText)) !== null) {
        includedArticles.push(m[1])
      }

      const first = includedArticles[0] || "?"
      const last = includedArticles[includedArticles.length - 1] || "?"

      resultText += `\n\n[응답 크기 제한] ${totalArticles}개 조문 중 ${includedArticles.length}개만 포함 (${first}~${last})`
      resultText += `\n나머지 조문 조회: get_law_text(`
      if (input.mst) {
        resultText += `mst="${input.mst}", jo="제XX조")`
      } else if (input.lawId) {
        resultText += `lawId="${input.lawId}", jo="제XX조")`
      }
      resultText += `\n여러 조문 일괄 조회: get_batch_articles 도구 사용`
    }

    // Cache the result
    lawCache.set(cacheKey, resultText, cacheTtl)

    return {
      content: [{
        type: "text",
        text: resultText
      }]
    }
  }
}

/**
 * efYd 를 기준일로 보고 그날 시행 중이던 버전(MST+시행일)으로 다시 조회한다. 못 풀면 undefined(호출부가 NOT_FOUND).
 * 과거본은 eflaw 에 MST+시행일로만 닿는다(lawId+efYd 는 빈 봉투, 2026-09-28 실측). 법령ID는 lawId 가 오면 그대로,
 * mst 만 오면 target=law&MST&JO=000100(약 2KB)으로 얻어 계보를 받는다. 재귀 호출은 실재 시행일이라 다시 오지 않는다.
 * 예산 소진·취소는 올린다(rethrowIfFatal) — 공개 도구(getLawText)를 거치면 그게 "시행일 없음"으로 바뀌었다.
 */
async function retryAtVersionInForce(apiClient: LawApiClient, input: GetLawTextInput, joCode?: string): Promise<string | undefined> {
  const ymd = normalizeDate(input.efYd || "")
  if (!ymd) return undefined
  try {
    let lawId = input.lawId
    if (!lawId && input.mst) {
      const head = JSON.parse(await apiClient.getLawText({ mst: input.mst, jo: "000100", apiKey: input.apiKey }))
      lawId = head?.법령?.기본정보?.법령ID
    }
    if (!lawId) return undefined
    const { versions } = await fetchLineageVersions(apiClient, String(lawId), input.apiKey)
    const v = versionInForce(versions, ymd)
    if (!v || (v.efYd === input.efYd && v.mst === input.mst)) return undefined
    const r = await renderLawText(apiClient, { mst: v.mst, jo: joCode, efYd: v.efYd, apiKey: input.apiKey })
    if (r.isError) return undefined
    const where = `시행 ${formatDateDot(v.efYd)}, 공포 제${v.ancNo}호${v.rrCls ? ` ${v.rrCls}` : ""}, MST ${v.mst}${v.lawNm ? `, 당시 법령명 「${v.lawNm}」` : ""}`
    // 시행일은 맞는데 lawId 라서 안 나온 경우(과거본은 MST+시행일로만 닿는다)와 시행일이 아닌 경우를 가른다
    const note = v.efYd === ymd
      ? `ℹ️ efYd=${input.efYd} 버전은 lawId 로는 조회되지 않아 MST 로 조회했습니다: ${where}\n`
      : `ℹ️ efYd=${input.efYd}는 이 법령의 시행일이 아니어서, 그날(${formatDateDot(ymd)}) 시행 중이던 버전으로 조회했습니다: ${where}\n`
    return note + r.content.map(c => c.text).join("\n")
  } catch (error) {
    rethrowIfFatal(error)
    return undefined
  }
}
