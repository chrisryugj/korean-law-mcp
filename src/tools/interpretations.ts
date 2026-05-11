import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { parseInterpretationXML } from "../lib/xml-parser.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError, noResultHint } from "../lib/errors.js"

export const searchInterpretationsSchema = z.object({
  query: z.string().describe("Search keyword (e.g., '자동차', '근로기준법')"),
  display: z.number().min(1).max(100).default(20).describe("Results per page (default: 20, max: 100)"),
  page: z.number().min(1).default(1).describe("Page number (default: 1)"),
  sort: z.enum(["lasc", "ldes", "dasc", "ddes", "nasc", "ndes"]).optional()
    .describe("Sort option: lasc/ldes (case name), dasc/ddes (date), nasc/ndes (interpretation number)"),
  fromDate: z.string().optional().describe("회신일 시작 (YYYYMMDD)"),
  toDate: z.string().optional().describe("회신일 종료 (YYYYMMDD)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
});

export type SearchInterpretationsInput = z.infer<typeof searchInterpretationsSchema>;

export async function searchInterpretations(
  apiClient: LawApiClient,
  args: SearchInterpretationsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const extraParams: Record<string, string> = {
      query: args.query,
      display: (args.display || 20).toString(),
      page: (args.page || 1).toString(),
    };
    if (args.sort) extraParams.sort = args.sort;

    const xmlText = await apiClient.fetchApi({
      endpoint: "lawSearch.do",
      target: "expc",
      extraParams,
      apiKey: args.apiKey,
    });

    // 공통 파서 사용
    const result = parseInterpretationXML(xmlText);
    const currentPage = result.page;
    let expcs = result.items;

    // 날짜 범위 필터링 (클라이언트 사이드)
    if (args.fromDate || args.toDate) {
      expcs = expcs.filter(e => {
        const d = (e.회신일자 || "").replace(/[.\-\s]/g, "")
        if (!d) return true
        if (args.fromDate && d < args.fromDate) return false
        if (args.toDate && d > args.toDate) return false
        return true
      })
    }
    const totalCount = (args.fromDate || args.toDate) ? expcs.length : result.totalCnt;

    if (totalCount === 0) {
      return noResultHint(args.query || "", "해석례")
    }

    let output = `해석례 검색 결과 (총 ${totalCount}건, ${currentPage}페이지)`;
    if (args.fromDate || args.toDate) {
      output += ` [기간: ${args.fromDate || "시작"} ~ ${args.toDate || "종료"}]`
    }
    output += `:\n\n`;

    for (const expc of expcs) {
      output += `[${expc.법령해석례일련번호}] ${expc.안건명}\n`;
      output += `  해석례번호: ${expc.법령해석례번호 || "N/A"}\n`;
      output += `  회신일자: ${expc.회신일자 || "N/A"}\n`;
      output += `  해석기관: ${expc.해석기관명 || "N/A"}\n`;
      if (expc.법령해석례상세링크) {
        output += `  링크: ${expc.법령해석례상세링크}\n`;
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
    return formatToolError(error, "search_interpretations");
  }
}

export const getInterpretationTextSchema = z.object({
  id: z.string().describe("Legal interpretation serial number (법령해석례일련번호) from search results"),
  caseName: z.string().optional().describe("Case name (optional, for verification)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
});

export type GetInterpretationTextInput = z.infer<typeof getInterpretationTextSchema>;

export async function getInterpretationText(
  apiClient: LawApiClient,
  args: GetInterpretationTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const extraParams: Record<string, string> = { ID: args.id };
    if (args.caseName) extraParams.LM = args.caseName;

    const responseText = await apiClient.fetchApi({
      endpoint: "lawService.do",
      target: "expc",
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

    if (!data.ExpcService) {
      throw new Error("Legal interpretation not found or invalid response format");
    }

    const expc = data.ExpcService;
    // API returns fields directly in ExpcService, not nested
    const basic = {
      안건명: expc.안건명,
      법령해석례번호: expc.법령해석례일련번호,
      회신일자: expc.해석일자,
      질의기관명: expc.질의기관명,
      해석기관명: expc.해석기관명
    };
    const content = {
      질의요지: expc.질의요지,
      회신내용: expc.회답,
      관계법령: expc.이유
    };

    let output = `=== ${basic.안건명 || "해석례"} ===\n\n`;

    output += `기본 정보:\n`;
    output += `  해석례번호: ${basic.법령해석례번호 || "N/A"}\n`;
    output += `  회신일자: ${basic.회신일자 || "N/A"}\n`;
    output += `  질의기관: ${basic.질의기관명 || "N/A"}\n`;
    output += `  해석기관: ${basic.해석기관명 || "N/A"}\n\n`;

    if (content.질의요지) {
      output += `질의요지:\n${content.질의요지}\n\n`;
    }

    if (content.회신내용) {
      output += `회신내용:\n${content.회신내용}\n\n`;
    }

    if (content.관계법령) {
      output += `관계법령:\n${content.관계법령}\n\n`;
    }

    return {
      content: [{
        type: "text",
        text: truncateResponse(output)
      }]
    };
  } catch (error) {
    return formatToolError(error, "get_interpretation_text");
  }
}

