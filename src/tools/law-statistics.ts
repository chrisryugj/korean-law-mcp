/**
 * get_law_statistics Tool - 법령 통계 기능
 */

import { z } from "zod"
import { DOMParser } from "@xmldom/xmldom"
import type { LawApiClient } from "../lib/api-client.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"
import { rethrowIfFatal } from "../lib/fatal-errors.js"
import { ExecutionLimitError } from "../lib/execution-limits.js"

export const LawStatisticsSchema = z.object({
  days: z.number().min(1).max(90).optional().default(30).describe("최근 변경 분석 기간 (일 단위, 기본값: 30, 최대: 90)"),
  limit: z.number().optional().default(10).describe("결과 개수 제한 (기본값: 10)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
})

export type LawStatisticsInput = z.infer<typeof LawStatisticsSchema>

export async function getLawStatistics(
  apiClient: LawApiClient,
  input: LawStatisticsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    return await getRecentChanges(apiClient, input.days, input.limit, input.apiKey)
  } catch (error) {
    return formatToolError(error, "get_law_statistics")
  }
}

/** 하루 조회 상한 (lsHstInf display 최대치) */
const DAY_PAGE_SIZE = 100

interface ChangeItem {
  lawName: string
  mst: string
  regDt: string
  promDate: string
  effDate: string
  type: string
}

/** 한국 시각 기준 YYYYMMDD. 서버는 UTC라 toISOString만 쓰면 오전 9시 전엔 '오늘'이 전날로 밀린다. */
function kstYmd(epochMs: number): string {
  return new Date(epochMs + 9 * 3_600_000).toISOString().slice(0, 10).replace(/-/g, "")
}

function formatYmd(ymd: string): string {
  return /^\d{8}$/.test(ymd) ? `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}` : (ymd || "N/A")
}

/**
 * 하루치 변경이력. 항목 태그는 `law`, 개정구분은 `제개정구분명`이다 (get_law_history와 같은 target).
 * 종전 코드는 존재하지 않는 `lsHstInf`·`개정구분명`을 찾아 매 호출 "총 0건"을 성공으로 냈다 (2026-09-23 리뷰 D2).
 */
async function fetchDay(apiClient: LawApiClient, regDt: string, apiKey?: string): Promise<{ items: ChangeItem[]; totalCnt: number }> {
  const xmlText = await apiClient.getLawHistory({ regDt, display: DAY_PAGE_SIZE, apiKey })
  const doc = new DOMParser().parseFromString(xmlText, "text/xml")
  const totalCnt = parseInt(doc.getElementsByTagName("totalCnt")[0]?.textContent || "0", 10)
  const laws = doc.getElementsByTagName("law")
  const items: ChangeItem[] = []
  for (let j = 0; j < laws.length; j++) {
    const law = laws[j]
    const text = (tag: string) => law.getElementsByTagName(tag)[0]?.textContent?.trim() || ""
    items.push({
      lawName: text("법령명한글") || "알 수 없음",
      mst: text("법령일련번호"),
      regDt,
      promDate: text("공포일자"),
      effDate: text("시행일자"),
      type: text("제개정구분명"),
    })
  }
  return { items, totalCnt: Number.isFinite(totalCnt) ? totalCnt : items.length }
}

/**
 * 최근 개정 법령 TOP N
 */
async function getRecentChanges(
  apiClient: LawApiClient,
  days: number,
  limit: number,
  apiKey?: string
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  // 최신일부터 거슬러 오른다. 요청 예산(기본 48회)이 먼저 바닥나도 잘리는 쪽이 가장 오래된 날이 되게 한다.
  // 종전처럼 오래된 날부터 돌면 days가 크면 정작 최근 며칠이 조용히 빠졌다 (2026-09-23 리뷰 D2).
  const now = Date.now()
  const dateStrings: string[] = []
  for (let i = 0; i <= days; i++) dateStrings.push(kstYmd(now - i * 86_400_000))

  // 병렬 API 호출 (동시 요청 5개씩 배치)
  const BATCH_SIZE = 5
  // regDt는 법제처 DB 반영일이라 같은 법령일련번호가 여러 날에 다시 나온다(실측 20260902 18건 중 9건이
  // 20260901에도 있음). 날짜별 합산은 중복 집계라 법령일련번호로 한 번만 센다. 최신 반영일을 남긴다.
  const byMst = new Map<string, ChangeItem>()
  const failedDays: string[] = []
  let firstFailure = ""
  const cappedDays: string[] = []
  const unscannedDays: string[] = []

  for (let i = 0; i < dateStrings.length; i += BATCH_SIZE) {
    const batch = dateStrings.slice(i, i + BATCH_SIZE)
    const settled = await Promise.allSettled(batch.map((dateStr) => fetchDay(apiClient, dateStr, apiKey)))

    settled.forEach((r, k) => {
      const day = batch[k]
      if (r.status === "fulfilled") {
        const { items, totalCnt } = r.value
        if (totalCnt > items.length) cappedDays.push(`${formatYmd(day)}(${totalCnt}건 중 ${items.length}건)`)
        for (const item of items) {
          const key = item.mst || `${item.lawName}:${item.promDate}`
          if (!byMst.has(key)) byMst.set(key, item)
        }
        return
      }
      // 예산 소진: 남은 날은 더 조회할 수 없다. 받은 날까지로 답하되 빠진 범위를 밝힌다.
      if (r.reason instanceof ExecutionLimitError) {
        unscannedDays.push(day)
        return
      }
      rethrowIfFatal(r.reason)   // 요청 취소는 그대로 던진다
      failedDays.push(day)
      if (!firstFailure) firstFailure = r.reason instanceof Error ? r.reason.message : String(r.reason)
    })

    if (unscannedDays.length > 0) {
      unscannedDays.push(...dateStrings.slice(i + BATCH_SIZE))
      break
    }
  }

  const scannedDays = dateStrings.length - failedDays.length - unscannedDays.length
  if (scannedDays === 0) {
    // 한 날도 받지 못했다. "0건"으로 답하면 개정이 없었다는 거짓 결론이 된다.
    throw new Error(
      `최근 ${days}일 법령 변경이력을 한 날도 조회하지 못했습니다 ` +
      `(조회 실패 ${failedDays.length}일, 요청 예산 소진으로 미조회 ${unscannedDays.length}일)` +
      // 키 없음·권한 오류(401/403)는 재시도로 낫지 않는다: 첫 실패 원인을 그대로 보여준다(독립 리뷰)
      (firstFailure ? `. 첫 실패 원인: ${firstFailure}` : ". 잠시 후 다시 시도하세요.")
    )
  }

  // 공포일 최신순 (같으면 반영일 최신순). 반영일만 최근인 과거 공포본(자료 정정분)은 뒤로 밀린다.
  const changes = [...byMst.values()].sort((a, b) =>
    (b.promDate || b.regDt).localeCompare(a.promDate || a.regDt) || b.regDt.localeCompare(a.regDt))
  const topChanges = changes.slice(0, limit)

  const newest = dateStrings[0]
  const oldest = dateStrings[dateStrings.length - 1]
  let resultText = `최근 ${days}일간 개정 법령 TOP ${limit}\n`
  resultText += `(법제처 법령 변경이력 반영일 ${formatYmd(oldest)} ~ ${formatYmd(newest)} 기준, 법령일련번호 기준 중복 제거, 공포일 최신순)\n\n`
  topChanges.forEach((change, idx) => {
    resultText += `${idx + 1}. ${change.lawName}\n`
    resultText += `   - 개정구분: ${change.type || "N/A"}\n`
    resultText += `   - 공포일: ${formatYmd(change.promDate)} / 시행일: ${formatYmd(change.effDate)}\n`
    resultText += `   - 변경이력 반영일: ${formatYmd(change.regDt)}\n\n`
  })

  resultText += `\n총 ${changes.length}건 (법령일련번호 기준, 반영일 기준 수집이라 과거 공포본의 자료 정정이 섞일 수 있음).`

  // 부분 결과는 부분이라고 말한다. 빠진 날을 밝히지 않으면 "그 기간 개정 없음"으로 읽힌다.
  const notes: string[] = []
  if (unscannedDays.length > 0) {
    notes.push(`⚠️ 요청 예산 소진으로 가장 오래된 ${unscannedDays.length}일(${formatYmd(unscannedDays[unscannedDays.length - 1])} ~ ${formatYmd(unscannedDays[0])})은 조회하지 못했습니다. 위 집계는 부분 결과입니다. days를 줄여 다시 조회하세요.`)
  }
  if (failedDays.length > 0) {
    notes.push(`⚠️ ${failedDays.length}일 조회 실패(${failedDays.map(formatYmd).join(", ")}): 그날 반영분은 집계에서 빠졌습니다.`)
  }
  if (cappedDays.length > 0) {
    notes.push(`⚠️ 하루 조회 상한(${DAY_PAGE_SIZE}건)에 걸린 날: ${cappedDays.join(", ")}. 나머지는 get_law_history(regDt, page)로 조회하세요.`)
  }
  if (notes.length > 0) resultText += `\n\n${notes.join("\n")}`

  return {
    content: [{
      type: "text",
      text: truncateResponse(resultText)
    }]
  }
}
