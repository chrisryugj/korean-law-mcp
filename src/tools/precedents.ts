import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { parsePrecedentXML } from "../lib/xml-parser.js"
import { truncateResponse } from "../lib/schemas.js"

export const searchPrecedentsSchema = z.object({
  query: z.string().optional().describe("검색 키워드 (예: '자동차', '담보권')"),
  court: z.string().optional().describe("법원명 필터 (예: '대법원', '서울고등법원')"),
  caseNumber: z.string().optional().describe("사건번호 (예: '2009느합133')"),
  display: z.number().min(1).max(100).default(20).describe("결과 수 (기본:20, 최대:100)"),
  page: z.number().min(1).default(1).describe("페이지 번호 (기본:1)"),
  sort: z.enum(["lasc", "ldes", "dasc", "ddes", "nasc", "ndes"]).optional()
    .describe("정렬: lasc/ldes(법령명), dasc/ddes(날짜), nasc/ndes(사건번호)"),
  fromDate: z.string().optional().describe("선고일 시작 (YYYYMMDD)"),
  toDate: z.string().optional().describe("선고일 종료 (YYYYMMDD)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
});

export type SearchPrecedentsInput = z.infer<typeof searchPrecedentsSchema>;

export async function searchPrecedents(
  apiClient: LawApiClient,
  args: SearchPrecedentsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const extraParams: Record<string, string> = {
      display: (args.display || 20).toString(),
      page: (args.page || 1).toString(),
    };
    if (args.query) extraParams.query = args.query;
    if (args.court) extraParams.curt = args.court;
    if (args.caseNumber) extraParams.nb = args.caseNumber;
    if (args.sort) extraParams.sort = args.sort;

    const xmlText = await apiClient.fetchApi({
      endpoint: "lawSearch.do",
      target: "prec",
      extraParams,
      apiKey: args.apiKey,
    });

  // 공통 파서 사용
  const result = parsePrecedentXML(xmlText);
  const currentPage = result.page;
  let precs = result.items;

  // 날짜 범위 필터링 (클라이언트 사이드)
  if (args.fromDate || args.toDate) {
    precs = precs.filter(p => {
      const d = (p.선고일자 || "").replace(/[.\-\s]/g, "")
      if (!d) return true
      if (args.fromDate && d < args.fromDate) return false
      if (args.toDate && d > args.toDate) return false
      return true
    })
  }
  const totalCount = (args.fromDate || args.toDate) ? precs.length : result.totalCnt;

  if (totalCount === 0) {
    const kw = args.query || "관련 키워드"
    const hint = [
      "검색 결과가 없습니다.\n\n💡 개선 방법:",
      `  1. 단순 키워드: search_precedents(query="${kw.split(/\s+/)[0]}")`,
      `  2. 해석례 검색: search_interpretations(query="${kw}")`,
      `  3. 법령 검색: search_law(query="${kw}")`,
    ].join("\n")
    return { content: [{ type: "text", text: hint }], isError: true };
  }

  let output = `판례 검색 결과 (총 ${totalCount}건, ${currentPage}페이지)`;
  if (args.fromDate || args.toDate) {
    output += ` [기간: ${args.fromDate || "시작"} ~ ${args.toDate || "종료"}]`
  }
  output += `:\n\n`;

  for (const prec of precs) {
    output += `[${prec.판례일련번호}] ${prec.판례명}\n`;
    output += `  사건번호: ${prec.사건번호 || "N/A"}\n`;
    output += `  법원: ${prec.법원명 || "N/A"}\n`;
    output += `  선고일: ${prec.선고일자 || "N/A"}\n`;
    output += `  판결유형: ${prec.판결유형 || "N/A"}\n`;
    if (prec.판례상세링크) {
      output += `  링크: ${prec.판례상세링크}\n`;
    }
    output += `\n`;
  }

  output += `\n💡 전문을 조회하려면 get_precedent_text Tool을 사용하세요.\n`;

  return {
    content: [{
      type: "text",
      text: output
    }]
  };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true }
  }
}

export const getPrecedentTextSchema = z.object({
  id: z.string().describe("판례일련번호 (search_precedents 결과에서 획득)"),
  caseName: z.string().optional().describe("사건명 (선택, 검증용)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
});

export type GetPrecedentTextInput = z.infer<typeof getPrecedentTextSchema>;

export async function getPrecedentText(
  apiClient: LawApiClient,
  args: GetPrecedentTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const extraParams: Record<string, string> = { ID: args.id };
    if (args.caseName) extraParams.LM = args.caseName;

    const responseText = await apiClient.fetchApi({
      endpoint: "lawService.do",
      target: "prec",
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

  if (!data.PrecService) {
    throw new Error("Precedent not found or invalid response format");
  }

  const prec = data.PrecService;
  // API returns fields directly in PrecService, not nested
  const basic = {
    판례명: prec.사건명,
    사건번호: prec.사건번호,
    법원명: prec.법원명,
    선고일자: prec.선고일자,
    사건종류명: prec.사건종류명,
    판결유형: prec.판결유형
  };
  const content = {
    판시사항: prec.판시사항,
    판결요지: prec.판결요지,
    참조조문: prec.참조조문,
    참조판례: prec.참조판례,
    전문: prec.판례내용
  };

  let output = `=== ${basic.판례명 || "판례"} ===\n\n`;

  output += `📋 기본 정보:\n`;
  output += `  사건번호: ${basic.사건번호 || "N/A"}\n`;
  output += `  법원: ${basic.법원명 || "N/A"}\n`;
  output += `  선고일: ${basic.선고일자 || "N/A"}\n`;
  output += `  사건종류: ${basic.사건종류명 || "N/A"}\n`;
  output += `  판결유형: ${basic.판결유형 || "N/A"}\n\n`;

  if (content.판시사항) {
    output += `📌 판시사항:\n${content.판시사항}\n\n`;
  }

  if (content.판결요지) {
    output += `📝 판결요지:\n${content.판결요지}\n\n`;
  }

  if (content.참조조문) {
    output += `📖 참조조문:\n${content.참조조문}\n\n`;
  }

  if (content.참조판례) {
    output += `⚖️ 참조판례:\n${content.참조판례}\n\n`;
  }

  if (content.전문) {
    output += `📄 전문:\n${content.전문}\n`;
  }

  return {
    content: [{
      type: "text",
      text: truncateResponse(output)
    }]
  };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true }
  }
}

