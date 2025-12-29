import { z } from "zod"
import { parsePrecedentXML } from "../lib/xml-parser.js"

// Precedent search tool - Search for case law by keyword, court, or case number
export const searchPrecedentsSchema = z.object({
  query: z.string().optional().describe("Search keyword (e.g., '자동차', '담보권')"),
  court: z.string().optional().describe("Court name filter (e.g., '대법원', '서울고등법원')"),
  caseNumber: z.string().optional().describe("Case number (e.g., '2009느합133')"),
  display: z.number().min(1).max(100).default(20).describe("Results per page (default: 20, max: 100)"),
  page: z.number().min(1).default(1).describe("Page number (default: 1)"),
  sort: z.enum(["lasc", "ldes", "dasc", "ddes", "nasc", "ndes"]).optional()
    .describe("Sort option: lasc/ldes (law name), dasc/ddes (date), nasc/ndes (case number)"),
  apiKey: z.string().optional().describe("API 키"),
});

export type SearchPrecedentsInput = z.infer<typeof searchPrecedentsSchema>;

export async function searchPrecedents(
  apiClient: any,
  args: SearchPrecedentsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const apiKey = args.apiKey || process.env.LAW_OC;
    if (!apiKey) {
      throw new Error("API 키가 필요합니다. api_key 파라미터를 전달하거나 LAW_OC 환경변수를 설정하세요.");
    }

    const params = new URLSearchParams({
      OC: apiKey,
      target: "prec",
      type: "XML",
      display: (args.display || 20).toString(),
      page: (args.page || 1).toString(),
    });

  if (args.query) params.append("query", args.query);
  if (args.court) params.append("curt", args.court);
  if (args.caseNumber) params.append("nb", args.caseNumber);
  if (args.sort) params.append("sort", args.sort);

  const url = `https://www.law.go.kr/DRF/lawSearch.do?${params.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const xmlText = await response.text();

  // 공통 파서 사용
  const result = parsePrecedentXML(xmlText);
  const totalCount = result.totalCnt;
  const currentPage = result.page;
  const precs = result.items;

  if (totalCount === 0) {
    let errorMsg = "검색 결과가 없습니다."
    errorMsg += `\n\n💡 개선 방법:`
    errorMsg += `\n   1. 단순 키워드 사용:`
    if (args.query) {
      const words = args.query.split(/\s+/)
      if (words.length > 1) {
        errorMsg += `\n      search_precedents(query="${words[0]}")`
      }
    }
    errorMsg += `\n\n   2. 법령해석례 검색:`
    errorMsg += `\n      search_interpretations(query="${args.query || '관련 키워드'}")`
    errorMsg += `\n\n   3. 법령 검색으로 전환:`
    errorMsg += `\n      search_law(query="${args.query || '관련 법령명'}")`

    return {
      content: [{
        type: "text",
        text: errorMsg
      }],
      isError: true
    };
  }

  let output = `판례 검색 결과 (총 ${totalCount}건, ${currentPage}페이지):\n\n`;

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
    return {
      content: [{
        type: "text",
        text: `Error: ${error instanceof Error ? error.message : String(error)}`
      }],
      isError: true
    };
  }
}

// Precedent text retrieval tool - Get full text of a specific case
export const getPrecedentTextSchema = z.object({
  id: z.string().describe("Precedent serial number (판례일련번호) from search results"),
  caseName: z.string().optional().describe("Case name (optional, for verification)"),
  apiKey: z.string().optional().describe("API 키"),
});

export type GetPrecedentTextInput = z.infer<typeof getPrecedentTextSchema>;

export async function getPrecedentText(
  apiClient: any,
  args: GetPrecedentTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const apiKey = args.apiKey || process.env.LAW_OC;
    if (!apiKey) {
      throw new Error("API 키가 필요합니다. api_key 파라미터를 전달하거나 LAW_OC 환경변수를 설정하세요.");
    }

  const params = new URLSearchParams({
    OC: apiKey,
    target: "prec",
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

  let output = `=== ${basic.판례명 || "Precedent"} ===\n\n`;

  output += `📋 Basic Information:\n`;
  output += `  Case Number: ${basic.사건번호 || "N/A"}\n`;
  output += `  Court: ${basic.법원명 || "N/A"}\n`;
  output += `  Date: ${basic.선고일자 || "N/A"}\n`;
  output += `  Case Type: ${basic.사건종류명 || "N/A"}\n`;
  output += `  Judgment Type: ${basic.판결유형 || "N/A"}\n\n`;

  if (content.판시사항) {
    output += `📌 Holdings (판시사항):\n${content.판시사항}\n\n`;
  }

  if (content.판결요지) {
    output += `📝 Summary (판결요지):\n${content.판결요지}\n\n`;
  }

  if (content.참조조문) {
    output += `📖 Referenced Statutes (참조조문):\n${content.참조조문}\n\n`;
  }

  if (content.참조판례) {
    output += `⚖️ Referenced Precedents (참조판례):\n${content.참조판례}\n\n`;
  }

  if (content.전문) {
    output += `📄 전문:\n${content.전문}\n`;
  }

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

