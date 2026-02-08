import { z } from "zod"
import { parseAdminAppealXML as parseAdminAppealXMLShared } from "../lib/xml-parser.js"
import { truncateResponse } from "../lib/schemas.js"

// Administrative appeal decision search tool - Search for administrative tribunal rulings
export const searchAdminAppealsSchema = z.object({
  query: z.string().optional().describe("검색 키워드 (예: '취소처분', '영업정지', '과태료')"),
  display: z.number().min(1).max(100).default(20).describe("페이지당 결과 개수 (기본값: 20, 최대: 100)"),
  page: z.number().min(1).default(1).describe("페이지 번호 (기본값: 1)"),
  sort: z.enum(["lasc", "ldes", "dasc", "ddes", "nasc", "ndes"]).optional()
    .describe("정렬 옵션: lasc/ldes (재결례명순), dasc/ddes (의결일자순), nasc/ndes (사건번호순)"),
  apiKey: z.string().optional().describe("API 키"),
});

export type SearchAdminAppealsInput = z.infer<typeof searchAdminAppealsSchema>;

export async function searchAdminAppeals(
  apiClient: any,
  args: SearchAdminAppealsInput
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
      target: "decc",
      extraParams,
      apiKey: args.apiKey,
    });

    // 공통 파서 사용
    const result = parseAdminAppealXMLShared(xmlText);
    const totalCount = result.totalCnt;
    const currentPage = result.page;
    const appeals = result.items;

    if (totalCount === 0) {
      let errorMsg = "검색 결과가 없습니다.";
      errorMsg += `\n\n💡 개선 방법:`;
      errorMsg += `\n   1. 단순 키워드 사용:`;
      if (args.query) {
        const words = args.query.split(/\s+/);
        if (words.length > 1) {
          errorMsg += `\n      search_admin_appeals(query="${words[0]}")`;
        }
      }
      errorMsg += `\n\n   2. 일반 판례 검색:`;
      errorMsg += `\n      search_precedents(query="${args.query || '관련 키워드'}")`;

      return {
        content: [{
          type: "text",
          text: errorMsg
        }],
        isError: true
      };
    }

    let output = `행정심판례 검색 결과 (총 ${totalCount}건, ${currentPage}페이지):\n\n`;

    for (const appeal of appeals) {
      output += `[${appeal.행정심판재결례일련번호}] ${appeal.사건명}\n`;
      output += `  사건번호: ${appeal.사건번호 || "N/A"}\n`;
      output += `  의결일: ${appeal.의결일자 || "N/A"}\n`;
      output += `  재결청: ${appeal.재결청 || "N/A"}\n`;
      output += `  재결구분: ${appeal.재결구분명 || "N/A"}\n`;
      if (appeal.행정심판례상세링크) {
        output += `  링크: ${appeal.행정심판례상세링크}\n`;
      }
      output += `\n`;
    }

    output += `\n💡 전문을 조회하려면 get_admin_appeal_text(id="행정심판재결례일련번호")를 사용하세요.`;

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

// Administrative appeal decision text retrieval tool
export const getAdminAppealTextSchema = z.object({
  id: z.string().describe("행정심판재결례일련번호 (검색 결과에서 획득)"),
  caseName: z.string().optional().describe("사건명 (선택사항, 검증용)"),
  apiKey: z.string().optional().describe("API 키"),
});

export type GetAdminAppealTextInput = z.infer<typeof getAdminAppealTextSchema>;

export async function getAdminAppealText(
  apiClient: any,
  args: GetAdminAppealTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const extraParams: Record<string, string> = { ID: args.id };
    if (args.caseName) extraParams.LM = args.caseName;

    const responseText = await apiClient.fetchApi({
      endpoint: "lawService.do",
      target: "decc",
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

    if (!data.DeccService && !data.행정심판례) {
      throw new Error("행정심판례를 찾을 수 없거나 응답 형식이 올바르지 않습니다.");
    }

    const appeal = data.DeccService || data.행정심판례;

    let output = `=== ${appeal.사건명 || "행정심판례"} ===\n\n`;

    output += `📋 기본 정보:\n`;
    output += `  사건번호: ${appeal.사건번호 || "N/A"}\n`;
    output += `  처분일자: ${appeal.처분일자 || "N/A"}\n`;
    output += `  의결일자: ${appeal.의결일자 || "N/A"}\n`;
    output += `  처분청: ${appeal.처분청 || "N/A"}\n`;
    output += `  재결청: ${appeal.재결청 || "N/A"}\n`;
    output += `  재결례유형: ${appeal.재결례유형명 || "N/A"}\n`;
    output += `\n`;

    if (appeal.주문) {
      output += `📌 주문:\n${appeal.주문}\n\n`;
    }

    if (appeal.청구취지) {
      output += `📝 청구취지:\n${appeal.청구취지}\n\n`;
    }

    if (appeal.재결요지) {
      output += `📋 재결요지:\n${appeal.재결요지}\n\n`;
    }

    if (appeal.이유) {
      output += `📄 이유:\n${appeal.이유}\n`;
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
