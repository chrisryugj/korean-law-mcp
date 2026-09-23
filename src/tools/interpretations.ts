import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { parseInterpretationXML } from "../lib/xml-parser.js"
import { truncateResponse, optionalDateSchema } from "../lib/schemas.js"
import { formatToolError, noResultHint, LawApiError, ErrorCodes } from "../lib/errors.js"

export const searchInterpretationsSchema = z.object({
  query: z.string().describe("Search keyword (e.g., '자동차', '근로기준법')"),
  display: z.number().min(1).max(100).default(20).describe("Results per page (default: 20, max: 100)"),
  page: z.number().min(1).default(1).describe("Page number (default: 1)"),
  sort: z.enum(["lasc", "ldes", "dasc", "ddes", "nasc", "ndes"]).optional()
    .describe("Sort option: lasc/ldes (case name), dasc/ddes (date), nasc/ndes (interpretation number)"),
  fromDate: optionalDateSchema.describe("회신일 시작 (YYYYMMDD)"),
  toDate: optionalDateSchema.describe("회신일 종료 (YYYYMMDD)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
});

export type SearchInterpretationsInput = z.infer<typeof searchInterpretationsSchema>;

export async function searchInterpretations(
  apiClient: LawApiClient,
  args: SearchInterpretationsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    // search_decisions는 도메인 스키마를 거치지 않고 options를 그대로 넘기므로 여기서도 형식을 확인한다.
    // 클라이언트가 숫자(20240101)나 구분자(2024-01-01)로 보내도 받는다(CLAUDE.md 규칙 9). 객체로 검증해
    // 형식 오류에 어느 필드인지가 실린다(종전엔 필드명 없는 "expected string, received number").
    const asDate = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : String(v).replace(/[-./\s]/g, ""));
    const { fromDate, toDate } = z.object({ fromDate: optionalDateSchema, toDate: optionalDateSchema })
      .parse({ fromDate: asDate(args.fromDate), toDate: asDate(args.toDate) });
    if (fromDate && toDate && fromDate > toDate) {
      throw new LawApiError(`기간이 거꾸로입니다: fromDate(${fromDate}) > toDate(${toDate})`, ErrorCodes.INVALID_PARAM);
    }

    const extraParams: Record<string, string> = {
      query: args.query,
      display: (args.display || 20).toString(),
      page: (args.page || 1).toString(),
    };
    if (args.sort) extraParams.sort = args.sort;
    // 기간은 서버에 explYd로 넘긴다 (관세청 해석례와 같은 방식). 종전엔 한 페이지만 받아 로컬로 거르고
    // 총건수를 그 페이지 잔여 수로 덮어, 2024년 실제 10건을 "총 4건"(2006년 무일자 항목 포함)으로
    // 답하거나 1페이지에 해당 기간이 없으면 거짓 NOT_FOUND를 냈다 (2026-09-23 리뷰 D4, 실측 query=자동차).
    if (fromDate || toDate) extraParams.explYd = `${fromDate || "19000101"}~${toDate || "20991231"}`;

    const xmlText = await apiClient.fetchApi({
      endpoint: "lawSearch.do",
      target: "expc",
      extraParams,
      apiKey: args.apiKey,
    });

    // 공통 파서 사용
    const result = parseInterpretationXML(xmlText);
    const currentPage = result.page;
    const expcs = result.items;
    const totalCount = result.totalCnt;

    if (totalCount === 0) {
      return noResultHint(args.query || "", "해석례")
    }

    let output = `해석례 검색 결과 (총 ${totalCount}건, ${currentPage}페이지)`;
    if (fromDate || toDate) {
      output += ` [기간: ${fromDate || "시작"} ~ ${toDate || "종료"}]`
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
    // 해석례번호는 검색 목록과 같은 안건번호(예: 23-0984)를 싣는다. 종전엔 일련번호(338575)를 같은 라벨로 찍어
    // 인용 번호가 갈렸고, ExpcService에 없는 관계법령 자리에 이유 본문을 넣었다 (2026-09-23 리뷰 D11, 실측 키).
    const basic = {
      안건명: expc.안건명,
      안건번호: expc.안건번호,
      일련번호: expc.법령해석례일련번호,
      회신일자: expc.해석일자,
      질의기관명: expc.질의기관명,
      해석기관명: expc.해석기관명
    };
    const content = {
      질의요지: expc.질의요지,
      회신내용: expc.회답,
      이유: expc.이유
    };

    let output = `=== ${basic.안건명 || "해석례"} ===\n\n`;

    output += `기본 정보:\n`;
    output += `  해석례번호: ${basic.안건번호 || "N/A"}\n`;
    if (basic.일련번호) output += `  일련번호: ${basic.일련번호}\n`;
    output += `  회신일자: ${basic.회신일자 || "N/A"}\n`;
    output += `  질의기관: ${basic.질의기관명 || "N/A"}\n`;
    output += `  해석기관: ${basic.해석기관명 || "N/A"}\n\n`;

    if (content.질의요지) {
      output += `질의요지:\n${content.질의요지}\n\n`;
    }

    if (content.회신내용) {
      output += `회신내용:\n${content.회신내용}\n\n`;
    }

    if (content.이유) {
      output += `이유:\n${content.이유}\n\n`;
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

