import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { parseAdminAppealXML as parseAdminAppealXMLShared } from "../lib/xml-parser.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError, noResultHint } from "../lib/errors.js"
import { compactBody, stripRepeatedSummary } from "../lib/decision-compact.js"

// Administrative appeal decision search tool - Search for administrative tribunal rulings
export const searchAdminAppealsSchema = z.object({
  query: z.string().optional().describe("검색 키워드 (예: '취소처분', '영업정지', '과태료')"),
  display: z.number().min(1).max(100).default(20).describe("페이지당 결과 개수 (기본값: 20, 최대: 100)"),
  page: z.number().min(1).default(1).describe("페이지 번호 (기본값: 1)"),
  sort: z.enum(["lasc", "ldes", "dasc", "ddes", "nasc", "ndes"]).optional()
    .describe("정렬 옵션: lasc/ldes (재결례명순), dasc/ddes (의결일자순), nasc/ndes (사건번호순)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
});

export type SearchAdminAppealsInput = z.infer<typeof searchAdminAppealsSchema>;

export async function searchAdminAppeals(
  apiClient: LawApiClient,
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
      return noResultHint(args.query || "", "행정심판")
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

    // 후속 도구 안내 제거 (LLM이 이미 도구 목록을 알고 있음)

    return {
      content: [{
        type: "text",
        text: truncateResponse(output)
      }]
    };
  } catch (error) {
    return formatToolError(error, "search_admin_appeals")
  }
}

// Administrative appeal decision text retrieval tool
export const getAdminAppealTextSchema = z.object({
  id: z.string().describe("행정심판재결례일련번호 (검색 결과에서 획득)"),
  caseName: z.string().optional().describe("사건명 (선택사항, 검증용)"),
  full: z.boolean().optional().describe("true=이유 전문 그대로. 미지정 시 '이유' 섹션 계단식 축약"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
});

export type GetAdminAppealTextInput = z.infer<typeof getAdminAppealTextSchema>;

export async function getAdminAppealText(
  apiClient: LawApiClient,
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

    if (!data.DeccService && !data.행정심판례 && !data.PrecService) {
      throw new Error("행정심판례를 찾을 수 없거나 응답 형식이 올바르지 않습니다.");
    }

    const appeal = data.DeccService || data.행정심판례 || data.PrecService;

    let output = `=== ${appeal.사건명 || "행정심판례"} ===\n\n`;

    output += `기본 정보:\n`;
    output += `  사건번호: ${appeal.사건번호 || "N/A"}\n`;
    output += `  처분일자: ${appeal.처분일자 || "N/A"}\n`;
    output += `  의결일자: ${appeal.의결일자 || "N/A"}\n`;
    output += `  처분청: ${appeal.처분청 || "N/A"}\n`;
    output += `  재결청: ${appeal.재결청 || "N/A"}\n`;
    output += `  재결례유형: ${appeal.재결례유형명 || "N/A"}\n`;
    output += `\n`;

    if (appeal.주문) {
      output += `주문:\n${appeal.주문}\n\n`;
    }

    if (appeal.청구취지) {
      output += `청구취지:\n${appeal.청구취지}\n\n`;
    }

    if (appeal.재결요지) {
      output += `재결요지:\n${appeal.재결요지}\n\n`;
    }

    if (appeal.이유) {
      const deduped = stripRepeatedSummary(appeal.이유, [appeal.재결요지, appeal.주문]);
      const compacted = compactBody(deduped, { full: args.full });
      output += `이유:\n${compacted}\n`;
    }

    return {
      content: [{
        type: "text",
        text: truncateResponse(output)
      }]
    };
  } catch (error) {
    return formatToolError(error, "get_admin_appeal_text")
  }
}
