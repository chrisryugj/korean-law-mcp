/**
 * MCP 도구 및 3단비교 데이터 타입 정의
 */

import { z } from "zod"
import type { LawApiClient } from "./api-client.js"

/**
 * MCP 도구 응답 타입
 */
export interface ToolResponse {
  content: Array<{ type: "text"; text: string }>
  isError?: boolean
}

/**
 * MCP 도구 정의 인터페이스
 */
/** 도구 핸들러가 반환할 수 있는 느슨한 타입 (도구 함수가 { type: string } 으로 반환해도 허용) */
export interface LooseToolResponse {
  content: Array<{ type: string; text: string }>
  isError?: boolean
}

export interface McpTool {
  /** 도구 이름 (snake_case) */
  name: string
  /** 도구 설명 */
  description: string
  /** Zod 입력 스키마 */
  schema: z.ZodSchema
  /** 도구 핸들러 함수 (input 타입은 Zod 런타임 검증으로 보장, 도구별 구체 타입은 handler 내부에서 적용) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (apiClient: LawApiClient, input: any) => Promise<LooseToolResponse>
}

export interface ThreeTierMeta {
  lawId: string
  lawName: string
  lawSummary: string
  sihyungryungId: string
  sihyungryungName: string
  sihyungryungSummary: string
  sihyungkyuchikId: string
  sihyungkyuchikName: string
  sihyungkyuchikSummary: string
  exists: boolean
  basis: string
}

export interface DelegationItem {
  type: "시행령" | "시행규칙" | "행정규칙"
  lawName: string
  jo?: string
  joNum?: string
  title: string
  content: string
}

export interface CitationItem {
  type: string
  lawName: string
  jo?: string
  joNum?: string
  title: string
  content: string
}

export interface ThreeTierArticle {
  jo: string
  joNum: string
  title: string
  content: string
  delegations: DelegationItem[]
  citations: CitationItem[]
}

export interface ThreeTierData {
  meta: ThreeTierMeta
  articles: ThreeTierArticle[]
  kndType: "위임조문" | "인용조문"
}
