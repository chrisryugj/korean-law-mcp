import { z } from "zod";
import type { LawApiClient } from "../lib/api-client.js";
import { truncateResponse } from "../lib/schemas.js";
import { parseSearchXML, extractTag } from "../lib/xml-parser.js";
import { formatToolError, noResultHint } from "../lib/errors.js";

// 관세청(kcsCgmExpc)·국세청(ntsCgmExpc) 응답 구조가 동일하므로 target만 분기해 재사용
type CgmExpcTarget = "kcsCgmExpc" | "ntsCgmExpc";
const TARGET_LABEL: Record<CgmExpcTarget, string> = {
  kcsCgmExpc: "관세청",
  ntsCgmExpc: "국세청",
};

// Customs legal interpretation search tool - Search for customs law interpretations
export const searchCustomsInterpretationsSchema = z.object({
  query: z.string().optional().describe("Search keyword (e.g., '거래명세서', '세금')"),
  display: z.number().min(1).max(100).default(20).describe("Results per page (default: 20, max: 100)"),
  page: z.number().min(1).default(1).describe("Page number (default: 1)"),
  inq: z.number().optional().describe("Inquiry organization code (질의기관코드)"),
  rpl: z.number().optional().describe("Interpretation organization code (해석기관코드)"),
  gana: z.string().optional().describe("Dictionary search (ga, na, da, etc.)"),
  explYd: z.string().optional().describe("Interpretation date range (YYYYMMDD~YYYYMMDD, e.g., '20200101~20201231')"),
  sort: z.enum(["lasc", "ldes", "dasc", "ddes"]).optional()
    .describe("Sort option: lasc/ldes (interpretation name), dasc/ddes (interpretation date)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
});

export type SearchCustomsInterpretationsInput = z.infer<typeof searchCustomsInterpretationsSchema>;

export async function searchCustomsInterpretations(
  apiClient: LawApiClient,
  args: SearchCustomsInterpretationsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  return searchCgmExpcByTarget(apiClient, args, "kcsCgmExpc");
}

/** 국세청 법령해석 검색 (#35) — 응답 구조 관세청과 동일, target만 분기. unified-decisions만 사용 */
export async function searchNtsInterpretations(
  apiClient: LawApiClient,
  args: SearchCustomsInterpretationsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  return searchCgmExpcByTarget(apiClient, args, "ntsCgmExpc");
}

async function searchCgmExpcByTarget(
  apiClient: LawApiClient,
  args: SearchCustomsInterpretationsInput,
  target: CgmExpcTarget
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  const orgLabel = TARGET_LABEL[target];
  try {
    const extraParams: Record<string, string> = {
      display: (args.display || 20).toString(),
      page: (args.page || 1).toString(),
    };
    if (args.query) extraParams.query = args.query;
    if (args.inq !== undefined) extraParams.inq = args.inq.toString();
    if (args.rpl !== undefined) extraParams.rpl = args.rpl.toString();
    if (args.gana) extraParams.gana = args.gana;
    if (args.explYd) extraParams.explYd = args.explYd;
    if (args.sort) extraParams.sort = args.sort;

    const xmlText = await apiClient.fetchApi({
      endpoint: "lawSearch.do",
      target,
      extraParams,
      apiKey: args.apiKey,
    });

    // parseSearchXML 사용 (rootTag: CgmExpc, itemTag: cgmExpc)
    const { totalCnt, page: currentPage, items: expcs } = parseSearchXML(
      xmlText, "CgmExpc", "cgmExpc",
      (content) => ({
        법령해석일련번호: extractTag(content, "법령해석일련번호"),
        안건명: extractTag(content, "안건명"),
        질의기관코드: extractTag(content, "질의기관코드"),
        질의기관명: extractTag(content, "질의기관명"),
        해석기관코드: extractTag(content, "해석기관코드"),
        해석기관명: extractTag(content, "해석기관명"),
        해석일자: extractTag(content, "해석일자"),
        법령해석상세링크: extractTag(content, "법령해석상세링크"),
      })
    );

    const totalCount = totalCnt;

    if (totalCount === 0) {
      return noResultHint(args.query || "", `${orgLabel} 법령해석`)
    }

    let output = `${orgLabel} 법령해석 검색 결과 (총 ${totalCount}건, ${currentPage}페이지):\n\n`;

    for (const expc of expcs) {
      output += `[${expc.법령해석일련번호}] ${expc.안건명}\n`;
      output += `  질의기관: ${expc.질의기관명 || "N/A"}\n`;
      output += `  해석기관: ${expc.해석기관명 || "N/A"}\n`;
      output += `  해석일자: ${expc.해석일자 || "N/A"}\n`;
      if (expc.법령해석상세링크) {
        output += `  링크: ${expc.법령해석상세링크}\n`;
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
    return formatToolError(error, target === "ntsCgmExpc" ? "search_nts_interpretations" : "search_customs_interpretations");
  }
}

// Customs legal interpretation text retrieval tool - Get full text of a specific interpretation
export const getCustomsInterpretationTextSchema = z.object({
  id: z.string().describe("Customs interpretation serial number (법령해석일련번호) from search results"),
  interpretationName: z.string().optional().describe("Interpretation name (optional, for verification)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
});

export type GetCustomsInterpretationTextInput = z.infer<typeof getCustomsInterpretationTextSchema>;

export async function getCustomsInterpretationText(
  apiClient: LawApiClient,
  args: GetCustomsInterpretationTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  return getCgmExpcTextByTarget(apiClient, args, "kcsCgmExpc");
}

/**
 * 국세청 법령해석 본문 조회 (#35)
 *
 * 법제처 OPEN API는 국세청 법령해석에 대해 **목록 조회만 제공**한다.
 * 본문 조회 endpoint(`lawService.do?target=ntsCgmExpc`)는 존재하지 않으며,
 * 검색 응답의 `법령해석상세링크`(taxlaw.nts.go.kr) 외부 페이지로만 본문 확인 가능.
 *
 * → 별도 호출 없이 외부 링크 안내 메시지 반환 (LLM 환각 방지).
 */
export async function getNtsInterpretationText(
  _apiClient: LawApiClient,
  args: GetCustomsInterpretationTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  const text =
    `[NOT_SUPPORTED] 국세청 법령해석은 법제처 OPEN API에서 본문 조회를 제공하지 않습니다.\n\n` +
    `해석례 일련번호: ${args.id}\n` +
    `법제처 OPEN API target 'ntsCgmExpc'는 lawSearch.do 목록 조회만 지원합니다.\n` +
    `본문은 search_decisions(domain="nts") 결과의 '법령해석상세링크'(taxlaw.nts.go.kr) 외부 페이지에서 확인하세요.\n` +
    `(상세링크의 ntstDcmId는 법제처 일련번호와 다른 별도 식별자라 자동 변환 불가.)\n\n` +
    `⚠️ LLM은 본문을 추측/생성하지 말고, 검색 결과에 포함된 링크를 그대로 사용자에게 안내하세요.`;
  return { content: [{ type: "text", text }], isError: true };
}

async function getCgmExpcTextByTarget(
  apiClient: LawApiClient,
  args: GetCustomsInterpretationTextInput,
  target: CgmExpcTarget
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const extraParams: Record<string, string> = { ID: args.id };
    if (args.interpretationName) extraParams.LM = args.interpretationName;

    const responseText = await apiClient.fetchApi({
      endpoint: "lawService.do",
      target,
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

    if (!data.CgmExpcService) {
      throw new Error("Customs interpretation not found or invalid response format");
    }

    const expc = data.CgmExpcService;
    const basic = {
      안건명: expc.안건명,
      법령해석일련번호: expc.법령해석일련번호,
      업무분야: expc.업무분야,
      해석일자: expc.해석일자,
      해석기관명: expc.해석기관명,
      질의기관명: expc.질의기관명,
      등록일시: expc.등록일시
    };
    const content = {
      질의요지: expc.질의요지,
      회답: expc.회답,
      이유: expc.이유,
      관련법령: expc.관련법령,
      관세법령정보포털원문링크: expc.관세법령정보포털원문링크
    };

    let output = `=== ${basic.안건명 || "Customs Interpretation"} ===\n\n`;

    output += `기본 정보:\n`;
    output += `  해석일련번호: ${basic.법령해석일련번호 || "N/A"}\n`;
    output += `  업무분야: ${basic.업무분야 || "N/A"}\n`;
    output += `  해석일자: ${basic.해석일자 || "N/A"}\n`;
    output += `  질의기관: ${basic.질의기관명 || "N/A"}\n`;
    output += `  해석기관: ${basic.해석기관명 || "N/A"}\n`;
    output += `  등록일시: ${basic.등록일시 || "N/A"}\n\n`;

    if (content.질의요지) {
      output += `질의요지:\n${content.질의요지}\n\n`;
    }

    if (content.회답) {
      output += `회답:\n${content.회답}\n\n`;
    }

    if (content.이유) {
      output += `이유:\n${content.이유}\n\n`;
    }

    if (content.관련법령) {
      output += `관련법령:\n${content.관련법령}\n\n`;
    }

    if (content.관세법령정보포털원문링크) {
      output += `원문 링크: ${content.관세법령정보포털원문링크}\n`;
    }

    return {
      content: [{
        type: "text",
        text: truncateResponse(output)
      }]
    };
  } catch (error) {
    return formatToolError(error, target === "ntsCgmExpc" ? "get_nts_interpretation_text" : "get_customs_interpretation_text");
  }
}

