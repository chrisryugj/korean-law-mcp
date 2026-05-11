import { z } from "zod";
import type { LawApiClient } from "../lib/api-client.js";
import { truncateResponse } from "../lib/schemas.js";
import { parseSearchXML, extractTag } from "../lib/xml-parser.js";
import { formatToolError, noResultHint } from "../lib/errors.js";

// Legal terms search tool - Search for legal terminology definitions
export const searchLegalTermsSchema = z.object({
  query: z.string().describe("검색할 법령용어 (예: '선의', '악의', '하자', '채권')"),
  display: z.number().min(1).max(100).default(20).describe("페이지당 결과 개수 (기본값: 20, 최대: 100)"),
  page: z.number().min(1).default(1).describe("페이지 번호 (기본값: 1)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
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
    // parseSearchXML 사용 (rootTag: LsTrmSearch, itemTag: lstrm)
    const { totalCnt, page: currentPage, items: terms } = parseSearchXML(
      xmlText, "LsTrmSearch", "lstrm",
      (content) => ({
        용어명: extractTag(content, "법령용어명") || extractTag(content, "용어명") || extractTag(content, "용어"),
        용어ID: extractTag(content, "법령용어ID"),
        용어정의: extractTag(content, "용어정의") || extractTag(content, "정의"),
        관련법령: extractTag(content, "관련법령") || extractTag(content, "법령명"),
        일상용어: extractTag(content, "일상용어"),
        영문용어: extractTag(content, "영문용어") || extractTag(content, "영문"),
        상세링크: extractTag(content, "법령용어상세링크") || extractTag(content, "법령용어상세검색"),
      }),
      { useIndexOf: true }
    );

    const totalCount = totalCnt;

    if (totalCount === 0) {
      return noResultHint(args.query || "", "법률용어")
    }

    let output = `법령용어 검색 결과 (총 ${totalCount}건, ${currentPage}페이지):\n\n`;

    for (const term of terms) {
      output += `${term.용어명}\n`;
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

    // 후속 도구 안내 제거 (LLM이 이미 도구 목록을 알고 있음)

    return {
      content: [{
        type: "text",
        text: truncateResponse(output)
      }]
    };
  } catch (error) {
    return formatToolError(error, "search_legal_terms");
  }
}

