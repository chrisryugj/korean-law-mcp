import { z } from "zod";
import type { LawApiClient } from "../lib/api-client.js";
import { truncateResponse } from "../lib/schemas.js";
import { parseSearchXML, extractTag } from "../lib/xml-parser.js";
import { formatToolError, noResultHint } from "../lib/errors.js";

// Common schema for committee decision search (query optional)
const baseSearchSchemaOptionalQuery = {
  query: z.string().optional().describe("검색 키워드"),
  display: z.number().min(1).max(100).default(20).describe("페이지당 결과 개수 (기본값: 20, 최대: 100)"),
  page: z.number().min(1).default(1).describe("페이지 번호 (기본값: 1)"),
  sort: z.enum(["lasc", "ldes", "dasc", "ddes"]).optional()
    .describe("정렬 옵션: lasc/ldes (법령명순), dasc/ddes (날짜순)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
};

// Common schema for committee decision search (query required)
const baseSearchSchemaRequiredQuery = {
  display: z.number().min(1).max(100).default(20).describe("페이지당 결과 개수 (기본값: 20, 최대: 100)"),
  page: z.number().min(1).default(1).describe("페이지 번호 (기본값: 1)"),
  sort: z.enum(["lasc", "ldes", "dasc", "ddes"]).optional()
    .describe("정렬 옵션: lasc/ldes (법령명순), dasc/ddes (날짜순)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
};

const baseTextSchema = {
  id: z.string().describe("결정문 일련번호 (검색 결과에서 획득)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
};

// ========================================
// 공정거래위원회 결정문 (FTC Decisions)
// ========================================

export const searchFtcDecisionsSchema = z.object({
  ...baseSearchSchemaRequiredQuery,
  query: z.string().describe("검색 키워드 (필수, 예: '담합', '불공정거래', '시정명령')"),
});

export type SearchFtcDecisionsInput = z.infer<typeof searchFtcDecisionsSchema>;

export async function searchFtcDecisions(
  apiClient: LawApiClient,
  args: SearchFtcDecisionsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  return searchCommitteeDecisions(apiClient, args, "ftc", "공정거래위원회 결정문", "get_ftc_decision_text");
}

export const getFtcDecisionTextSchema = z.object(baseTextSchema);
export type GetFtcDecisionTextInput = z.infer<typeof getFtcDecisionTextSchema>;

export async function getFtcDecisionText(
  apiClient: LawApiClient,
  args: GetFtcDecisionTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  return getCommitteeDecisionText(apiClient, args, "ftc", "공정거래위원회 결정문");
}

// ========================================
// 개인정보보호위원회 결정문 (PIPC Decisions)
// ========================================

export const searchPipcDecisionsSchema = z.object({
  ...baseSearchSchemaRequiredQuery,
  query: z.string().describe("검색 키워드 (필수, 예: '개인정보', '유출', '과징금')"),
});

export type SearchPipcDecisionsInput = z.infer<typeof searchPipcDecisionsSchema>;

export async function searchPipcDecisions(
  apiClient: LawApiClient,
  args: SearchPipcDecisionsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  return searchCommitteeDecisions(apiClient, args, "ppc", "개인정보보호위원회 결정문", "get_pipc_decision_text");
}

export const getPipcDecisionTextSchema = z.object(baseTextSchema);
export type GetPipcDecisionTextInput = z.infer<typeof getPipcDecisionTextSchema>;

export async function getPipcDecisionText(
  apiClient: LawApiClient,
  args: GetPipcDecisionTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  return getCommitteeDecisionText(apiClient, args, "ppc", "개인정보보호위원회 결정문");
}

// ========================================
// 중앙노동위원회 결정문 (NLRC Decisions)
// ========================================

export const searchNlrcDecisionsSchema = z.object({
  ...baseSearchSchemaOptionalQuery,
  query: z.string().optional().describe("검색 키워드 (예: '부당해고', '노동쟁의', '조정')"),
});

export type SearchNlrcDecisionsInput = z.infer<typeof searchNlrcDecisionsSchema>;

export async function searchNlrcDecisions(
  apiClient: LawApiClient,
  args: SearchNlrcDecisionsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  return searchCommitteeDecisions(apiClient, args, "nlrc", "중앙노동위원회 결정문", "get_nlrc_decision_text");
}

export const getNlrcDecisionTextSchema = z.object(baseTextSchema);
export type GetNlrcDecisionTextInput = z.infer<typeof getNlrcDecisionTextSchema>;

export async function getNlrcDecisionText(
  apiClient: LawApiClient,
  args: GetNlrcDecisionTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  return getCommitteeDecisionText(apiClient, args, "nlrc", "중앙노동위원회 결정문");
}

// ========================================
// 국민권익위원회 결정문 (ACR Decisions)
// ========================================

export const searchAcrDecisionsSchema = z.object({
  ...baseSearchSchemaOptionalQuery,
  query: z.string().optional().describe("검색 키워드 (예: '행정심판', '고충민원', '부패행위')"),
});

export type SearchAcrDecisionsInput = z.infer<typeof searchAcrDecisionsSchema>;

export async function searchAcrDecisions(
  apiClient: LawApiClient,
  args: SearchAcrDecisionsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  return searchCommitteeDecisions(apiClient, args, "acr", "국민권익위원회 결정문", "get_acr_decision_text");
}

export const getAcrDecisionTextSchema = z.object(baseTextSchema);
export type GetAcrDecisionTextInput = z.infer<typeof getAcrDecisionTextSchema>;

export async function getAcrDecisionText(
  apiClient: LawApiClient,
  args: GetAcrDecisionTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  return getCommitteeDecisionText(apiClient, args, "acr", "국민권익위원회 결정문");
}

// ========================================
// Common Implementation
// ========================================

async function searchCommitteeDecisions(
  apiClient: LawApiClient,
  args: { query?: string; display?: number; page?: number; sort?: string; apiKey?: string },
  target: string,
  committeeName: string,
  textToolName: string
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
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

    // parseSearchXML 사용 (rootTag: searchKey, itemTag: target)
    const searchKey = getSearchKey(target);
    const itemKey = target.toLowerCase();
    const { totalCnt, page: currentPage, items: decisions } = parseSearchXML(
      xmlText, searchKey, itemKey,
      (content) => ({
        결정일련번호: extractTag(content, "결정문일련번호") || extractTag(content, "결정일련번호") || extractTag(content, "판례일련번호") || extractTag(content, "일련번호"),
        사건명: extractTag(content, "사건명") || extractTag(content, "안건명") || extractTag(content, "제목"),
        사건번호: extractTag(content, "사건번호") || extractTag(content, "의안번호"),
        결정일자: extractTag(content, "결정일자") || extractTag(content, "의결일") || extractTag(content, "선고일자") || extractTag(content, "등록일"),
        결정유형: extractTag(content, "결정유형") || extractTag(content, "결정구분") || extractTag(content, "판결유형") || extractTag(content, "회의종류"),
        재결청: extractTag(content, "재결청") || extractTag(content, "기관명"),
        상세링크: extractTag(content, "결정문상세링크") || extractTag(content, "상세링크") || extractTag(content, "판례상세링크"),
      }),
      { useIndexOf: true }
    );

    const totalCount = totalCnt;

    if (totalCount === 0) {
      return noResultHint(args.query || "", committeeName)
    }

    let output = `${committeeName} 검색 결과 (총 ${totalCount}건, ${currentPage}페이지):\n\n`;

    for (const decision of decisions) {
      const title = decision.사건명 || "(제목 없음)";
      output += `[${decision.결정일련번호}] ${title}\n`;
      if (decision.사건번호) output += `  사건번호: ${decision.사건번호}\n`;
      if (decision.결정일자) output += `  결정일: ${decision.결정일자}\n`;
      if (decision.결정유형) output += `  결정유형: ${decision.결정유형}\n`;
      if (decision.재결청) output += `  재결청: ${decision.재결청}\n`;
      if (decision.상세링크) output += `  링크: ${decision.상세링크}\n`;
      output += `\n`;
    }

    // 후속 도구 안내 제거 (LLM이 이미 도구 목록을 알고 있음)

    return {
      content: [{
        type: "text",
        text: truncateResponse(output)
      }]
    };
  } catch (error) {
    return formatToolError(error, `search_${target}_decisions`);
  }
}

async function getCommitteeDecisionText(
  apiClient: LawApiClient,
  args: { id: string; apiKey?: string },
  target: string,
  committeeName: string
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const responseText = await apiClient.fetchApi({
      endpoint: "lawService.do",
      target,
      type: "JSON",
      extraParams: { ID: args.id },
      apiKey: args.apiKey,
    });

    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch (err) {
      throw new Error("Failed to parse JSON response from API");
    }

    const serviceKey = getServiceKey(target);
    if (!data[serviceKey]) {
      throw new Error(`${committeeName}을(를) 찾을 수 없거나 응답 형식이 올바르지 않습니다.`);
    }

    const decision = data[serviceKey];

    let output = `=== ${decision.사건명 || committeeName} ===\n\n`;

    output += `기본 정보:\n`;
    output += `  사건번호: ${decision.사건번호 || "N/A"}\n`;
    output += `  결정일자: ${decision.결정일자 || "N/A"}\n`;
    output += `  결정유형: ${decision.결정유형 || "N/A"}\n`;
    if (decision.당사자) output += `  당사자: ${decision.당사자}\n`;
    if (decision.피심인) output += `  피심인: ${decision.피심인}\n`;
    output += `\n`;

    if (decision.주문) {
      output += `주문:\n${decision.주문}\n\n`;
    }

    if (decision.결정요지 || decision.요지) {
      output += `결정요지:\n${decision.결정요지 || decision.요지}\n\n`;
    }

    if (decision.이유) {
      output += `이유:\n${decision.이유}\n\n`;
    }

    if (decision.참조조문) {
      output += `참조조문:\n${decision.참조조문}\n\n`;
    }

    if (decision.결정내용 || decision.전문) {
      output += `전문:\n${decision.결정내용 || decision.전문}\n`;
    }

    return {
      content: [{
        type: "text",
        text: truncateResponse(output)
      }]
    };
  } catch (error) {
    return formatToolError(error, `get_${target}_decision_text`);
  }
}

// Helper functions
function getSearchKey(target: string): string {
  const mapping: Record<string, string> = {
    ftc: "Ftc",
    ppc: "Ppc",
    nlrc: "Nlrc",
    acr: "Acr",
  };
  return mapping[target] || `${target.charAt(0).toUpperCase() + target.slice(1)}`;
}

function getServiceKey(target: string): string {
  const mapping: Record<string, string> = {
    ftc: "FtcService",
    ppc: "PpcService",
    nlrc: "NlrcService",
    acr: "AcrService",
  };
  return mapping[target] || `${target.charAt(0).toUpperCase() + target.slice(1)}Service`;
}

