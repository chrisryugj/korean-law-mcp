import { z } from "zod";
import type { LawApiClient } from "../lib/api-client.js";
import { truncateResponse } from "../lib/schemas.js";
import { extractTag } from "../lib/xml-parser.js";

// English law search tool - Search for English translations of Korean laws
export const searchEnglishLawSchema = z.object({
  query: z.string().optional().describe("법령명 검색어 (영문 또는 한글, 예: 'Customs Act', '관세법')"),
  display: z.number().min(1).max(100).default(20).describe("페이지당 결과 개수 (기본값: 20, 최대: 100)"),
  page: z.number().min(1).default(1).describe("페이지 번호 (기본값: 1)"),
  sort: z.enum(["lasc", "ldes", "dasc", "ddes"]).optional()
    .describe("정렬 옵션: lasc/ldes (법령명순), dasc/ddes (날짜순)"),
  apiKey: z.string().optional().describe("API 키"),
});

export type SearchEnglishLawInput = z.infer<typeof searchEnglishLawSchema>;

export async function searchEnglishLaw(
  apiClient: LawApiClient,
  args: SearchEnglishLawInput
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
      target: "elaw",
      extraParams,
      apiKey: args.apiKey,
    });
    const result = parseEnglishLawXML(xmlText);

    if (!result.ElawSearch) {
      throw new Error("Invalid response format from API");
    }

    const data = result.ElawSearch;
    const totalCount = parseInt(data.totalCnt || "0");
    const currentPage = parseInt(data.page || "1");
    const laws = data.elaw ? (Array.isArray(data.elaw) ? data.elaw : [data.elaw]) : [];

    if (totalCount === 0) {
      let errorMsg = "검색 결과가 없습니다.";
      errorMsg += `\n\n💡 개선 방법:`;
      errorMsg += `\n   1. 한글 법령명으로 검색:`;
      errorMsg += `\n      search_english_law(query="관세법")`;
      errorMsg += `\n\n   2. 영문 법령명으로 검색:`;
      errorMsg += `\n      search_english_law(query="Customs Act")`;
      errorMsg += `\n\n   3. 한글 법령 먼저 검색 후 영문 조회:`;
      errorMsg += `\n      search_law(query="${args.query || '법령명'}") → get_english_law_text(lawId="...")`;

      return {
        content: [{
          type: "text",
          text: errorMsg
        }],
        isError: true
      };
    }

    let output = `영문법령 검색 결과 (총 ${totalCount}건, ${currentPage}페이지):\n\n`;

    for (const law of laws) {
      output += `[${law.법령ID}] ${law.영문법령명}\n`;
      output += `  한글명: ${law.한글법령명 || "N/A"}\n`;
      output += `  시행일자: ${law.시행일자 || "N/A"}\n`;
      output += `  법령구분: ${law.법령구분 || "N/A"}\n`;
      if (law.법령상세링크) {
        output += `  링크: ${law.법령상세링크}\n`;
      }
      output += `\n`;
    }

    output += `\n💡 영문 전문을 조회하려면 get_english_law_text(lawId="법령ID")를 사용하세요.`;

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

// English law text retrieval tool
export const getEnglishLawTextSchema = z.object({
  lawId: z.string().optional().describe("법령ID (검색 결과에서 획득)"),
  mst: z.string().optional().describe("법령일련번호 (MST)"),
  lawName: z.string().optional().describe("법령명 (영문 또는 한글)"),
  apiKey: z.string().optional().describe("API 키"),
});

export type GetEnglishLawTextInput = z.infer<typeof getEnglishLawTextSchema>;

export async function getEnglishLawText(
  apiClient: LawApiClient,
  args: GetEnglishLawTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    if (!args.lawId && !args.mst && !args.lawName) {
      throw new Error("lawId, mst, 또는 lawName 중 하나가 필요합니다.");
    }

    const extraParams: Record<string, string> = {};
    if (args.lawId) extraParams.ID = args.lawId;
    if (args.mst) extraParams.MST = args.mst;
    if (args.lawName) extraParams.LM = args.lawName;

    const responseText = await apiClient.fetchApi({
      endpoint: "lawService.do",
      target: "elaw",
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

    if (!data.ElawService) {
      throw new Error("영문법령을 찾을 수 없거나 응답 형식이 올바르지 않습니다.");
    }

    const law = data.ElawService;
    const basic = {
      영문법령명: law.영문법령명 || law.법령명_영문,
      한글법령명: law.한글법령명 || law.법령명_한글,
      시행일자: law.시행일자,
      공포일자: law.공포일자,
      법령구분: law.법령구분,
      소관부처: law.소관부처,
    };

    let output = `=== ${basic.영문법령명 || "English Law"} ===\n`;
    output += `(${basic.한글법령명 || "N/A"})\n\n`;

    output += `📋 Basic Information:\n`;
    output += `  English Name: ${basic.영문법령명 || "N/A"}\n`;
    output += `  Korean Name: ${basic.한글법령명 || "N/A"}\n`;
    output += `  Effective Date: ${basic.시행일자 || "N/A"}\n`;
    output += `  Promulgation Date: ${basic.공포일자 || "N/A"}\n`;
    output += `  Law Type: ${basic.법령구분 || "N/A"}\n`;
    output += `  Competent Ministry: ${basic.소관부처 || "N/A"}\n\n`;

    // Extract articles from the response
    const articles = law.조문 || law.조문목록 || [];
    if (Array.isArray(articles) && articles.length > 0) {
      output += `📄 Articles:\n\n`;
      for (const article of articles.slice(0, 50)) { // Limit to first 50 articles
        const articleNo = article.조문번호 || article.조번호 || "";
        const articleTitle = article.조문제목_영문 || article.조문제목 || "";
        const articleContent = article.조문내용_영문 || article.조문내용 || "";

        if (articleNo || articleTitle) {
          output += `Article ${articleNo}`;
          if (articleTitle) output += ` ${articleTitle}`;
          output += `\n`;
        }
        if (articleContent) {
          output += `${articleContent}\n\n`;
        }
      }
      if (articles.length > 50) {
        output += `\n... and ${articles.length - 50} more articles\n`;
      }
    } else if (law.법령내용_영문 || law.법령내용) {
      output += `📄 Content:\n${law.법령내용_영문 || law.법령내용}\n`;
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

// XML parser for English law search
function parseEnglishLawXML(xml: string): any {
  const obj: any = { ElawSearch: {} };

  // Extract totalCnt and page directly (works regardless of root tag)
  const totalCntMatch = xml.match(/<totalCnt>([^<]*)<\/totalCnt>/);
  const pageMatch = xml.match(/<page>([^<]*)<\/page>/);

  obj.ElawSearch.totalCnt = totalCntMatch ? totalCntMatch[1] : "0";
  obj.ElawSearch.page = pageMatch ? pageMatch[1] : "1";
  obj.ElawSearch.elaw = [];

  // Extract law items (API uses <law id="N"> format)
  const itemMatches = xml.matchAll(/<law[^>]*>([\s\S]*?)<\/law>/gi);

  for (const match of itemMatches) {
    const itemContent = match[1];
    const item: any = {};

    const extract = (tag: string) => extractTag(itemContent, tag);

    item.법령ID = extract("법령ID");
    item.영문법령명 = extract("법령명영문");
    item.한글법령명 = extract("법령명한글");
    item.시행일자 = extract("시행일자");
    item.법령구분 = extract("법령구분명");
    item.법령상세링크 = extract("법령상세링크");

    if (item.법령ID || item.영문법령명) {
      obj.ElawSearch.elaw.push(item);
    }
  }

  return obj;
}
