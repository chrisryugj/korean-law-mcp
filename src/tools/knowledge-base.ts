import { z } from "zod"
import { truncateResponse } from "../lib/schemas.js"
import { extractTag, parseKBXML, fallbackTermSearch } from "./kb-utils.js"

// ============================================================================
// 법령정보 지식베이스 API
// - 법령용어/일상용어 조회 및 연계
// - 용어-조문 연계
// - 관련법령 조회
// ============================================================================

// 1. 법령용어 지식베이스 조회 (lstrmAI)
export const getLegalTermKBSchema = z.object({
  query: z.string().describe("검색할 법령용어"),
  display: z.number().min(1).max(100).default(20).describe("결과 수 (기본:20)"),
  page: z.number().min(1).default(1).describe("페이지 (기본:1)"),
  apiKey: z.string().optional().describe("API 키"),
});

export type GetLegalTermKBInput = z.infer<typeof getLegalTermKBSchema>;

export async function getLegalTermKB(
  apiClient: any,
  args: GetLegalTermKBInput
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
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
    const result = parseKBXML(xmlText, "LsTrmAISearch");

    if (!result.data) {
      throw new Error("응답 형식 오류");
    }

    const totalCount = parseInt(result.totalCnt || "0");
    const items = result.data;

    if (totalCount === 0 || items.length === 0) {
      return {
        content: [{ type: "text", text: `'${args.query}' 검색 결과가 없습니다.\n\n💡 search_legal_terms로 기본 용어 검색을 시도해보세요.` }],
        isError: true,
      };
    }

    let output = `📚 법령용어 지식베이스 (${totalCount}건):\n\n`;

    for (const item of items) {
      output += `📌 ${item.법령용어명 || item.용어명}\n`;
      if (item.동음이의어) output += `   ⚠️ 동음이의어 있음\n`;
      if (item.용어간관계링크) output += `   🔗 용어관계: 있음\n`;
      if (item.조문간관계링크) output += `   📜 조문관계: 있음\n`;
      output += `\n`;
    }

    output += `\n💡 상세 정의: get_legal_term_detail(termId="ID")`;
    output += `\n💡 일상용어 연계: get_term_daily_link(term="용어명")`;

    return { content: [{ type: "text", text: output }] };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
}

// 2. 법령용어 상세 조회 (lstrm 본문)
export const getLegalTermDetailSchema = z.object({
  query: z.string().describe("조회할 법령용어명"),
  apiKey: z.string().optional().describe("API 키"),
});

export type GetLegalTermDetailInput = z.infer<typeof getLegalTermDetailSchema>;

export async function getLegalTermDetail(
  apiClient: any,
  args: GetLegalTermDetailInput
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    const xmlText = await apiClient.fetchApi({
      endpoint: "lawService.do",
      target: "lstrm",
      extraParams: { query: args.query },
      apiKey: args.apiKey,
    });

    // Parse the detail response
    const termName = extractTag(xmlText, "법령용어명_한글") || extractTag(xmlText, "법령용어명");
    const termHanja = extractTag(xmlText, "법령용어명_한자");
    const definition = extractTag(xmlText, "법령용어정의");
    const source = extractTag(xmlText, "출처");
    const code = extractTag(xmlText, "법령용어코드명");

    if (!termName && !definition) {
      return {
        content: [{ type: "text", text: `'${args.query}' 용어를 찾을 수 없습니다.` }],
        isError: true,
      };
    }

    let output = `📖 법령용어 상세\n\n`;
    output += `📌 ${termName}`;
    if (termHanja) output += ` (${termHanja})`;
    output += `\n\n`;

    if (definition) {
      output += `📝 정의:\n${definition}\n\n`;
    }
    if (source) {
      output += `📚 출처: ${source}\n`;
    }
    if (code) {
      output += `🏷️ 분류: ${code}\n`;
    }

    return { content: [{ type: "text", text: output }] };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
}

// 3. 일상용어 조회
export const getDailyTermSchema = z.object({
  query: z.string().describe("검색할 일상용어 (예: '월세', '전세', '뺑소니')"),
  display: z.number().min(1).max(100).default(20).describe("결과 수 (기본:20)"),
  page: z.number().min(1).default(1).describe("페이지 (기본:1)"),
  apiKey: z.string().optional().describe("API 키"),
});

export type GetDailyTermInput = z.infer<typeof getDailyTermSchema>;

export async function getDailyTerm(
  apiClient: any,
  args: GetDailyTermInput
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    const xmlText = await apiClient.fetchApi({
      endpoint: "lawSearch.do",
      target: "lstrm",
      extraParams: {
        query: args.query,
        display: (args.display || 20).toString(),
        page: (args.page || 1).toString(),
        dicKndCd: "011402",
      },
      apiKey: args.apiKey,
    });
    const result = parseKBXML(xmlText, "LsTrmSearch");

    const totalCount = parseInt(result.totalCnt || "0");
    const items = result.data || [];

    if (totalCount === 0 || items.length === 0) {
      return {
        content: [{
          type: "text",
          text: `'${args.query}' 일상용어 검색 결과가 없습니다.\n\n💡 법령용어로 검색: search_legal_terms(query="${args.query}")\n💡 AI 검색: search_ai_law(query="${args.query}")`
        }],
        isError: true,
      };
    }

    let output = `🗣️ 일상용어 검색 결과 (${totalCount}건):\n\n`;

    for (const item of items) {
      output += `📌 ${item.법령용어명 || item.용어명}\n`;
      if (item.법령용어ID) output += `   ID: ${item.법령용어ID}\n`;
      output += `\n`;
    }

    output += `\n💡 상세 조회: get_legal_term_detail(query="용어명")`;
    output += `\n💡 관련 법령용어: get_daily_to_legal(dailyTerm="용어명")`;

    return { content: [{ type: "text", text: output }] };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
}

// 4. 일상용어 → 법령용어 연계
export const getDailyToLegalSchema = z.object({
  dailyTerm: z.string().describe("일상용어 (예: '월세' → '임대차')"),
  apiKey: z.string().optional().describe("API 키"),
});

export type GetDailyToLegalInput = z.infer<typeof getDailyToLegalSchema>;

export async function getDailyToLegal(
  apiClient: any,
  args: GetDailyToLegalInput
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    let xmlText: string;
    try {
      xmlText = await apiClient.fetchApi({
        endpoint: "lawSearch.do",
        target: "lstrmRel",
        extraParams: { query: args.dailyTerm, relType: "DL" },
        apiKey: args.apiKey,
      });
    } catch {
      return await fallbackTermSearch(apiClient, args.dailyTerm, "일상용어");
    }
    const result = parseKBXML(xmlText, "LsTrmRelSearch");

    const items = result.data || [];

    if (items.length === 0) {
      return await fallbackTermSearch(apiClient, args.dailyTerm, "일상용어");
    }

    let output = `🔗 일상용어 → 법령용어 연계\n\n`;
    output += `📝 입력: ${args.dailyTerm}\n\n`;
    output += `📚 관련 법령용어:\n`;

    for (const item of items) {
      output += `   • ${item.법령용어명 || item.연계용어명}\n`;
    }

    return { content: [{ type: "text", text: output }] };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
}

// 5. 법령용어 → 일상용어 연계
export const getLegalToDailySchema = z.object({
  legalTerm: z.string().describe("법령용어 (예: '임대차' → '월세', '전세')"),
  apiKey: z.string().optional().describe("API 키"),
});

export type GetLegalToDailyInput = z.infer<typeof getLegalToDailySchema>;

export async function getLegalToDaily(
  apiClient: any,
  args: GetLegalToDailyInput
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    let xmlText: string;
    try {
      xmlText = await apiClient.fetchApi({
        endpoint: "lawSearch.do",
        target: "lstrmRel",
        extraParams: { query: args.legalTerm, relType: "LD" },
        apiKey: args.apiKey,
      });
    } catch {
      return await fallbackTermSearch(apiClient, args.legalTerm, "법령용어");
    }
    const result = parseKBXML(xmlText, "LsTrmRelSearch");

    const items = result.data || [];

    if (items.length === 0) {
      return await fallbackTermSearch(apiClient, args.legalTerm, "법령용어");
    }

    let output = `🔗 법령용어 → 일상용어 연계\n\n`;
    output += `📝 입력: ${args.legalTerm}\n\n`;
    output += `🗣️ 관련 일상용어:\n`;

    for (const item of items) {
      output += `   • ${item.일상용어명 || item.연계용어명}\n`;
    }

    return { content: [{ type: "text", text: output }] };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
}

// 6. 법령용어 → 조문 연계 (해당 용어가 사용된 조문)
export const getTermArticlesSchema = z.object({
  term: z.string().describe("검색할 법령용어"),
  display: z.number().min(1).max(100).default(20).describe("결과 수 (기본:20)"),
  apiKey: z.string().optional().describe("API 키"),
});

export type GetTermArticlesInput = z.infer<typeof getTermArticlesSchema>;

export async function getTermArticles(
  apiClient: any,
  args: GetTermArticlesInput
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    let xmlText: string;
    try {
      xmlText = await apiClient.fetchApi({
        endpoint: "lawSearch.do",
        target: "lstrmJo",
        extraParams: {
          query: args.term,
          display: (args.display || 20).toString(),
        },
        apiKey: args.apiKey,
      });
    } catch {
      return {
        content: [{
          type: "text",
          text: `'${args.term}' 용어-조문 연계 조회 실패.\n\n💡 대안:\n   search_ai_law(query="${args.term}") - AI 지능형 검색\n   search_law(query="${args.term}") - 법령 검색`,
        }],
        isError: true,
      };
    }
    const result = parseKBXML(xmlText, "LsTrmJoSearch");

    const totalCount = parseInt(result.totalCnt || "0");
    const items = result.data || [];

    if (totalCount === 0 || items.length === 0) {
      return {
        content: [{
          type: "text",
          text: `'${args.term}' 용어가 사용된 조문을 찾을 수 없습니다.\n\n💡 search_ai_law(query="${args.term}")로 AI 검색을 시도해보세요.`,
        }],
        isError: true,
      };
    }

    let output = `📜 '${args.term}' 용어 사용 조문 (${totalCount}건):\n\n`;

    for (const item of items) {
      output += `📌 ${item.법령명}\n`;
      if (item.조문번호) {
        output += `   제${item.조문번호}조`;
        if (item.조문제목) output += ` (${item.조문제목})`;
        output += `\n`;
      }
      if (item.법령ID) output += `   법령ID: ${item.법령ID}\n`;
      output += `\n`;
    }

    output += `\n💡 조문 상세: get_law_text(lawId="법령ID", jo="조문번호")`;

    return { content: [{ type: "text", text: truncateResponse(output) }] };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
}

// 7. 관련법령 조회
export const getRelatedLawsSchema = z.object({
  lawId: z.string().optional().describe("법령ID"),
  lawName: z.string().optional().describe("법령명"),
  display: z.number().min(1).max(100).default(20).describe("결과 수 (기본:20)"),
  apiKey: z.string().optional().describe("API 키"),
});

export type GetRelatedLawsInput = z.infer<typeof getRelatedLawsSchema>;

export async function getRelatedLaws(
  apiClient: any,
  args: GetRelatedLawsInput
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    if (!args.lawId && !args.lawName) {
      throw new Error("lawId 또는 lawName 중 하나는 필수입니다.");
    }

    const extraParams: Record<string, string> = {
      display: (args.display || 20).toString(),
    };
    if (args.lawId) extraParams.ID = args.lawId;
    if (args.lawName) extraParams.query = args.lawName;

    let xmlText: string;
    try {
      xmlText = await apiClient.fetchApi({
        endpoint: "lawSearch.do",
        target: "lawRel",
        extraParams,
        apiKey: args.apiKey,
      });
    } catch {
      return {
        content: [{
          type: "text",
          text: `관련법령 조회 실패.\n\n💡 대안:\n   get_law_system_tree(lawName="${args.lawName || args.lawId}") - 법령체계도\n   get_three_tier(lawId="${args.lawId}") - 3단비교`,
        }],
        isError: true,
      };
    }
    const result = parseKBXML(xmlText, "LawRelSearch");

    const totalCount = parseInt(result.totalCnt || "0");
    const items = result.data || [];

    if (totalCount === 0 || items.length === 0) {
      return {
        content: [{
          type: "text",
          text: `관련법령을 찾을 수 없습니다.\n\n💡 get_law_system_tree 또는 get_three_tier를 사용해보세요.`,
        }],
        isError: true,
      };
    }

    let output = `🔗 관련법령 (${totalCount}건):\n\n`;

    for (const item of items) {
      output += `📜 ${item.법령명}\n`;
      if (item.관계유형) output += `   관계: ${item.관계유형}\n`;
      if (item.법령ID) output += `   법령ID: ${item.법령ID}\n`;
      if (item.법령종류) output += `   종류: ${item.법령종류}\n`;
      output += `\n`;
    }

    output += `\n💡 법령 조회: get_law_text(lawId="법령ID")`;

    return { content: [{ type: "text", text: truncateResponse(output) }] };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
}

