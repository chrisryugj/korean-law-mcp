import { z } from "zod";

// Tax tribunal decision search tool - Search for special administrative appeals decisions
export const searchTaxTribunalDecisionsSchema = z.object({
  query: z.string().optional().describe("Search keyword (e.g., '자동차', '부가가치세')"),
  display: z.number().min(1).max(100).default(20).describe("Results per page (default: 20, max: 100)"),
  page: z.number().min(1).default(1).describe("Page number (default: 1)"),
  cls: z.string().optional().describe("Decision type code (재결구분코드)"),
  gana: z.string().optional().describe("Dictionary search (ga, na, da, etc.)"),
  dpaYd: z.string().optional().describe("Disposition date range (YYYYMMDD~YYYYMMDD, e.g., '20200101~20201231')"),
  rslYd: z.string().optional().describe("Decision date range (YYYYMMDD~YYYYMMDD, e.g., '20200101~20201231')"),
  sort: z.enum(["lasc", "ldes", "dasc", "ddes", "nasc", "ndes"]).optional()
    .describe("Sort option: lasc/ldes (decision name), dasc/ddes (decision date), nasc/ndes (claim number)"),
});

export type SearchTaxTribunalDecisionsInput = z.infer<typeof searchTaxTribunalDecisionsSchema>;

export async function searchTaxTribunalDecisions(
  apiClient: any,
  args: SearchTaxTribunalDecisionsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const apiKey = process.env.LAW_OC;
    if (!apiKey) {
      throw new Error("LAW_OC environment variable not set");
    }

    const params = new URLSearchParams({
      OC: apiKey,
      target: "ttSpecialDecc",
      type: "XML",
      display: (args.display || 20).toString(),
      page: (args.page || 1).toString(),
    });

    if (args.query) params.append("query", args.query);
    if (args.cls) params.append("cls", args.cls);
    if (args.gana) params.append("gana", args.gana);
    if (args.dpaYd) params.append("dpaYd", args.dpaYd);
    if (args.rslYd) params.append("rslYd", args.rslYd);
    if (args.sort) params.append("sort", args.sort);

    const url = `https://www.law.go.kr/DRF/lawSearch.do?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const xmlText = await response.text();

    // Simple XML parsing
    const result = parseXML(xmlText);

    if (!result.TtSpecialDeccSearch) {
      throw new Error("Invalid response format from API");
    }

    const data = result.TtSpecialDeccSearch;
    const totalCount = parseInt(data.totalCnt || "0");
    const currentPage = parseInt(data.page || "1");
    const deccs = data.decc ? (Array.isArray(data.decc) ? data.decc : [data.decc]) : [];

    if (totalCount === 0) {
      return {
        content: [{
          type: "text",
          text: "검색 결과가 없습니다."
        }]
      };
    }

    let output = `조세심판원 재결례 검색 결과 (총 ${totalCount}건, ${currentPage}페이지):\n\n`;

    for (const decc of deccs) {
      output += `[${decc.특별행정심판재결례일련번호}] ${decc.사건명}\n`;
      output += `  청구번호: ${decc.청구번호 || "N/A"}\n`;
      output += `  의결일자: ${decc.의결일자 || "N/A"}\n`;
      output += `  처분일자: ${decc.처분일자 || "N/A"}\n`;
      output += `  재결청: ${decc.재결청 || "N/A"}\n`;
      output += `  재결구분: ${decc.재결구분명 || "N/A"}\n`;
      if (decc.행정심판재결례상세링크) {
        output += `  링크: ${decc.행정심판재결례상세링크}\n`;
      }
      output += `\n`;
    }

    output += `\n💡 전문을 조회하려면 get_tax_tribunal_decision_text Tool을 사용하세요.\n`;

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

// Tax tribunal decision text retrieval tool - Get full text of a specific decision
export const getTaxTribunalDecisionTextSchema = z.object({
  id: z.string().describe("Tax tribunal decision serial number (특별행정심판재결례일련번호) from search results"),
  decisionName: z.string().optional().describe("Decision name (optional, for verification)"),
});

export type GetTaxTribunalDecisionTextInput = z.infer<typeof getTaxTribunalDecisionTextSchema>;

export async function getTaxTribunalDecisionText(
  apiClient: any,
  args: GetTaxTribunalDecisionTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const apiKey = process.env.LAW_OC;
    if (!apiKey) {
      throw new Error("LAW_OC environment variable not set");
    }

    const params = new URLSearchParams({
      OC: apiKey,
      target: "ttSpecialDecc",
      type: "JSON",
      ID: args.id,
    });

    if (args.decisionName) {
      params.append("LM", args.decisionName);
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

    if (!data.SpecialDeccService) {
      throw new Error("Tax tribunal decision not found or invalid response format");
    }

    const decc = data.SpecialDeccService;
    const basic = {
      사건명: decc.사건명,
      사건번호: decc.사건번호,
      청구번호: decc.청구번호,
      처분일자: decc.처분일자,
      의결일자: decc.의결일자,
      처분청: decc.처분청,
      재결청: decc.재결청,
      재결례유형명: decc.재결례유형명,
      세목: decc.세목
    };
    const content = {
      재결요지: decc.재결요지,
      따른결정: decc.따른결정,
      참조결정: decc.참조결정,
      주문: decc.주문,
      청구취지: decc.청구취지,
      이유: decc.이유,
      관련법령: decc.관련법령
    };

    let output = `=== ${basic.사건명 || "Tax Tribunal Decision"} ===\n\n`;

    output += `📋 기본 정보:\n`;
    output += `  사건번호: ${basic.사건번호 || "N/A"}\n`;
    output += `  청구번호: ${basic.청구번호 || "N/A"}\n`;
    output += `  처분일자: ${basic.처분일자 || "N/A"}\n`;
    output += `  의결일자: ${basic.의결일자 || "N/A"}\n`;
    output += `  처분청: ${basic.처분청 || "N/A"}\n`;
    output += `  재결청: ${basic.재결청 || "N/A"}\n`;
    output += `  재결유형: ${basic.재결례유형명 || "N/A"}\n`;
    output += `  세목: ${basic.세목 || "N/A"}\n\n`;

    if (content.재결요지) {
      output += `📌 재결요지:\n${content.재결요지}\n\n`;
    }

    if (content.주문) {
      output += `⚖️ 주문:\n${content.주문}\n\n`;
    }

    if (content.청구취지) {
      output += `📝 청구취지:\n${content.청구취지}\n\n`;
    }

    if (content.이유) {
      output += `📄 이유:\n${content.이유}\n\n`;
    }

    if (content.따른결정) {
      output += `🔗 따른결정:\n${content.따른결정}\n\n`;
    }

    if (content.참조결정) {
      output += `📖 참조결정:\n${content.참조결정}\n\n`;
    }

    if (content.관련법령) {
      output += `📚 관련법령:\n${content.관련법령}\n`;
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

  // Extract Decc (actual API response uses <Decc>, not <TtSpecialDeccSearch>)
  const searchMatch = xml.match(/<Decc[^>]*>([\s\S]*?)<\/Decc>/);
  if (!searchMatch) return obj;

  const content = searchMatch[1];
  obj.TtSpecialDeccSearch = {};

  // Extract totalCnt and page
  const totalCntMatch = content.match(/<totalCnt>([^<]*)<\/totalCnt>/);
  const pageMatch = content.match(/<page>([^<]*)<\/page>/);

  obj.TtSpecialDeccSearch.totalCnt = totalCntMatch ? totalCntMatch[1] : "0";
  obj.TtSpecialDeccSearch.page = pageMatch ? pageMatch[1] : "1";

  // Extract decc items
  const deccMatches = content.matchAll(/<decc[^>]*>([\s\S]*?)<\/decc>/g);
  obj.TtSpecialDeccSearch.decc = [];

  for (const match of deccMatches) {
    const deccContent = match[1];
    const decc: any = {};

    const extractTag = (tag: string) => {
      // CDATA support
      const cdataRegex = new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\/${tag}>`);
      const cdataMatch = deccContent.match(cdataRegex);
      if (cdataMatch) return cdataMatch[1];

      const regex = new RegExp(`<${tag}>([^<]*)<\/${tag}>`);
      const match = deccContent.match(regex);
      return match ? match[1] : "";
    };

    decc.특별행정심판재결례일련번호 = extractTag("특별행정심판재결례일련번호");
    decc.사건명 = extractTag("사건명");
    decc.청구번호 = extractTag("청구번호");
    decc.처분일자 = extractTag("처분일자");
    decc.의결일자 = extractTag("의결일자");
    decc.처분청 = extractTag("처분청");
    decc.재결청 = extractTag("재결청");
    decc.재결구분명 = extractTag("재결구분명");
    decc.재결구분코드 = extractTag("재결구분코드");
    decc.행정심판재결례상세링크 = extractTag("행정심판재결례상세링크");

    obj.TtSpecialDeccSearch.decc.push(decc);
  }

  return obj;
}
