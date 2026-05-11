import { z } from "zod";
import type { LawApiClient } from "../lib/api-client.js";
import { parseConstitutionalXML } from "../lib/xml-parser.js";
import { truncateResponse } from "../lib/schemas.js";
import { formatToolError, noResultHint } from "../lib/errors.js";
import {
  compactBody,
  densifyLawRefs,
  densifyPrecedentRefs,
  stripRepeatedSummary,
} from "../lib/decision-compact.js";

// Constitutional Court decision search tool - Search for Constitutional Court rulings
export const searchConstitutionalDecisionsSchema = z.object({
  query: z.string().optional().describe("검색 키워드 (예: '위헌', '기본권', '재산권')"),
  caseNumber: z.string().optional().describe("사건번호 (예: '2020헌바123')"),
  display: z.number().min(1).max(100).default(20).describe("페이지당 결과 개수 (기본값: 20, 최대: 100)"),
  page: z.number().min(1).default(1).describe("페이지 번호 (기본값: 1)"),
  sort: z.enum(["lasc", "ldes", "dasc", "ddes", "nasc", "ndes"]).optional()
    .describe("정렬 옵션: lasc/ldes (법령명순), dasc/ddes (날짜순), nasc/ndes (사건번호순)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
});

export type SearchConstitutionalDecisionsInput = z.infer<typeof searchConstitutionalDecisionsSchema>;

export async function searchConstitutionalDecisions(
  apiClient: LawApiClient,
  args: SearchConstitutionalDecisionsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const extraParams: Record<string, string> = {
      display: (args.display || 20).toString(),
      page: (args.page || 1).toString(),
    };
    if (args.query) extraParams.query = args.query;
    if (args.caseNumber) extraParams.nb = args.caseNumber;
    if (args.sort) extraParams.sort = args.sort;

    const xmlText = await apiClient.fetchApi({
      endpoint: "lawSearch.do",
      target: "detc",
      extraParams,
      apiKey: args.apiKey,
    });

    // 공통 파서 사용
    const result = parseConstitutionalXML(xmlText);
    const totalCount = result.totalCnt;
    const currentPage = result.page;
    const decisions = result.items;

    if (totalCount === 0) {
      return noResultHint(args.query || args.caseNumber || "", "헌법재판소 결정")
    }

    let output = `헌재결정례 검색 결과 (총 ${totalCount}건, ${currentPage}페이지):\n\n`;

    for (const decision of decisions) {
      output += `[${decision.헌재결정례일련번호}] ${decision.사건명}\n`;
      output += `  사건번호: ${decision.사건번호 || "N/A"}\n`;
      output += `  종국일: ${decision.종국일자 || "N/A"}\n`;
      if (decision.헌재결정례상세링크) {
        output += `  링크: ${decision.헌재결정례상세링크}\n`;
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
    return formatToolError(error, "search_constitutional_decisions");
  }
}

// Constitutional Court decision text retrieval tool
export const getConstitutionalDecisionTextSchema = z.object({
  id: z.string().describe("헌재결정례일련번호 (검색 결과에서 획득)"),
  caseName: z.string().optional().describe("사건명 (선택사항, 검증용)"),
  full: z.boolean().optional().describe("true=전문 그대로. 미지정 시 '전문' 섹션 계단식 축약"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
});

export type GetConstitutionalDecisionTextInput = z.infer<typeof getConstitutionalDecisionTextSchema>;

export async function getConstitutionalDecisionText(
  apiClient: LawApiClient,
  args: GetConstitutionalDecisionTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const extraParams: Record<string, string> = { ID: args.id };

    const responseText = await apiClient.fetchApi({
      endpoint: "lawService.do",
      target: "detc",
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

    if (!data.DetcService && !data.헌재결정례) {
      throw new Error("헌재결정례를 찾을 수 없거나 응답 형식이 올바르지 않습니다.");
    }

    const decision = data.DetcService || data.헌재결정례;

    let output = `=== ${decision.사건명 || "헌재결정례"} ===\n\n`;

    output += `기본 정보:\n`;
    output += `  사건번호: ${decision.사건번호 || "N/A"}\n`;
    output += `  종국일자: ${decision.종국일자 || decision.선고일자 || "N/A"}\n`;
    if (decision.청구인) output += `  청구인: ${decision.청구인}\n`;
    if (decision.피청구인) output += `  피청구인: ${decision.피청구인}\n`;
    output += `\n`;

    const summaryText = decision.결정요지 || decision.판결요지;

    if (decision.판시사항) {
      output += `판시사항:\n${decision.판시사항}\n\n`;
    }

    if (summaryText) {
      output += `결정요지:\n${summaryText}\n\n`;
    }

    if (decision.참조조문) {
      output += `참조조문:\n${densifyLawRefs(decision.참조조문)}\n\n`;
    }

    if (decision.참조판례) {
      output += `참조판례:\n${densifyPrecedentRefs(decision.참조판례)}\n\n`;
    }

    const bodyText = decision.판례내용 || decision.결정내용 || decision.전문;
    if (bodyText) {
      const deduped = stripRepeatedSummary(bodyText, [decision.판시사항, summaryText]);
      const compacted = compactBody(deduped, { full: args.full });
      output += `전문:\n${compacted}\n`;
    }

    return {
      content: [{
        type: "text",
        text: truncateResponse(output)
      }]
    };
  } catch (error) {
    return formatToolError(error, "get_constitutional_decision_text");
  }
}
