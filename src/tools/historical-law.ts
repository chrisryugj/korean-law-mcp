import { z } from "zod";

// Historical law retrieval tool - Get law text at a specific point in time
export const getHistoricalLawSchema = z.object({
  lawId: z.string().optional().describe("법령ID (search_law에서 획득)"),
  mst: z.string().optional().describe("법령일련번호 (MST)"),
  lawName: z.string().optional().describe("법령명"),
  date: z.string().describe("조회 시점 날짜 (YYYYMMDD 형식, 예: '20200101')"),
  jo: z.string().optional().describe("특정 조문 번호 (예: '제38조')"),
  apiKey: z.string().optional().describe("API 키"),
});

export type GetHistoricalLawInput = z.infer<typeof getHistoricalLawSchema>;

export async function getHistoricalLaw(
  apiClient: any,
  args: GetHistoricalLawInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const apiKey = args.apiKey || process.env.LAW_OC;
    if (!apiKey) {
      throw new Error("API 키가 필요합니다. api_key 파라미터를 전달하거나 LAW_OC 환경변수를 설정하세요.");
    }

    if (!args.lawId && !args.mst && !args.lawName) {
      throw new Error("lawId, mst, 또는 lawName 중 하나가 필요합니다.");
    }

    // Validate date format
    if (!/^\d{8}$/.test(args.date)) {
      throw new Error("날짜 형식이 올바르지 않습니다. YYYYMMDD 형식을 사용하세요 (예: 20200101)");
    }

    const params = new URLSearchParams({
      OC: apiKey,
      target: "law",
      type: "JSON",
      efYd: args.date, // 시행일자 기준 조회
    });

    if (args.lawId) params.append("ID", args.lawId);
    if (args.mst) params.append("MST", args.mst);
    if (args.lawName) params.append("LM", args.lawName);

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

    if (!data.법령) {
      throw new Error(`${args.date} 시점의 법령을 찾을 수 없습니다. 해당 날짜에 시행 중인 법령이 없을 수 있습니다.`);
    }

    const law = data.법령;
    const basic = law.기본정보 || law;

    let output = `=== ${basic.법령명한글 || basic.법령명 || "연혁법령"} ===\n`;
    output += `📅 조회 시점: ${formatDate(args.date)}\n\n`;

    output += `📋 기본 정보:\n`;
    output += `  법령명: ${basic.법령명한글 || basic.법령명 || "N/A"}\n`;
    output += `  시행일자: ${basic.시행일자 || "N/A"}\n`;
    output += `  공포일자: ${basic.공포일자 || "N/A"}\n`;
    output += `  공포번호: ${basic.공포번호 || "N/A"}\n`;
    output += `  제개정구분: ${basic.제개정구분명 || basic.제개정구분 || "N/A"}\n`;
    output += `  소관부처: ${basic.소관부처명 || basic.소관부처 || "N/A"}\n\n`;

    // Extract and filter articles
    const articles = law.조문 || [];
    if (Array.isArray(articles) && articles.length > 0) {
      if (args.jo) {
        // Filter to specific article
        const joCode = parseJoNumber(args.jo);
        const article = articles.find((a: any) => {
          const articleJo = a.조문번호 || a.조번호 || "";
          return articleJo === joCode || a.조문키 === joCode;
        });

        if (article) {
          output += `📄 ${args.jo}:\n`;
          if (article.조문제목) output += `제목: ${article.조문제목}\n`;
          output += `${article.조문내용 || "내용 없음"}\n`;
        } else {
          output += `⚠️ ${args.jo}를 찾을 수 없습니다.\n`;
          output += `\n조문 목록:\n`;
          for (const a of articles.slice(0, 20)) {
            output += `  - 제${a.조문번호 || a.조번호}조 ${a.조문제목 || ""}\n`;
          }
        }
      } else {
        // Show all articles (limited)
        output += `📄 조문 (총 ${articles.length}개):\n\n`;
        for (const article of articles.slice(0, 30)) {
          const joNum = article.조문번호 || article.조번호 || "";
          const title = article.조문제목 || "";
          const content = article.조문내용 || "";

          output += `제${joNum}조`;
          if (title) output += ` (${title})`;
          output += `\n`;
          if (content) {
            output += `${content.substring(0, 500)}`;
            if (content.length > 500) output += "...";
            output += `\n`;
          }
          output += `\n`;
        }
        if (articles.length > 30) {
          output += `\n... 외 ${articles.length - 30}개 조문\n`;
        }
      }
    }

    output += `\n💡 현행 법령 조회: get_law_text(lawId="...", jo="제X조")`;
    output += `\n💡 개정 이력 조회: get_law_history(regDt="YYYYMMDD")`;

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

// Search for historical law versions
export const searchHistoricalLawSchema = z.object({
  lawId: z.string().optional().describe("법령ID"),
  lawName: z.string().optional().describe("법령명"),
  display: z.number().min(1).max(100).default(20).describe("페이지당 결과 개수 (기본값: 20)"),
  page: z.number().min(1).default(1).describe("페이지 번호 (기본값: 1)"),
  apiKey: z.string().optional().describe("API 키"),
});

export type SearchHistoricalLawInput = z.infer<typeof searchHistoricalLawSchema>;

export async function searchHistoricalLaw(
  apiClient: any,
  args: SearchHistoricalLawInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const apiKey = args.apiKey || process.env.LAW_OC;
    if (!apiKey) {
      throw new Error("API 키가 필요합니다. api_key 파라미터를 전달하거나 LAW_OC 환경변수를 설정하세요.");
    }

    const params = new URLSearchParams({
      OC: apiKey,
      target: "lsHstry", // 연혁법령 목록
      type: "XML",
      display: (args.display || 20).toString(),
      page: (args.page || 1).toString(),
    });

    if (args.lawId) params.append("ID", args.lawId);
    if (args.lawName) params.append("query", args.lawName);

    const url = `https://www.law.go.kr/DRF/lawSearch.do?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const xmlText = await response.text();
    const result = parseHistoricalXML(xmlText);

    if (!result.LsHstrySearch) {
      throw new Error("Invalid response format from API");
    }

    const data = result.LsHstrySearch;
    const totalCount = parseInt(data.totalCnt || "0");
    const currentPage = parseInt(data.page || "1");
    const versions = data.lsHstry ? (Array.isArray(data.lsHstry) ? data.lsHstry : [data.lsHstry]) : [];

    if (totalCount === 0) {
      return {
        content: [{
          type: "text",
          text: `연혁법령 검색 결과가 없습니다.\n\n💡 현행법령 검색: search_law(query="${args.lawName || '법령명'}")`
        }],
        isError: true
      };
    }

    let output = `연혁법령 검색 결과 (총 ${totalCount}건, ${currentPage}페이지):\n\n`;

    for (const ver of versions) {
      output += `[${ver.법령ID}] ${ver.법령명}\n`;
      output += `  시행일자: ${ver.시행일자 || "N/A"}\n`;
      output += `  공포일자: ${ver.공포일자 || "N/A"}\n`;
      output += `  제개정구분: ${ver.제개정구분 || "N/A"}\n`;
      output += `\n`;
    }

    output += `\n💡 특정 시점 법령 조회: get_historical_law(lawId="...", date="YYYYMMDD")`;

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

// Helper functions
function formatDate(dateStr: string): string {
  if (dateStr.length !== 8) return dateStr;
  return `${dateStr.substring(0, 4)}년 ${dateStr.substring(4, 6)}월 ${dateStr.substring(6, 8)}일`;
}

function parseJoNumber(joText: string): string {
  // Convert Korean article notation to number
  // "제38조" -> "38", "제10조의2" -> "10의2"
  const match = joText.match(/제?(\d+)조?(의\d+)?/);
  if (match) {
    return match[1] + (match[2] || "");
  }
  return joText.replace(/[^0-9의]/g, "");
}

function parseHistoricalXML(xml: string): any {
  const obj: any = {};

  const searchMatch = xml.match(/<LsHstrySearch[^>]*>([\s\S]*?)<\/LsHstrySearch>/) ||
                      xml.match(/<lsHstrySearch[^>]*>([\s\S]*?)<\/lsHstrySearch>/) ||
                      xml.match(/<LawSearch[^>]*>([\s\S]*?)<\/LawSearch>/);
  if (!searchMatch) return obj;

  const content = searchMatch[1];
  obj.LsHstrySearch = {};

  const totalCntMatch = content.match(/<totalCnt>([^<]*)<\/totalCnt>/);
  const pageMatch = content.match(/<page>([^<]*)<\/page>/);

  obj.LsHstrySearch.totalCnt = totalCntMatch ? totalCntMatch[1] : "0";
  obj.LsHstrySearch.page = pageMatch ? pageMatch[1] : "1";

  const itemMatches = content.matchAll(/<lsHstry[^>]*>([\s\S]*?)<\/lsHstry>/gi) ||
                      content.matchAll(/<law[^>]*>([\s\S]*?)<\/law>/gi);
  obj.LsHstrySearch.lsHstry = [];

  for (const match of itemMatches) {
    const itemContent = match[1];
    const item: any = {};

    const extractTag = (tag: string) => {
      const cdataRegex = new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i');
      const cdataMatch = itemContent.match(cdataRegex);
      if (cdataMatch) return cdataMatch[1];

      const regex = new RegExp(`<${tag}>([^<]*)<\\/${tag}>`, 'i');
      const match = itemContent.match(regex);
      return match ? match[1] : "";
    };

    item.법령ID = extractTag("법령ID") || extractTag("lawId");
    item.법령명 = extractTag("법령명한글") || extractTag("법령명");
    item.시행일자 = extractTag("시행일자");
    item.공포일자 = extractTag("공포일자");
    item.제개정구분 = extractTag("제개정구분명") || extractTag("제개정구분");

    obj.LsHstrySearch.lsHstry.push(item);
  }

  return obj;
}
