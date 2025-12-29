import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { parseInterpretationXML } from "../lib/xml-parser.js"
import { truncateResponse } from "../lib/schemas.js"

// Legal interpretation search tool - Search for statutory interpretations
export const searchInterpretationsSchema = z.object({
  query: z.string().describe("Search keyword (e.g., '자동차', '근로기준법')"),
  display: z.number().min(1).max(100).default(20).describe("Results per page (default: 20, max: 100)"),
  page: z.number().min(1).default(1).describe("Page number (default: 1)"),
  sort: z.enum(["lasc", "ldes", "dasc", "ddes", "nasc", "ndes"]).optional()
    .describe("Sort option: lasc/ldes (case name), dasc/ddes (date), nasc/ndes (interpretation number)"),
  apiKey: z.string().optional().describe("API 키"),
});

export type SearchInterpretationsInput = z.infer<typeof searchInterpretationsSchema>;

export async function searchInterpretations(
  apiClient: LawApiClient,
  args: SearchInterpretationsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const apiKey = args.apiKey || process.env.LAW_OC;
    if (!apiKey) {
      throw new Error("API 키가 필요합니다. api_key 파라미터를 전달하거나 LAW_OC 환경변수를 설정하세요.");
    }

    const params = new URLSearchParams({
      OC: apiKey,
      target: "expc",
      type: "XML",
      query: args.query,
      display: (args.display || 20).toString(),
      page: (args.page || 1).toString(),
    });

    if (args.sort) params.append("sort", args.sort);

    const url = `https://www.law.go.kr/DRF/lawSearch.do?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const xmlText = await response.text();

    // 공통 파서 사용
    const result = parseInterpretationXML(xmlText);
    const totalCount = result.totalCnt;
    const currentPage = result.page;
    const expcs = result.items;

    if (totalCount === 0) {
      let errorMsg = "검색 결과가 없습니다."
      errorMsg += `\n\n💡 개선 방법:`
      errorMsg += `\n   1. 단순 키워드 사용:`
      const words = args.query.split(/\s+/)
      if (words.length > 1) {
        errorMsg += `\n      search_interpretations(query="${words[0]}")`
      }
      errorMsg += `\n\n   2. 판례 검색:`
      errorMsg += `\n      search_precedents(query="${args.query}")`
      errorMsg += `\n\n   3. 법령 검색으로 전환:`
      errorMsg += `\n      search_law(query="${args.query}")`

      return {
        content: [{
          type: "text",
          text: errorMsg
        }],
        isError: true
      };
    }

    let output = `해석례 검색 결과 (총 ${totalCount}건, ${currentPage}페이지):\n\n`;

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

    output += `\n💡 전문을 조회하려면 get_interpretation_text Tool을 사용하세요.\n`;

    return {
      content: [{
        type: "text",
        text: output
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Error: ${error instanceof Error ? error.message : String(error)}`
      }],
      isError: true
    };
  }
}

// Legal interpretation text retrieval tool - Get full text of a specific interpretation
export const getInterpretationTextSchema = z.object({
  id: z.string().describe("Legal interpretation serial number (법령해석례일련번호) from search results"),
  caseName: z.string().optional().describe("Case name (optional, for verification)"),
  apiKey: z.string().optional().describe("API 키"),
});

export type GetInterpretationTextInput = z.infer<typeof getInterpretationTextSchema>;

export async function getInterpretationText(
  apiClient: LawApiClient,
  args: GetInterpretationTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const apiKey = args.apiKey || process.env.LAW_OC;
    if (!apiKey) {
      throw new Error("API 키가 필요합니다. api_key 파라미터를 전달하거나 LAW_OC 환경변수를 설정하세요.");
    }

    const params = new URLSearchParams({
      OC: apiKey,
      target: "expc",
      type: "JSON",
      ID: args.id,
    });

    if (args.caseName) {
      params.append("LM", args.caseName);
    }

    const url = `https://www.law.go.kr/DRF/lawService.do?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const responseText = await response.text();

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

    output += `📋 기본 정보:\n`;
    output += `  해석례번호: ${basic.법령해석례번호 || "N/A"}\n`;
    output += `  회신일자: ${basic.회신일자 || "N/A"}\n`;
    output += `  질의기관: ${basic.질의기관명 || "N/A"}\n`;
    output += `  해석기관: ${basic.해석기관명 || "N/A"}\n\n`;

    if (content.질의요지) {
      output += `📌 질의요지:\n${content.질의요지}\n\n`;
    }

    if (content.회신내용) {
      output += `📝 회신내용:\n${content.회신내용}\n\n`;
    }

    if (content.관계법령) {
      output += `📖 관계법령:\n${content.관계법령}\n\n`;
    }

    return {
      content: [{
        type: "text",
        text: truncateResponse(output)
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Error: ${error instanceof Error ? error.message : String(error)}`
      }],
      isError: true
    };
  }
}

