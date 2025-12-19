import { z } from "zod";

// Precedent search tool - Search for case law by keyword, court, or case number
export const searchPrecedentsSchema = z.object({
  query: z.string().optional().describe("Search keyword (e.g., '자동차', '담보권')"),
  court: z.string().optional().describe("Court name filter (e.g., '대법원', '서울고등법원')"),
  caseNumber: z.string().optional().describe("Case number (e.g., '2009느합133')"),
  display: z.number().min(1).max(100).default(20).describe("Results per page (default: 20, max: 100)"),
  page: z.number().min(1).default(1).describe("Page number (default: 1)"),
  sort: z.enum(["lasc", "ldes", "dasc", "ddes", "nasc", "ndes"]).optional()
    .describe("Sort option: lasc/ldes (law name), dasc/ddes (date), nasc/ndes (case number)"),
});

export type SearchPrecedentsInput = z.infer<typeof searchPrecedentsSchema>;

export async function searchPrecedents(
  apiClient: any,
  args: SearchPrecedentsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const apiKey = process.env.LAW_OC;
    if (!apiKey) {
      throw new Error("LAW_OC environment variable not set");
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

  // Simple XML parsing
  const result = parseXML(xmlText);

  if (!result.PrecSearch) {
    throw new Error("Invalid response format from API");
  }

  const data = result.PrecSearch;
  const totalCount = parseInt(data.totalCnt || "0");
  const currentPage = parseInt(data.page || "1");
  const precs = data.prec ? (Array.isArray(data.prec) ? data.prec : [data.prec]) : [];

  if (totalCount === 0) {
    return {
      content: [{
        type: "text",
        text: "검색 결과가 없습니다."
      }]
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
});

export type GetPrecedentTextInput = z.infer<typeof getPrecedentTextSchema>;

export async function getPrecedentText(
  apiClient: any,
  args: GetPrecedentTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const apiKey = process.env.LAW_OC;
    if (!apiKey) {
      throw new Error("LAW_OC environment variable not set");
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

// Simple XML parser helper
function parseXML(xml: string): any {
  const obj: any = {};

  // Extract PrecSearch
  const precSearchMatch = xml.match(/<PrecSearch[^>]*>([\s\S]*?)<\/PrecSearch>/);
  if (!precSearchMatch) return obj;

  const content = precSearchMatch[1];
  obj.PrecSearch = {};

  // Extract totalCnt and page
  const totalCntMatch = content.match(/<totalCnt>([^<]*)<\/totalCnt>/);
  const pageMatch = content.match(/<page>([^<]*)<\/page>/);

  obj.PrecSearch.totalCnt = totalCntMatch ? totalCntMatch[1] : "0";
  obj.PrecSearch.page = pageMatch ? pageMatch[1] : "1";

  // Extract prec items (with id attribute)
  const precMatches = content.matchAll(/<prec[^>]*>([\s\S]*?)<\/prec>/g);
  obj.PrecSearch.prec = [];

  for (const match of precMatches) {
    const precContent = match[1];
    const prec: any = {};

    const extractTag = (tag: string) => {
      // CDATA 지원
      const cdataRegex = new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\/${tag}>`);
      const cdataMatch = precContent.match(cdataRegex);
      if (cdataMatch) return cdataMatch[1];

      const regex = new RegExp(`<${tag}>([^<]*)<\/${tag}>`);
      const match = precContent.match(regex);
      return match ? match[1] : "";
    };

    prec.판례일련번호 = extractTag("판례일련번호");
    prec.판례명 = extractTag("사건명");  // ← 수정: 사건명 사용
    prec.사건번호 = extractTag("사건번호");
    prec.법원명 = extractTag("법원명");
    prec.선고일자 = extractTag("선고일자");
    prec.판결유형 = extractTag("판결유형");
    prec.판례상세링크 = extractTag("판례상세링크");

    obj.PrecSearch.prec.push(prec);
  }

  return obj;
}
