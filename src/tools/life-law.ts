import { z } from "zod";
import type { LawApiClient } from "../lib/api-client.js";
import { truncateResponse, formatDateDot } from "../lib/schemas.js";
import { extractTag as sharedExtractTag } from "../lib/xml-parser.js";

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
  apiKey: z.string().optional().describe("API 키"),
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
    const result = parseAiSearchXML(xmlText, searchType);

    if (!result.aiSearch) {
      throw new Error("Invalid response format from API");
    }

    const data = result.aiSearch;
    const totalCount = parseInt(data.검색결과개수 || "0");
    let items = data.items || [];

    // lawTypes 필터 적용 (클라이언트 사이드)
    if (args.lawTypes && args.lawTypes.length > 0 && items.length > 0) {
      const typeSet = new Set(args.lawTypes.map((t: string) => t.trim()));
      items = items.filter((item: any) => {
        const kind = item.법령종류명 || "";
        return typeSet.has(kind);
      });
    }

    if (totalCount === 0 || items.length === 0) {
      let errorMsg = "검색 결과가 없습니다.";
      errorMsg += `\n\n💡 지능형 검색 팁:`;
      errorMsg += `\n   - 일상적인 상황으로 질문: "음주운전 처벌"`;
      errorMsg += `\n   - 구체적인 상황 설명: "교통사고 후 도주"`;
      errorMsg += `\n   - 법률 용어 사용: "업무상과실치상"`;
      errorMsg += `\n\n   일반 법령 검색:`;
      errorMsg += `\n   search_law(query="${args.query}")`;

      return {
        content: [{
          type: "text",
          text: errorMsg
        }],
        isError: true
      };
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
    let output = `🔍 지능형 법령검색 결과 (${searchTypeName}, ${displayCount}건${filterNote}):\n\n`;

    for (const item of items) {
      if (searchType === "0" || searchType === "2") {
        // 조문 검색 결과
        output += `📜 ${item.법령명 || item.행정규칙명}\n`;
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
        output += `   📅 시행: ${formatDateDot(item.시행일자)} | ${item.소관부처명 || item.발령기관명 || ""}\n`;
      } else {
        // 별표·서식 검색 결과
        output += `📋 ${item.법령명 || item.행정규칙명}\n`;
        output += `   [${item.별표서식구분명 || "별표/서식"}] ${item.별표서식제목 || ""}\n`;
        output += `   📅 시행: ${formatDateDot(item.시행일자)}\n`;
      }
      output += `\n`;
    }

    output += `\n💡 법령 상세 조회: get_law_text(lawId="법령ID")`;
    output += `\n💡 특정 조문 조회: get_article_text(lawId="법령ID", articleNumber="조문번호")`;

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

// Alias for backward compatibility
export const searchLifeLawSchema = searchAiLawSchema;
export type SearchLifeLawInput = SearchAiLawInput;
export const searchLifeLaw = searchAiLaw;

// formatDate → schemas.ts의 formatDateDot 사용

// XML parser for AI search
function parseAiSearchXML(xml: string, searchType: string): any {
  const obj: any = { aiSearch: {} };

  // Find root element
  const rootStartTag = "<aiSearch>";
  const rootEndTag = "</aiSearch>";
  const startIdx = xml.indexOf(rootStartTag);
  const endIdx = xml.lastIndexOf(rootEndTag);

  if (startIdx === -1 || endIdx === -1) return obj;

  const content = xml.substring(startIdx + rootStartTag.length, endIdx);

  // Extract count
  const countMatch = content.match(/<검색결과개수>(\d+)<\/검색결과개수>/);
  obj.aiSearch.검색결과개수 = countMatch ? countMatch[1] : "0";

  obj.aiSearch.items = [];

  // Determine item tag based on search type
  let itemTag: string;
  switch (searchType) {
    case "1":
      itemTag = "법령별표서식";
      break;
    case "2":
      itemTag = "행정규칙조문";
      break;
    case "3":
      itemTag = "행정규칙별표서식";
      break;
    default:
      itemTag = "법령조문";
  }

  const itemRegex = new RegExp(`<${itemTag}[^>]*>([\\s\\S]*?)<\\/${itemTag}>`, 'g');
  const itemMatches = content.matchAll(itemRegex);

  for (const match of itemMatches) {
    const itemContent = match[1];
    const item: any = {};

    const extractField = (tag: string) => sharedExtractTag(itemContent, tag);

    // Common fields
    item.시행일자 = extractField("시행일자");

    if (searchType === "0") {
      // 법령조문
      item.법령ID = extractField("법령ID");
      item.법령명 = extractField("법령명");
      item.법령종류명 = extractField("법령종류명");
      item.소관부처명 = extractField("소관부처명");
      item.조문번호 = extractField("조문번호");
      item.조문가지번호 = extractField("조문가지번호");
      item.조문제목 = extractField("조문제목");
      item.조문내용 = extractField("조문내용");
    } else if (searchType === "1") {
      // 법령별표서식
      item.법령ID = extractField("법령ID");
      item.법령명 = extractField("법령명");
      item.별표서식번호 = extractField("별표서식번호");
      item.별표서식제목 = extractField("별표서식제목");
      item.별표서식구분명 = extractField("별표서식구분명");
    } else if (searchType === "2") {
      // 행정규칙조문
      item.행정규칙ID = extractField("행정규칙ID");
      item.행정규칙명 = extractField("행정규칙명");
      item.발령기관명 = extractField("발령기관명");
      item.조문번호 = extractField("조문번호");
      item.조문가지번호 = extractField("조문가지번호");
      item.조문제목 = extractField("조문제목");
      item.조문내용 = extractField("조문내용");
    } else {
      // 행정규칙별표서식
      item.행정규칙ID = extractField("행정규칙ID");
      item.행정규칙명 = extractField("행정규칙명");
      item.별표서식번호 = extractField("별표서식번호");
      item.별표서식제목 = extractField("별표서식제목");
      item.별표서식구분명 = extractField("별표서식구분명");
    }

    obj.aiSearch.items.push(item);
  }

  return obj;
}

// Remove getLifeLawGuide as aiSearch doesn't have a detail API
// Users should use get_law_text or get_article_text for details
