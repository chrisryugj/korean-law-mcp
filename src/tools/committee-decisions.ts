import { z } from "zod";
import { truncateResponse } from "../lib/schemas.js";

// Common schema for committee decision search (query optional)
const baseSearchSchemaOptionalQuery = {
  query: z.string().optional().describe("검색 키워드"),
  display: z.number().min(1).max(100).default(20).describe("페이지당 결과 개수 (기본값: 20, 최대: 100)"),
  page: z.number().min(1).default(1).describe("페이지 번호 (기본값: 1)"),
  sort: z.enum(["lasc", "ldes", "dasc", "ddes"]).optional()
    .describe("정렬 옵션: lasc/ldes (법령명순), dasc/ddes (날짜순)"),
  apiKey: z.string().optional().describe("API 키"),
};

// Common schema for committee decision search (query required)
const baseSearchSchemaRequiredQuery = {
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
  ...baseSearchSchemaRequiredQuery,
  query: z.string().describe("검색 키워드 (필수, 예: '담합', '불공정거래', '시정명령')"),
});

export type SearchFtcDecisionsInput = z.infer<typeof searchFtcDecisionsSchema>;

export async function searchFtcDecisions(
  apiClient: any,
  args: SearchFtcDecisionsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  return searchCommitteeDecisions(apiClient, args, "ftc", "공정거래위원회 결정문", "get_ftc_decision_text");
}

export const getFtcDecisionTextSchema = z.object(baseTextSchema);
export type GetFtcDecisionTextInput = z.infer<typeof getFtcDecisionTextSchema>;

export async function getFtcDecisionText(
  apiClient: any,
  args: GetFtcDecisionTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  return getCommitteeDecisionText(apiClient, args, "ftc", "공정거래위원회 결정문");
}

// ========================================
// 개인정보보호위원회 결정문 (PIPC Decisions)
// ========================================

export const searchPipcDecisionsSchema = z.object({
  ...baseSearchSchemaRequiredQuery,
  query: z.string().describe("검색 키워드 (필수, 예: '개인정보', '유출', '과징금')"),
});

export type SearchPipcDecisionsInput = z.infer<typeof searchPipcDecisionsSchema>;

export async function searchPipcDecisions(
  apiClient: any,
  args: SearchPipcDecisionsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  return searchCommitteeDecisions(apiClient, args, "ppc", "개인정보보호위원회 결정문", "get_pipc_decision_text");
}

export const getPipcDecisionTextSchema = z.object(baseTextSchema);
export type GetPipcDecisionTextInput = z.infer<typeof getPipcDecisionTextSchema>;

export async function getPipcDecisionText(
  apiClient: any,
  args: GetPipcDecisionTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  return getCommitteeDecisionText(apiClient, args, "ppc", "개인정보보호위원회 결정문");
}

// ========================================
// 중앙노동위원회 결정문 (NLRC Decisions)
// ========================================

export const searchNlrcDecisionsSchema = z.object({
  ...baseSearchSchemaOptionalQuery,
  query: z.string().optional().describe("검색 키워드 (예: '부당해고', '노동쟁의', '조정')"),
});

export type SearchNlrcDecisionsInput = z.infer<typeof searchNlrcDecisionsSchema>;

export async function searchNlrcDecisions(
  apiClient: any,
  args: SearchNlrcDecisionsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  return searchCommitteeDecisions(apiClient, args, "nlrc", "중앙노동위원회 결정문", "get_nlrc_decision_text");
}

export const getNlrcDecisionTextSchema = z.object(baseTextSchema);
export type GetNlrcDecisionTextInput = z.infer<typeof getNlrcDecisionTextSchema>;

export async function getNlrcDecisionText(
  apiClient: any,
  args: GetNlrcDecisionTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  return getCommitteeDecisionText(apiClient, args, "nlrc", "중앙노동위원회 결정문");
}

// ========================================
// Common Implementation
// ========================================

async function searchCommitteeDecisions(
  apiClient: any,
  args: any,
  target: string,
  committeeName: string,
  textToolName: string
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
      target,
      extraParams,
      apiKey: args.apiKey,
    });
    const result = parseCommitteeXML(xmlText, target);

    const searchKey = getSearchKey(target);
    if (!result[searchKey]) {
      throw new Error("Invalid response format from API");
    }

    const data = result[searchKey];
    const totalCount = parseInt(data.totalCnt || "0");
    const currentPage = parseInt(data.page || "1");
    const itemKey = target.toLowerCase();
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
      const title = decision.사건명 || "(제목 없음)";
      output += `[${decision.결정일련번호}] ${title}\n`;
      if (decision.사건번호) output += `  사건번호: ${decision.사건번호}\n`;
      if (decision.결정일자) output += `  결정일: ${decision.결정일자}\n`;
      if (decision.결정유형) output += `  결정유형: ${decision.결정유형}\n`;
      if (decision.재결청) output += `  재결청: ${decision.재결청}\n`;
      if (decision.상세링크) output += `  링크: ${decision.상세링크}\n`;
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
  apiClient: any,
  args: any,
  target: string,
  committeeName: string
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const responseText = await apiClient.fetchApi({
      endpoint: "lawService.do",
      target,
      type: "JSON",
      extraParams: { ID: args.id },
      apiKey: args.apiKey,
    });

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

// Helper functions
function getSearchKey(target: string): string {
  const mapping: Record<string, string> = {
    ftc: "Ftc",
    ppc: "Ppc",
    nlrc: "Nlrc",
    acr: "Acr",
  };
  return mapping[target] || `${target.charAt(0).toUpperCase() + target.slice(1)}`;
}

function getServiceKey(target: string): string {
  const mapping: Record<string, string> = {
    ftc: "FtcService",
    ppc: "PpcService",
    nlrc: "NlrcService",
    acr: "AcrService",
  };
  return mapping[target] || `${target.charAt(0).toUpperCase() + target.slice(1)}Service`;
}

function parseCommitteeXML(xml: string, target: string): any {
  const obj: any = {};

  // Get the search key (e.g., "Ftc", "Nlrc", "Pipc")
  const searchKey = getSearchKey(target);

  // Find root element using indexOf/lastIndexOf for accurate matching
  // This avoids case-insensitive regex matching inner tags like </nlrc> as </Nlrc>
  const rootStartTag = `<${searchKey}>`;
  const rootEndTag = `</${searchKey}>`;
  const startIdx = xml.indexOf(rootStartTag);
  const endIdx = xml.lastIndexOf(rootEndTag);

  if (startIdx === -1 || endIdx === -1) return obj;

  const content = xml.substring(startIdx + rootStartTag.length, endIdx);
  obj[searchKey] = {};

  const totalCntMatch = content.match(/<totalCnt>([^<]*)<\/totalCnt>/);
  const pageMatch = content.match(/<page>([^<]*)<\/page>/);

  obj[searchKey].totalCnt = totalCntMatch ? totalCntMatch[1] : "0";
  obj[searchKey].page = pageMatch ? pageMatch[1] : "1";

  // Extract items - use lowercase target (ftc, nlrc, pipc)
  const itemKey = target.toLowerCase();
  const itemRegex = new RegExp(`<${itemKey}[^>]*>([\\s\\S]*?)<\\/${itemKey}>`, 'g');
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

    item.결정일련번호 = extractTag("결정문일련번호") || extractTag("결정일련번호") || extractTag("판례일련번호") || extractTag("일련번호");
    // 위원회별 필드명 차이: 공정위=사건명, 개보위=안건명, 노동위=사건명
    item.사건명 = extractTag("사건명") || extractTag("안건명") || extractTag("제목");
    item.사건번호 = extractTag("사건번호") || extractTag("의안번호");
    item.결정일자 = extractTag("결정일자") || extractTag("의결일") || extractTag("선고일자") || extractTag("등록일");
    item.결정유형 = extractTag("결정유형") || extractTag("결정구분") || extractTag("판결유형") || extractTag("회의종류");
    item.재결청 = extractTag("재결청") || extractTag("기관명");
    item.상세링크 = extractTag("결정문상세링크") || extractTag("상세링크") || extractTag("판례상세링크");

    obj[searchKey][itemKey].push(item);
  }

  return obj;
}
