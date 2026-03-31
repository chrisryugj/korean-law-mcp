import { z } from "zod";
import type { LawApiClient } from "../lib/api-client.js";
import { parseTaxTribunalXML } from "../lib/xml-parser.js";
import { truncateResponse } from "../lib/schemas.js";

// ========================================
// Common helpers (소청심사위원회 + 국민권익위 특별행정심판 공통)
// ========================================

const baseSearchSchema = {
  query: z.string().optional().describe("검색 키워드"),
  display: z.number().min(1).max(100).default(20).describe("페이지당 결과 개수 (기본값: 20, 최대: 100)"),
  page: z.number().min(1).default(1).describe("페이지 번호 (기본값: 1)"),
  sort: z.enum(["lasc", "ldes", "dasc", "ddes", "nasc", "ndes"]).optional()
    .describe("정렬 옵션: lasc/ldes (재결례명순), dasc/ddes (의결일자순), nasc/ndes (사건번호순)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
};

const baseTextSchema = {
  id: z.string().describe("특별행정심판재결례일련번호 (검색 결과에서 획득)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
};

async function searchSpecialAppeals(
  apiClient: LawApiClient,
  args: { query?: string; display?: number; page?: number; sort?: string; apiKey?: string },
  target: string,
  label: string,
  textToolName: string
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    const extraParams: Record<string, string> = {
      display: (args.display || 20).toString(),
      page: (args.page || 1).toString(),
    };
    if (args.query) extraParams.query = args.query;
    if (args.sort) extraParams.sort = args.sort;

    const xmlText = await apiClient.fetchApi({
      endpoint: "lawSearch.do",
      target,
      extraParams,
      apiKey: args.apiKey,
    });

    // 조세심판원과 동일한 XML 구조 (Decc 루트, decc 항목)
    const result = parseTaxTribunalXML(xmlText);

    if (result.totalCnt === 0) {
      return {
        content: [{ type: "text", text: `${label} 검색 결과가 없습니다. 다른 키워드를 시도하세요.` }],
        isError: true,
      };
    }

    let output = `${label} 검색 결과 (총 ${result.totalCnt}건, ${result.page}페이지):\n\n`;
    for (const decc of result.items) {
      output += `[${decc.특별행정심판재결례일련번호}] ${decc.사건명}\n`;
      if (decc.청구번호) output += `  청구번호: ${decc.청구번호}\n`;
      if (decc.의결일자) output += `  의결일: ${decc.의결일자}\n`;
      if (decc.처분일자) output += `  처분일: ${decc.처분일자}\n`;
      if (decc.재결청) output += `  재결청: ${decc.재결청}\n`;
      if (decc.재결구분명) output += `  재결구분: ${decc.재결구분명}\n`;
      if (decc.행정심판재결례상세링크) output += `  링크: ${decc.행정심판재결례상세링크}\n`;
      output += `\n`;
    }
    output += `\n전문 조회: ${textToolName}(id="특별행정심판재결례일련번호")`;

    return { content: [{ type: "text", text: output }] };
  } catch (error) {
    return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
  }
}

async function getSpecialAppealText(
  apiClient: LawApiClient,
  args: { id: string; apiKey?: string },
  target: string,
  label: string
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    const responseText = await apiClient.fetchApi({
      endpoint: "lawService.do",
      target,
      type: "JSON",
      extraParams: { ID: args.id },
      apiKey: args.apiKey,
    });

    let data: any;
    try { data = JSON.parse(responseText); } catch { throw new Error("Failed to parse JSON response from API"); }

    if (!data.SpecialDeccService) {
      throw new Error(`${label}을(를) 찾을 수 없거나 응답 형식이 올바르지 않습니다.`);
    }

    const decc = data.SpecialDeccService;
    let output = `=== ${decc.사건명 || label} ===\n\n`;

    output += `기본 정보:\n`;
    output += `  사건번호: ${decc.사건번호 || "N/A"}\n`;
    if (decc.청구번호) output += `  청구번호: ${decc.청구번호}\n`;
    if (decc.처분일자) output += `  처분일: ${decc.처분일자}\n`;
    if (decc.의결일자) output += `  의결일: ${decc.의결일자}\n`;
    if (decc.처분청) output += `  처분청: ${decc.처분청}\n`;
    if (decc.재결청) output += `  재결청: ${decc.재결청}\n`;
    if (decc.재결례유형명) output += `  유형: ${decc.재결례유형명}\n`;
    output += `\n`;

    if (decc.재결요지) output += `재결요지:\n${decc.재결요지}\n\n`;
    if (decc.주문) output += `주문:\n${decc.주문}\n\n`;
    if (decc.청구취지) output += `청구취지:\n${decc.청구취지}\n\n`;
    if (decc.이유) output += `이유:\n${decc.이유}\n\n`;
    if (decc.따른결정) output += `따른결정:\n${decc.따른결정}\n\n`;
    if (decc.참조결정) output += `참조결정:\n${decc.참조결정}\n\n`;
    if (decc.관련법령) output += `관련법령:\n${decc.관련법령}\n`;

    return { content: [{ type: "text", text: truncateResponse(output) }] };
  } catch (error) {
    return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
  }
}

// ========================================
// 소청심사위원회 (Appeal Review Committee)
// ========================================

export const searchAppealReviewDecisionsSchema = z.object({
  ...baseSearchSchema,
  query: z.string().optional().describe("검색 키워드 (예: '파면', '해임', '징계', '감봉')"),
});
export type SearchAppealReviewDecisionsInput = z.infer<typeof searchAppealReviewDecisionsSchema>;

export async function searchAppealReviewDecisions(apiClient: LawApiClient, args: SearchAppealReviewDecisionsInput) {
  return searchSpecialAppeals(apiClient, args, "adapSpecialDecc", "소청심사위원회 재결례", "get_appeal_review_decision_text");
}

export const getAppealReviewDecisionTextSchema = z.object(baseTextSchema);
export type GetAppealReviewDecisionTextInput = z.infer<typeof getAppealReviewDecisionTextSchema>;

export async function getAppealReviewDecisionText(apiClient: LawApiClient, args: GetAppealReviewDecisionTextInput) {
  return getSpecialAppealText(apiClient, args, "adapSpecialDecc", "소청심사위원회 재결례");
}

// ========================================
// 국민권익위 특별행정심판 (ACR Special Appeals)
// ========================================

export const searchAcrSpecialAppealsSchema = z.object({
  ...baseSearchSchema,
  query: z.string().optional().describe("검색 키워드 (예: '국민권익', '행정심판', '고충')"),
});
export type SearchAcrSpecialAppealsInput = z.infer<typeof searchAcrSpecialAppealsSchema>;

export async function searchAcrSpecialAppeals(apiClient: LawApiClient, args: SearchAcrSpecialAppealsInput) {
  return searchSpecialAppeals(apiClient, args, "acrSpecialDecc", "국민권익위 특별행정심판 재결례", "get_acr_special_appeal_text");
}

export const getAcrSpecialAppealTextSchema = z.object(baseTextSchema);
export type GetAcrSpecialAppealTextInput = z.infer<typeof getAcrSpecialAppealTextSchema>;

export async function getAcrSpecialAppealText(apiClient: LawApiClient, args: GetAcrSpecialAppealTextInput) {
  return getSpecialAppealText(apiClient, args, "acrSpecialDecc", "국민권익위 특별행정심판 재결례");
}
