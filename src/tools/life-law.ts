import { z } from "zod";
import type { LawApiClient } from "../lib/api-client.js";
import { truncateResponse, formatDateDot } from "../lib/schemas.js";
import { parseSearchXML, extractTag as sharedExtractTag } from "../lib/xml-parser.js";
import { formatToolError, noResultHint } from "../lib/errors.js";

// AI-powered intelligent law search tool
// 이름은 searchAiLaw가 더 정확하지만, 호환성을 위해 searchLifeLaw alias 유지
export const searchAiLawSchema = z.object({
  query: z.string().describe("자연어 질문 또는 일상 상황 (예: '음주운전 처벌', '임대차 보증금 반환', '퇴직금 계산')"),
  search: z.enum(["0", "1", "2", "3"]).default("0").describe(
    "검색범위: 0=법령조문(기본), 1=법령 별표·서식, 2=행정규칙 조문, 3=행정규칙 별표·서식"
  ),
  display: z.number().min(1).max(100).default(20).describe("페이지당 결과 개수 (기본값: 20)"),
  page: z.number().min(1).default(1).describe("페이지 번호 (기본값: 1)"),
  lawTypes: z.array(z.string()).optional().describe(
    "법령종류 필터 (예: ['법률', '대통령령', '총리령,부령']). 지정 시 해당 종류만 반환."
  ),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
});

export type SearchAiLawInput = z.infer<typeof searchAiLawSchema>;

export async function searchAiLaw(
  apiClient: LawApiClient,
  args: SearchAiLawInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const searchType = args.search || "0";

    const xmlText = await apiClient.fetchApi({
      endpoint: "lawSearch.do",
      target: "aiSearch",
      extraParams: {
        query: args.query,
        search: searchType,
        display: (args.display || 20).toString(),
        page: (args.page || 1).toString(),
      },
      apiKey: args.apiKey,
    });
    // searchType에 따라 itemTag 결정
    const itemTagMap: Record<string, string> = {
      "0": "법령조문", "1": "법령별표서식", "2": "행정규칙조문", "3": "행정규칙별표서식"
    };
    const itemTag = itemTagMap[searchType] || "법령조문";

    // parseSearchXML 사용 (rootTag: aiSearch, totalTag: 검색결과개수)
    const { totalCnt: totalCount, items: parsedItems } = parseSearchXML(
      xmlText, "aiSearch", itemTag,
      (itemContent) => {
        const extractField = (tag: string) => sharedExtractTag(itemContent, tag);
        const item: any = { 시행일자: extractField("시행일자") };

        if (searchType === "0") {
          item.법령ID = extractField("법령ID");
          item.법령명 = extractField("법령명");
          item.법령종류명 = extractField("법령종류명");
          item.소관부처명 = extractField("소관부처명");
          item.조문번호 = extractField("조문번호");
          item.조문가지번호 = extractField("조문가지번호");
          item.조문제목 = extractField("조문제목");
          item.조문내용 = extractField("조문내용");
        } else if (searchType === "1") {
          item.법령ID = extractField("법령ID");
          item.법령명 = extractField("법령명");
          item.별표서식번호 = extractField("별표서식번호");
          item.별표서식제목 = extractField("별표서식제목");
          item.별표서식구분명 = extractField("별표서식구분명");
        } else if (searchType === "2") {
          item.행정규칙ID = extractField("행정규칙ID");
          item.행정규칙명 = extractField("행정규칙명");
          item.발령기관명 = extractField("발령기관명");
          item.조문번호 = extractField("조문번호");
          item.조문가지번호 = extractField("조문가지번호");
          item.조문제목 = extractField("조문제목");
          item.조문내용 = extractField("조문내용");
        } else {
          item.행정규칙ID = extractField("행정규칙ID");
          item.행정규칙명 = extractField("행정규칙명");
          item.별표서식번호 = extractField("별표서식번호");
          item.별표서식제목 = extractField("별표서식제목");
          item.별표서식구분명 = extractField("별표서식구분명");
        }
        return item;
      },
      { totalTag: "검색결과개수" }
    );

    let items = parsedItems as any[];

    // lawTypes 필터 적용 (클라이언트 사이드)
    if (args.lawTypes && args.lawTypes.length > 0 && items.length > 0) {
      const typeSet = new Set(args.lawTypes.map((t: string) => t.trim()));
      items = items.filter((item: any) => {
        const kind = item.법령종류명 || "";
        return typeSet.has(kind);
      });
    }

    if (totalCount === 0 || items.length === 0) {
      return noResultHint(args.query || "", "생활법령")
    }

    const searchTypeNames: Record<string, string> = {
      "0": "법령조문",
      "1": "법령 별표·서식",
      "2": "행정규칙 조문",
      "3": "행정규칙 별표·서식",
    };
    const searchTypeName = searchTypeNames[searchType];

    const displayCount = args.lawTypes ? items.length : totalCount;
    const filterNote = args.lawTypes ? ` [필터: ${args.lawTypes.join(', ')}]` : '';
    let output = `지능형 법령검색 결과 (${searchTypeName}, ${displayCount}건${filterNote}):\n\n`;

    for (const item of items) {
      if (searchType === "0" || searchType === "2") {
        // 조문 검색 결과
        output += `${item.법령명 || item.행정규칙명}\n`;
        if (item.조문번호) {
          output += `   제${item.조문번호}조`;
          if (item.조문가지번호 && item.조문가지번호 !== "00") {
            output += `의${parseInt(item.조문가지번호)}`;
          }
          if (item.조문제목) {
            output += ` (${item.조문제목})`;
          }
          output += `\n`;
        }
        if (item.조문내용) {
          const content = item.조문내용.replace(/<[^>]*>/g, "").substring(0, 200);
          output += `   ${content}${item.조문내용.length > 200 ? "..." : ""}\n`;
        }
        output += `   시행: ${formatDateDot(item.시행일자)} | ${item.소관부처명 || item.발령기관명 || ""}\n`;
      } else {
        // 별표·서식 검색 결과
        output += `${item.법령명 || item.행정규칙명}\n`;
        output += `   [${item.별표서식구분명 || "별표/서식"}] ${item.별표서식제목 || ""}\n`;
        output += `   시행: ${formatDateDot(item.시행일자)}\n`;
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
    return formatToolError(error, "search_ai_law");
  }
}

// Alias for backward compatibility
export const searchLifeLawSchema = searchAiLawSchema;
export type SearchLifeLawInput = SearchAiLawInput;
export const searchLifeLaw = searchAiLaw;

// formatDate → schemas.ts의 formatDateDot 사용
