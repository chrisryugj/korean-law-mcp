import { z } from "zod";

// Common schema for committee decision search
const baseSearchSchema = {
  query: z.string().optional().describe("검색 키워드"),
  display: z.number().min(1).max(100).default(20).describe("페이지당 결과 개수 (기본값: 20, 최대: 100)"),
  page: z.number().min(1).default(1).describe("페이지 번호 (기본값: 1)"),
  sort: z.enum(["lasc", "ldes", "dasc", "ddes"]).optional()
    .describe("정렬 옵션: lasc/ldes (법령명순), dasc/ddes (날짜순)"),
  apiKey: z.string().optional().describe("API 키"),
};

const baseTextSchema = {
  id: z.string().describe("결정문 일련번호 (검색 결과에서 획득)"),
  apiKey: z.string().optional().describe("API 키"),
};

// ========================================
// 공정거래위원회 결정문 (FTC Decisions)
// ========================================

export const searchFtcDecisionsSchema = z.object({
  ...baseSearchSchema,
  query: z.string().optional().describe("검색 키워드 (예: '담합', '불공정거래', '시정명령')"),
});

export type SearchFtcDecisionsInput = z.infer<typeof searchFtcDecisionsSchema>;

export async function searchFtcDecisions(
  apiClient: any,
  args: SearchFtcDecisionsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  return searchCommitteeDecisions(args, "ftcDecc", "공정거래위원회 결정문", "get_ftc_decision_text");
}

export const getFtcDecisionTextSchema = z.object(baseTextSchema);
export type GetFtcDecisionTextInput = z.infer<typeof getFtcDecisionTextSchema>;

export async function getFtcDecisionText(
  apiClient: any,
  args: GetFtcDecisionTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  return getCommitteeDecisionText(args, "ftcDecc", "공정거래위원회 결정문");
}

// ========================================
// 개인정보보호위원회 결정문 (PIPC Decisions)
// ========================================

export const searchPipcDecisionsSchema = z.object({
  ...baseSearchSchema,
  query: z.string().optional().describe("검색 키워드 (예: '개인정보', '유출', '과징금')"),
});

export type SearchPipcDecisionsInput = z.infer<typeof searchPipcDecisionsSchema>;

export async function searchPipcDecisions(
  apiClient: any,
  args: SearchPipcDecisionsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  return searchCommitteeDecisions(args, "pipcDecc", "개인정보보호위원회 결정문", "get_pipc_decision_text");
}

export const getPipcDecisionTextSchema = z.object(baseTextSchema);
export type GetPipcDecisionTextInput = z.infer<typeof getPipcDecisionTextSchema>;

export async function getPipcDecisionText(
  apiClient: any,
  args: GetPipcDecisionTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  return getCommitteeDecisionText(args, "pipcDecc", "개인정보보호위원회 결정문");
}

// ========================================
// 중앙노동위원회 결정문 (NLRC Decisions)
// ========================================

export const searchNlrcDecisionsSchema = z.object({
  ...baseSearchSchema,
  query: z.string().optional().describe("검색 키워드 (예: '부당해고', '노동쟁의', '조정')"),
});

export type SearchNlrcDecisionsInput = z.infer<typeof searchNlrcDecisionsSchema>;

export async function searchNlrcDecisions(
  apiClient: any,
  args: SearchNlrcDecisionsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  return searchCommitteeDecisions(args, "nlrcDecc", "중앙노동위원회 결정문", "get_nlrc_decision_text");
}

export const getNlrcDecisionTextSchema = z.object(baseTextSchema);
export type GetNlrcDecisionTextInput = z.infer<typeof getNlrcDecisionTextSchema>;

export async function getNlrcDecisionText(
  apiClient: any,
  args: GetNlrcDecisionTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  return getCommitteeDecisionText(args, "nlrcDecc", "중앙노동위원회 결정문");
}

// ========================================
// Common Implementation
// ========================================

async function searchCommitteeDecisions(
  args: any,
  target: string,
  committeeName: string,
  textToolName: string
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const apiKey = args.apiKey || process.env.LAW_OC;
    if (!apiKey) {
      throw new Error("API 키가 필요합니다. api_key 파라미터를 전달하거나 LAW_OC 환경변수를 설정하세요.");
    }

    const params = new URLSearchParams({
      OC: apiKey,
      target: target,
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
    const result = parseCommitteeXML(xmlText, target);

    const searchKey = getSearchKey(target);
    if (!result[searchKey]) {
      throw new Error("Invalid response format from API");
    }

    const data = result[searchKey];
    const totalCount = parseInt(data.totalCnt || "0");
    const currentPage = parseInt(data.page || "1");
    const itemKey = target.replace("Decc", "").toLowerCase() + "Decc";
    const decisions = data[itemKey] ? (Array.isArray(data[itemKey]) ? data[itemKey] : [data[itemKey]]) : [];

    if (totalCount === 0) {
      let errorMsg = `검색 결과가 없습니다.`;
      errorMsg += `\n\n💡 ${committeeName} 검색 팁:`;
      errorMsg += `\n   1. 단순 키워드 사용`;
      errorMsg += `\n   2. 판례 검색: search_precedents(query="${args.query || '키워드'}")`;
      errorMsg += `\n   3. 법령해석례 검색: search_interpretations(query="${args.query || '키워드'}")`;

      return {
        content: [{
          type: "text",
          text: errorMsg
        }],
        isError: true
      };
    }

    let output = `${committeeName} 검색 결과 (총 ${totalCount}건, ${currentPage}페이지):\n\n`;

    for (const decision of decisions) {
      output += `[${decision.결정일련번호}] ${decision.사건명}\n`;
      output += `  사건번호: ${decision.사건번호 || "N/A"}\n`;
      output += `  결정일: ${decision.결정일자 || "N/A"}\n`;
      output += `  결정유형: ${decision.결정유형 || "N/A"}\n`;
      if (decision.상세링크) {
        output += `  링크: ${decision.상세링크}\n`;
      }
      output += `\n`;
    }

    output += `\n💡 전문을 조회하려면 ${textToolName}(id="결정일련번호")를 사용하세요.`;

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

async function getCommitteeDecisionText(
  args: any,
  target: string,
  committeeName: string
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const apiKey = args.apiKey || process.env.LAW_OC;
    if (!apiKey) {
      throw new Error("API 키가 필요합니다. api_key 파라미터를 전달하거나 LAW_OC 환경변수를 설정하세요.");
    }

    const params = new URLSearchParams({
      OC: apiKey,
      target: target,
      type: "JSON",
      ID: args.id,
    });

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

    const serviceKey = getServiceKey(target);
    if (!data[serviceKey]) {
      throw new Error(`${committeeName}을(를) 찾을 수 없거나 응답 형식이 올바르지 않습니다.`);
    }

    const decision = data[serviceKey];

    let output = `=== ${decision.사건명 || committeeName} ===\n\n`;

    output += `📋 기본 정보:\n`;
    output += `  사건번호: ${decision.사건번호 || "N/A"}\n`;
    output += `  결정일자: ${decision.결정일자 || "N/A"}\n`;
    output += `  결정유형: ${decision.결정유형 || "N/A"}\n`;
    if (decision.당사자) output += `  당사자: ${decision.당사자}\n`;
    if (decision.피심인) output += `  피심인: ${decision.피심인}\n`;
    output += `\n`;

    if (decision.주문) {
      output += `📌 주문:\n${decision.주문}\n\n`;
    }

    if (decision.결정요지 || decision.요지) {
      output += `📝 결정요지:\n${decision.결정요지 || decision.요지}\n\n`;
    }

    if (decision.이유) {
      output += `📄 이유:\n${decision.이유}\n\n`;
    }

    if (decision.참조조문) {
      output += `📖 참조조문:\n${decision.참조조문}\n\n`;
    }

    if (decision.결정내용 || decision.전문) {
      output += `📄 전문:\n${decision.결정내용 || decision.전문}\n`;
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

// Helper functions
function getSearchKey(target: string): string {
  const mapping: Record<string, string> = {
    ftcDecc: "FtcDeccSearch",
    pipcDecc: "PipcDeccSearch",
    nlrcDecc: "NlrcDeccSearch",
  };
  return mapping[target] || `${target.charAt(0).toUpperCase() + target.slice(1)}Search`;
}

function getServiceKey(target: string): string {
  const mapping: Record<string, string> = {
    ftcDecc: "FtcDeccService",
    pipcDecc: "PipcDeccService",
    nlrcDecc: "NlrcDeccService",
  };
  return mapping[target] || `${target.charAt(0).toUpperCase() + target.slice(1)}Service`;
}

function parseCommitteeXML(xml: string, target: string): any {
  const obj: any = {};

  // Try different root element patterns
  const searchKey = getSearchKey(target);
  const searchRegex = new RegExp(`<${searchKey}[^>]*>([\\s\\S]*?)<\\/${searchKey}>`, 'i');
  const searchMatch = xml.match(searchRegex);

  if (!searchMatch) return obj;

  const content = searchMatch[1];
  obj[searchKey] = {};

  const totalCntMatch = content.match(/<totalCnt>([^<]*)<\/totalCnt>/);
  const pageMatch = content.match(/<page>([^<]*)<\/page>/);

  obj[searchKey].totalCnt = totalCntMatch ? totalCntMatch[1] : "0";
  obj[searchKey].page = pageMatch ? pageMatch[1] : "1";

  // Extract items
  const itemKey = target.replace("Decc", "").toLowerCase() + "Decc";
  const itemRegex = new RegExp(`<${itemKey}[^>]*>([\\s\\S]*?)<\\/${itemKey}>`, 'gi');
  const itemMatches = content.matchAll(itemRegex);
  obj[searchKey][itemKey] = [];

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

    item.결정일련번호 = extractTag("결정일련번호") || extractTag("판례일련번호") || extractTag("일련번호");
    item.사건명 = extractTag("사건명");
    item.사건번호 = extractTag("사건번호");
    item.결정일자 = extractTag("결정일자") || extractTag("선고일자");
    item.결정유형 = extractTag("결정유형") || extractTag("판결유형");
    item.상세링크 = extractTag("상세링크") || extractTag("판례상세링크");

    obj[searchKey][itemKey].push(item);
  }

  return obj;
}
