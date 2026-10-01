/**
 * CLI 쿼리 실행 엔진
 * 도구 호출, 자연어 라우팅 실행, 파이프라인 처리
 */

import { z } from "zod"
import { LawApiClient } from "./api-client.js"
import { allTools, findOversizedArg } from "../tool-registry.js"
import { maskToolText } from "./tool-output.js"
import { routeQuery, type RouteResult } from "./query-router.js"
import { SEARCH_DETAIL_CHAINS } from "./tool-chain-config.js"
import type { ToolResponse } from "./types.js"
import { fmt, printRouteInfo, formatOutput } from "./cli-format.js"
import { explainRoute } from "./route-explain.js"

// ────────────────────────────────────────
// API Client
// ────────────────────────────────────────

export function getApiClient(): LawApiClient {
  const apiKey = process.env.LAW_OC || ""
  if (!apiKey) {
    console.error(fmt.red("LAW_OC 환경변수가 필요합니다."))
    console.error(fmt.dim("API 키 발급: https://open.law.go.kr/LSO/openApi/guideResult.do"))
    process.exit(1)
  }
  return new LawApiClient({ apiKey })
}

// ────────────────────────────────────────
// Core: Execute Tool
// ────────────────────────────────────────

export async function executeTool(
  apiClient: LawApiClient,
  toolName: string,
  params: Record<string, unknown>
): Promise<ToolResponse> {
  const tool = allTools.find(t => t.name === toolName)
  if (!tool) {
    return {
      content: [{ type: "text", text: `알 수 없는 도구: ${toolName}` }],
      isError: true,
    }
  }

  try {
    const oversized = findOversizedArg(params)
    if (oversized) throw new Error(`인자가 너무 깁니다: ${oversized}`)
    const parsed = tool.schema.parse(params)
    const result = await tool.handler(apiClient, parsed) as ToolResponse
    return { ...result, content: result.content.map(c => ({ ...c, text: maskToolText(c.text, params) })) }
  } catch (error) {
    // Zod 검증 실패 등 모든 예외를 ToolResponse로 감싸서 반환
    const msg = error instanceof z.ZodError
      ? error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")
      : (error instanceof Error ? error.message : String(error))
    return {
      content: [{ type: "text", text: maskToolText(`오류 [${toolName}]: ${msg}`, params) }],
      isError: true,
    }
  }
}

// ────────────────────────────────────────
// Natural Query Execution
// ────────────────────────────────────────

/**
 * 자연어에서 뽑힌 날짜 범위를 검색 파라미터에 주입 (두 실행 경로 공용).
 * 이미 라우팅이 확정한 fromDate/toDate 는 보존한다 — "관세법 2024 vs 올해"에서
 * time_travel 이 뽑은 20240101 을 '올해' 규칙의 범위로 덮으면 앵커가 파괴된다(#150)
 */
export function applyDateRange(route: RouteResult): void {
  if (!route.dateRange) return
  if (route.params.fromDate === undefined) route.params.fromDate = route.dateRange.from
  if (route.params.toDate === undefined) route.params.toDate = route.dateRange.to
}

/**
 * 자연어 쿼리 실행 (라우팅 + 파이프라인)
 */
export async function executeNaturalQuery(
  apiClient: LawApiClient,
  query: string,
  verbose: boolean
): Promise<void> {
  const route = routeQuery(query)

  if (verbose) {
    // 이미 라우팅한 결과를 넘긴다 — 설명기가 다시 계산하면 날짜 파싱까지 두 번 돌고
    // 설명이 실제 실행된 라우팅과 갈릴 수 있다(#132)
    console.log(fmt.dim(explainRoute(query, route)))
  } else {
    printRouteInfo(route.tool, route.reason)
  }

  // 해석이 갈리는 질의는 먼저 확인을 요청한다 (#122)
  if (route.clarify) {
    console.log(fmt.yellow(`❓ ${route.clarify}`))
  }

  // 목적지가 받지 않는 파라미터는 조용히 버려진다 — 미적용 사실을 알린다 (#120)
  if (route.unsupportedParams?.length) {
    const target = route.pipeline?.[0]?.tool ?? route.tool
    console.log(fmt.yellow(
      `⚠️  ${target}는 ${route.unsupportedParams.join(", ")} 옵션을 지원하지 않습니다 — 축약된 결과가 표시됩니다.`
    ))
  }

  // 날짜 범위가 있으면 검색 파라미터에 주입
  if (route.dateRange) {
    applyDateRange(route)
    // 받지 못하는 도구면 Zod가 조용히 버린다 — 필터가 사라졌다는 사실은 알려야 한다
    if (!acceptsDateRange(route.tool)) {
      console.log(fmt.yellow(
        `⚠️  ${route.tool}는 기간 필터를 받지 않습니다 — ` +
        `"${route.dateRange.from}~${route.dateRange.to}" 조건은 적용되지 않았습니다.`
      ))
    }
  }

  // 1단계: 메인 도구 실행
  const result = await executeTool(apiClient, route.tool, route.params)

  // 파이프라인이 있으면 1단계 결과에서 ID 추출하여 2단계 실행
  if (route.pipeline && route.pipeline.length > 0 && !result.isError) {
    const firstOutput = result.content[0]?.text || ""
    const pipeId = extractPipelineId(route.tool, firstOutput)

    if (pipeId) {
      // 자동 체인: 검색 결과 요약 먼저 출력
      if (route.autoChain) {
        const summary = extractSearchSummary(firstOutput)
        if (summary) {
          console.log(fmt.dim(summary))
          console.log()
        }
      }

      for (const step of route.pipeline) {
        const pipeParams = { ...step.params, ...pipeId }

        if (verbose) {
          console.log(fmt.dim(`  → 체인: ${step.tool}(${JSON.stringify(pipeParams)})`))
        }

        const pipeResult = await executeTool(apiClient, step.tool, pipeParams)
        console.log(formatOutput(pipeResult.content.map(c => c.text).join("\n")))

        if (pipeResult.isError) {
          process.exitCode = 1
        }
      }
      return
    }

    // ID 추출 실패 → 1단계 결과라도 표시
    console.log(formatOutput(firstOutput))
    if (!route.autoChain) {
      console.log(fmt.yellow("💡 파이프라인: 검색 결과에서 식별자를 추출하지 못했습니다."))
    }
    return
  }

  // 결과 출력
  console.log(formatOutput(result.content.map(c => c.text).join("\n")))

  if (result.isError) {
    process.exitCode = 1
  }
}

/**
 * 자연어 쿼리 JSON 출력 (top-level --json 플래그)
 */
export async function executeNaturalQueryJson(
  apiClient: LawApiClient,
  query: string
): Promise<void> {
  const route = routeQuery(query)
  try {
    // 날짜 범위가 있으면 검색 파라미터에 주입
    applyDateRange(route)

    const result = await executeTool(apiClient, route.tool, route.params)
    let isError = Boolean(result.isError)

    let pipelineResult: string | undefined
    if (route.pipeline && route.pipeline.length > 0 && !result.isError) {
      const firstOutput = result.content[0]?.text || ""
      const pipeId = extractPipelineId(route.tool, firstOutput)
      if (pipeId) {
        // 단계마다 실행한다 — 첫 단계만 쓰면 "민법 제309조·제310조"의 두 번째 조문이 사라진다
        const outputs: string[] = []
        for (const step of route.pipeline) {
          const pResult = await executeTool(apiClient, step.tool, { ...step.params, ...pipeId })
          outputs.push(pResult.content.map(c => c.text).join("\n"))
          isError ||= Boolean(pResult.isError)
        }
        pipelineResult = outputs.join("\n\n")
      }
    }

    console.log(JSON.stringify({
      query,
      route: { tool: route.tool, reason: route.reason, params: route.params },
      result: result.content.map(c => c.text).join("\n"),
      pipelineResult,
      isError,
    }, null, 2))
    if (isError) process.exitCode = 1
  } catch (error) {
    console.log(JSON.stringify({
      query,
      route: { tool: route.tool, reason: route.reason },
      error: error instanceof Error ? error.message : String(error),
    }, null, 2))
    process.exit(1)
  }
}

// ────────────────────────────────────────
// Pipeline Helpers
// ────────────────────────────────────────

/** 도구 스키마가 기간 필터(fromDate)를 받는지 */
function acceptsDateRange(toolName: string): boolean {
  const tool = allTools.find(t => t.name === toolName)
  const shape = tool?.schema instanceof z.ZodObject ? tool.schema.shape : undefined
  return !!shape && "fromDate" in shape
}

/**
 * 파이프라인 ID 추출 (검색 도구별 설정 또는 기본 MST 패턴)
 */
function extractPipelineId(
  searchTool: string,
  output: string
): Record<string, string> | null {
  // 1. 체인 설정이 있으면 해당 regex 사용
  const chain = SEARCH_DETAIL_CHAINS[searchTool]
  if (chain) {
    const match = output.match(chain.idRegex)
    if (match) {
      return { [chain.detailParam]: match[1] }
    }
    return null
  }

  // 2. 기본: search_law → get_law_text 파이프라인 (MST/lawId)
  const mstMatch = output.match(/MST:\s*(\d+)/)
  if (mstMatch) return { mst: mstMatch[1] }

  const lawIdMatch = output.match(/법령ID:\s*(\d+)/)
  if (lawIdMatch) return { lawId: lawIdMatch[1] }

  return null
}

/**
 * 검색 결과에서 요약 헤더를 추출 (첫 3줄 정도)
 */
function extractSearchSummary(output: string): string | null {
  const lines = output.split("\n")
  // 첫 줄(제목)과 결과 건수 라인 추출
  const summaryLines: string[] = []
  for (const line of lines) {
    if (summaryLines.length >= 3) break
    const trimmed = line.trim()
    if (!trimmed) continue
    summaryLines.push(trimmed)
  }
  return summaryLines.length > 0 ? summaryLines.join("\n") : null
}
