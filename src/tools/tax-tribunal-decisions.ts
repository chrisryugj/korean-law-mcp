import { z } from "zod";
import type { LawApiClient } from "../lib/api-client.js";
import { parseTaxTribunalXML } from "../lib/xml-parser.js";
import { truncateResponse } from "../lib/schemas.js";
import { formatToolError, noResultHint } from "../lib/errors.js";

// Tax tribunal decision search tool - Search for special administrative appeals decisions
export const searchTaxTribunalDecisionsSchema = z.object({
  query: z.string().optional().describe("Search keyword (e.g., '자동차', '부가가치세')"),
  display: z.number().min(1).max(100).default(20).describe("Results per page (default: 20, max: 100)"),
  page: z.number().min(1).default(1).describe("Page number (default: 1)"),
  cls: z.string().optional().describe("Decision type code (재결구분코드)"),
  gana: z.string().optional().describe("Dictionary search (ga, na, da, etc.)"),
  dpaYd: z.string().optional().describe("Disposition date range (YYYYMMDD~YYYYMMDD, e.g., '20200101~20201231')"),
  rslYd: z.string().optional().describe("Decision date range (YYYYMMDD~YYYYMMDD, e.g., '20200101~20201231')"),
  sort: z.enum(["lasc", "ldes", "dasc", "ddes", "nasc", "ndes"]).optional()
    .describe("Sort option: lasc/ldes (decision name), dasc/ddes (decision date), nasc/ndes (claim number)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
});

export type SearchTaxTribunalDecisionsInput = z.infer<typeof searchTaxTribunalDecisionsSchema>;

export async function searchTaxTribunalDecisions(
  apiClient: LawApiClient,
  args: SearchTaxTribunalDecisionsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const extraParams: Record<string, string> = {
      display: (args.display || 20).toString(),
      page: (args.page || 1).toString(),
    };
    if (args.query) extraParams.query = args.query;
    if (args.cls) extraParams.cls = args.cls;
    if (args.gana) extraParams.gana = args.gana;
    if (args.dpaYd) extraParams.dpaYd = args.dpaYd;
    if (args.rslYd) extraParams.rslYd = args.rslYd;
    if (args.sort) extraParams.sort = args.sort;

    const xmlText = await apiClient.fetchApi({
      endpoint: "lawSearch.do",
      target: "ttSpecialDecc",
      extraParams,
      apiKey: args.apiKey,
    });

    // 공통 파서 사용
    const result = parseTaxTribunalXML(xmlText);
    const totalCount = result.totalCnt;
    const currentPage = result.page;
    const deccs = result.items;

    if (totalCount === 0) {
      return noResultHint(args.query || "", "조세심판원 재결례")
    }

    let output = `조세심판원 재결례 검색 결과 (총 ${totalCount}건, ${currentPage}페이지):\n\n`;

    for (const decc of deccs) {
      output += `[${decc.특별행정심판재결례일련번호}] ${decc.사건명}\n`;
      output += `  청구번호: ${decc.청구번호 || "N/A"}\n`;
      output += `  의결일자: ${decc.의결일자 || "N/A"}\n`;
      output += `  처분일자: ${decc.처분일자 || "N/A"}\n`;
      output += `  재결청: ${decc.재결청 || "N/A"}\n`;
      output += `  재결구분: ${decc.재결구분명 || "N/A"}\n`;
      if (decc.행정심판재결례상세링크) {
        output += `  링크: ${decc.행정심판재결례상세링크}\n`;
      }
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
    return formatToolError(error, "search_tax_tribunal_decisions");
  }
}

// Tax tribunal decision text retrieval tool - Get full text of a specific decision
export const getTaxTribunalDecisionTextSchema = z.object({
  id: z.string().describe("Tax tribunal decision serial number (특별행정심판재결례일련번호) from search results"),
  decisionName: z.string().optional().describe("Decision name (optional, for verification)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
});

export type GetTaxTribunalDecisionTextInput = z.infer<typeof getTaxTribunalDecisionTextSchema>;

export async function getTaxTribunalDecisionText(
  apiClient: LawApiClient,
  args: GetTaxTribunalDecisionTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const extraParams: Record<string, string> = { ID: args.id };
    if (args.decisionName) extraParams.LM = args.decisionName;

    const responseText = await apiClient.fetchApi({
      endpoint: "lawService.do",
      target: "ttSpecialDecc",
      type: "JSON",
      extraParams,
      apiKey: args.apiKey,
    });

    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch (err) {
      throw new Error("Failed to parse JSON response from API");
    }

    if (!data.SpecialDeccService) {
      throw new Error("Tax tribunal decision not found or invalid response format");
    }

    const decc = data.SpecialDeccService;
    const basic = {
      사건명: decc.사건명,
      사건번호: decc.사건번호,
      청구번호: decc.청구번호,
      처분일자: decc.처분일자,
      의결일자: decc.의결일자,
      처분청: decc.처분청,
      재결청: decc.재결청,
      재결례유형명: decc.재결례유형명,
      세목: decc.세목
    };
    const content = {
      재결요지: decc.재결요지,
      따른결정: decc.따른결정,
      참조결정: decc.참조결정,
      주문: decc.주문,
      청구취지: decc.청구취지,
      이유: decc.이유,
      관련법령: decc.관련법령
    };

    let output = `=== ${basic.사건명 || "Tax Tribunal Decision"} ===\n\n`;

    output += `기본 정보:\n`;
    output += `  사건번호: ${basic.사건번호 || "N/A"}\n`;
    output += `  청구번호: ${basic.청구번호 || "N/A"}\n`;
    output += `  처분일자: ${basic.처분일자 || "N/A"}\n`;
    output += `  의결일자: ${basic.의결일자 || "N/A"}\n`;
    output += `  처분청: ${basic.처분청 || "N/A"}\n`;
    output += `  재결청: ${basic.재결청 || "N/A"}\n`;
    output += `  재결유형: ${basic.재결례유형명 || "N/A"}\n`;
    output += `  세목: ${basic.세목 || "N/A"}\n\n`;

    if (content.재결요지) {
      output += `재결요지:\n${content.재결요지}\n\n`;
    }

    if (content.주문) {
      output += `주문:\n${content.주문}\n\n`;
    }

    if (content.청구취지) {
      output += `청구취지:\n${content.청구취지}\n\n`;
    }

    if (content.이유) {
      output += `이유:\n${content.이유}\n\n`;
    }

    if (content.따른결정) {
      output += `따른결정:\n${content.따른결정}\n\n`;
    }

    if (content.참조결정) {
      output += `참조결정:\n${content.참조결정}\n\n`;
    }

    if (content.관련법령) {
      output += `관련법령:\n${content.관련법령}\n`;
    }

    return {
      content: [{
        type: "text",
        text: truncateResponse(output)
      }]
    };
  } catch (error) {
    return formatToolError(error, "get_tax_tribunal_decision_text");
  }
}
