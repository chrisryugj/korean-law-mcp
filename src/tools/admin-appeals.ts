import { z } from "zod";

// Administrative appeal decision search tool - Search for administrative tribunal rulings
export const searchAdminAppealsSchema = z.object({
  query: z.string().optional().describe("검색 키워드 (예: '취소처분', '영업정지', '과태료')"),
  display: z.number().min(1).max(100).default(20).describe("페이지당 결과 개수 (기본값: 20, 최대: 100)"),
  page: z.number().min(1).default(1).describe("페이지 번호 (기본값: 1)"),
  sort: z.enum(["lasc", "ldes", "dasc", "ddes", "nasc", "ndes"]).optional()
    .describe("정렬 옵션: lasc/ldes (법령명순), dasc/ddes (날짜순), nasc/ndes (사건번호순)"),
  apiKey: z.string().optional().describe("사용자 API 키 (https://open.law.go.kr 에서 발급, 없으면 서버 기본값 사용)"),
});

export type SearchAdminAppealsInput = z.infer<typeof searchAdminAppealsSchema>;

export async function searchAdminAppeals(
  apiClient: any,
  args: SearchAdminAppealsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const apiKey = args.apiKey || process.env.LAW_OC;
    if (!apiKey) {
      throw new Error("API 키가 필요합니다. api_key 파라미터를 전달하거나 LAW_OC 환경변수를 설정하세요.");
    }

    const params = new URLSearchParams({
      OC: apiKey,
      target: "admJudg",
      type: "XML",
      display: (args.display || 20).toString(),
      page: (args.page || 1).toString(),
    });

    if (args.query) params.append("query", args.query);
    if (args.sort) params.append("sort", args.sort);

    const url = `https://www.law.go.kr/DRF/lawSearch.do?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const xmlText = await response.text();
    const result = parseAdminAppealXML(xmlText);

    if (!result.AdmJudgSearch) {
      throw new Error("Invalid response format from API");
    }

    const data = result.AdmJudgSearch;
    const totalCount = parseInt(data.totalCnt || "0");
    const currentPage = parseInt(data.page || "1");
    const appeals = data.admJudg ? (Array.isArray(data.admJudg) ? data.admJudg : [data.admJudg]) : [];

    if (totalCount === 0) {
      let errorMsg = "검색 결과가 없습니다.";
      errorMsg += `\n\n💡 개선 방법:`;
      errorMsg += `\n   1. 단순 키워드 사용:`;
      if (args.query) {
        const words = args.query.split(/\s+/);
        if (words.length > 1) {
          errorMsg += `\n      search_admin_appeals(query="${words[0]}")`;
        }
      }
      errorMsg += `\n\n   2. 일반 판례 검색:`;
      errorMsg += `\n      search_precedents(query="${args.query || '관련 키워드'}")`;
      errorMsg += `\n\n   3. 법령해석례 검색:`;
      errorMsg += `\n      search_interpretations(query="${args.query || '관련 키워드'}")`;

      return {
        content: [{
          type: "text",
          text: errorMsg
        }],
        isError: true
      };
    }

    let output = `행정심판례 검색 결과 (총 ${totalCount}건, ${currentPage}페이지):\n\n`;

    for (const appeal of appeals) {
      output += `[${appeal.행정심판일련번호}] ${appeal.사건명}\n`;
      output += `  사건번호: ${appeal.사건번호 || "N/A"}\n`;
      output += `  재결일: ${appeal.재결일자 || "N/A"}\n`;
      output += `  피청구인: ${appeal.피청구인 || "N/A"}\n`;
      output += `  재결결과: ${appeal.재결결과 || "N/A"}\n`;
      if (appeal.판례상세링크) {
        output += `  링크: ${appeal.판례상세링크}\n`;
      }
      output += `\n`;
    }

    output += `\n💡 전문을 조회하려면 get_admin_appeal_text(id="행정심판일련번호")를 사용하세요.`;

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

// Administrative appeal decision text retrieval tool
export const getAdminAppealTextSchema = z.object({
  id: z.string().describe("행정심판일련번호 (검색 결과에서 획득)"),
  caseName: z.string().optional().describe("사건명 (선택사항, 검증용)"),
  apiKey: z.string().optional().describe("사용자 API 키 (https://open.law.go.kr 에서 발급, 없으면 서버 기본값 사용)"),
});

export type GetAdminAppealTextInput = z.infer<typeof getAdminAppealTextSchema>;

export async function getAdminAppealText(
  apiClient: any,
  args: GetAdminAppealTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const apiKey = args.apiKey || process.env.LAW_OC;
    if (!apiKey) {
      throw new Error("API 키가 필요합니다. api_key 파라미터를 전달하거나 LAW_OC 환경변수를 설정하세요.");
    }

    const params = new URLSearchParams({
      OC: apiKey,
      target: "admJudg",
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

    if (!data.AdmJudgService) {
      throw new Error("행정심판례를 찾을 수 없거나 응답 형식이 올바르지 않습니다.");
    }

    const appeal = data.AdmJudgService;
    const basic = {
      사건명: appeal.사건명,
      사건번호: appeal.사건번호,
      재결일자: appeal.재결일자,
      청구인: appeal.청구인,
      피청구인: appeal.피청구인,
      재결결과: appeal.재결결과,
      재결청: appeal.재결청,
    };
    const content = {
      주문: appeal.주문,
      청구취지: appeal.청구취지,
      이유: appeal.이유,
      참조조문: appeal.참조조문,
      전문: appeal.판례내용 || appeal.재결내용,
    };

    let output = `=== ${basic.사건명 || "행정심판례"} ===\n\n`;

    output += `📋 기본 정보:\n`;
    output += `  사건번호: ${basic.사건번호 || "N/A"}\n`;
    output += `  재결일자: ${basic.재결일자 || "N/A"}\n`;
    output += `  재결청: ${basic.재결청 || "N/A"}\n`;
    output += `  재결결과: ${basic.재결결과 || "N/A"}\n`;
    if (basic.청구인) output += `  청구인: ${basic.청구인}\n`;
    if (basic.피청구인) output += `  피청구인: ${basic.피청구인}\n`;
    output += `\n`;

    if (content.주문) {
      output += `📌 주문:\n${content.주문}\n\n`;
    }

    if (content.청구취지) {
      output += `📝 청구취지:\n${content.청구취지}\n\n`;
    }

    if (content.이유) {
      output += `📄 이유:\n${content.이유}\n\n`;
    }

    if (content.참조조문) {
      output += `📖 참조조문:\n${content.참조조문}\n\n`;
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

// XML parser for Administrative appeal decisions
function parseAdminAppealXML(xml: string): any {
  const obj: any = {};

  // Try different root element patterns
  const searchMatch = xml.match(/<AdmJudgSearch[^>]*>([\s\S]*?)<\/AdmJudgSearch>/) ||
                      xml.match(/<admJudgSearch[^>]*>([\s\S]*?)<\/admJudgSearch>/);
  if (!searchMatch) return obj;

  const content = searchMatch[1];
  obj.AdmJudgSearch = {};

  const totalCntMatch = content.match(/<totalCnt>([^<]*)<\/totalCnt>/);
  const pageMatch = content.match(/<page>([^<]*)<\/page>/);

  obj.AdmJudgSearch.totalCnt = totalCntMatch ? totalCntMatch[1] : "0";
  obj.AdmJudgSearch.page = pageMatch ? pageMatch[1] : "1";

  // Extract admJudg items
  const itemMatches = content.matchAll(/<admJudg[^>]*>([\s\S]*?)<\/admJudg>/gi);
  obj.AdmJudgSearch.admJudg = [];

  for (const match of itemMatches) {
    const itemContent = match[1];
    const item: any = {};

    const extractTag = (tag: string) => {
      const cdataRegex = new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\/${tag}>`, 'i');
      const cdataMatch = itemContent.match(cdataRegex);
      if (cdataMatch) return cdataMatch[1];

      const regex = new RegExp(`<${tag}>([^<]*)<\/${tag}>`, 'i');
      const match = itemContent.match(regex);
      return match ? match[1] : "";
    };

    item.행정심판일련번호 = extractTag("행정심판일련번호") || extractTag("판례일련번호");
    item.사건명 = extractTag("사건명");
    item.사건번호 = extractTag("사건번호");
    item.재결일자 = extractTag("재결일자") || extractTag("선고일자");
    item.피청구인 = extractTag("피청구인");
    item.재결결과 = extractTag("재결결과") || extractTag("판결유형");
    item.판례상세링크 = extractTag("판례상세링크");

    obj.AdmJudgSearch.admJudg.push(item);
  }

  return obj;
}
