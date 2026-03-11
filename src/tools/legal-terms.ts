import { z } from "zod";
import type { LawApiClient } from "../lib/api-client.js";
import { truncateResponse } from "../lib/schemas.js";
import { extractTag } from "../lib/xml-parser.js";

// Legal terms search tool - Search for legal terminology definitions
export const searchLegalTermsSchema = z.object({
  query: z.string().describe("검색할 법령용어 (예: '선의', '악의', '하자', '채권')"),
  display: z.number().min(1).max(100).default(20).describe("페이지당 결과 개수 (기본값: 20, 최대: 100)"),
  page: z.number().min(1).default(1).describe("페이지 번호 (기본값: 1)"),
  apiKey: z.string().optional().describe("API 키"),
});

export type SearchLegalTermsInput = z.infer<typeof searchLegalTermsSchema>;

export async function searchLegalTerms(
  apiClient: LawApiClient,
  args: SearchLegalTermsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const xmlText = await apiClient.fetchApi({
      endpoint: "lawSearch.do",
      target: "lstrm",
      extraParams: {
        query: args.query,
        display: (args.display || 20).toString(),
        page: (args.page || 1).toString(),
      },
      apiKey: args.apiKey,
    });
    const result = parseLegalTermsXML(xmlText);

    if (!result.LsTrmSearch) {
      throw new Error("Invalid response format from API");
    }

    const data = result.LsTrmSearch;
    const totalCount = parseInt(data.totalCnt || "0");
    const currentPage = parseInt(data.page || "1");
    const terms = data.lsTrm ? (Array.isArray(data.lsTrm) ? data.lsTrm : [data.lsTrm]) : [];

    if (totalCount === 0) {
      let errorMsg = "검색 결과가 없습니다.";
      errorMsg += `\n\n💡 개선 방법:`;
      errorMsg += `\n   1. 단순 용어로 검색:`;
      errorMsg += `\n      search_legal_terms(query="채권")`;
      errorMsg += `\n\n   2. 유사 용어 시도:`;
      errorMsg += `\n      - "선의" / "악의" (법률상 의미)`;
      errorMsg += `\n      - "하자" / "담보" / "보증"`;
      errorMsg += `\n\n   3. 법령 검색으로 용어 사용례 확인:`;
      errorMsg += `\n      search_law(query="${args.query}")`;

      return {
        content: [{
          type: "text",
          text: errorMsg
        }],
        isError: true
      };
    }

    let output = `법령용어 검색 결과 (총 ${totalCount}건, ${currentPage}페이지):\n\n`;

    for (const term of terms) {
      output += `📌 ${term.용어명}\n`;
      if (term.용어정의) {
        output += `   정의: ${term.용어정의}\n`;
      }
      if (term.관련법령) {
        output += `   관련법령: ${term.관련법령}\n`;
      }
      if (term.일상용어) {
        output += `   일상용어: ${term.일상용어}\n`;
      }
      if (term.영문용어) {
        output += `   영문: ${term.영문용어}\n`;
      }
      output += `\n`;
    }

    output += `\n💡 법령에서 용어 사용례를 확인하려면 search_law(query="용어명")을 사용하세요.`;

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

// XML parser for legal terms search
function parseLegalTermsXML(xml: string): any {
  const obj: any = {};

  // Find root element using indexOf/lastIndexOf for accurate matching
  const rootStartTag = "<LsTrmSearch>";
  const rootEndTag = "</LsTrmSearch>";
  const startIdx = xml.indexOf(rootStartTag);
  const endIdx = xml.lastIndexOf(rootEndTag);

  if (startIdx === -1 || endIdx === -1) return obj;

  const content = xml.substring(startIdx + rootStartTag.length, endIdx);
  obj.LsTrmSearch = {};

  const totalCntMatch = content.match(/<totalCnt>([^<]*)<\/totalCnt>/);
  const pageMatch = content.match(/<page>([^<]*)<\/page>/);

  obj.LsTrmSearch.totalCnt = totalCntMatch ? totalCntMatch[1] : "0";
  obj.LsTrmSearch.page = pageMatch ? pageMatch[1] : "1";

  // Extract lstrm items (lowercase)
  const itemMatches = content.matchAll(/<lstrm[^>]*>([\s\S]*?)<\/lstrm>/g);
  obj.LsTrmSearch.lsTrm = [];

  for (const match of itemMatches) {
    const itemContent = match[1];
    const item: any = {};

    const extract = (tag: string) => extractTag(itemContent, tag);

    // Match actual API field names
    item.용어명 = extract("법령용어명") || extract("용어명") || extract("용어");
    item.용어ID = extract("법령용어ID");
    item.용어정의 = extract("용어정의") || extract("정의");
    item.관련법령 = extract("관련법령") || extract("법령명");
    item.일상용어 = extract("일상용어");
    item.영문용어 = extract("영문용어") || extract("영문");
    item.상세링크 = extract("법령용어상세링크") || extract("법령용어상세검색");

    obj.LsTrmSearch.lsTrm.push(item);
  }

  return obj;
}
