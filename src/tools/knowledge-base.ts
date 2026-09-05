import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { truncateResponse } from "../lib/schemas.js"
import { extractTag, parseKBXML, fallbackTermSearch } from "./kb-utils.js"
import { formatToolError, noResultHint } from "../lib/errors.js"

// ============================================================================
// 법령정보 지식베이스 API
// - 법령용어/일상용어 조회 및 연계
// - 용어-조문 연계
// - 관련법령 조회
// ============================================================================

// ----------------------------------------------------------------------------
// 연계 API(lstrmRlt / lstrmRltJo / lsRlt) 전용 파서
//
// 이 세 응답은 항목을 한글 래퍼(<연계용어>/<연계법령>/<관련법령>)에 담고 필드명도
// 다르다. 공유 parseKBXML은 항목 태그를 ["lstrm","lstrmAI","law","jo","rel","item"]로
// 고정하므로 여기서는 언제나 0건이 된다. parseKBXML은 정상 동작 중인 다른 도구
// (get_legal_term_kb·get_daily_term·fallbackTermSearch)가 함께 쓰므로 손대지 않고,
// 이 파일의 연계 도구 4개만 쓰는 파서를 둔다.
//
// <검색결과개수>는 기준 용어·기준 법령의 개수(항상 1)이지 연계 항목 수가 아니라
// 총건수로 쓸 수 없다. 파싱한 항목 수를 총건수로 쓴다.
// ----------------------------------------------------------------------------
interface RelationItem {
  법령명?: string
  법령ID?: string
  관계유형?: string
  조문번호?: string
  조문표기?: string
  조문제목?: string
  연계용어명?: string
}

function parseRelationXML(
  xml: string,
  itemTag: string,
  mapItem: (content: string) => RelationItem | null,
  limit?: number
): RelationItem[] {
  const items: RelationItem[] = []
  const itemRegex = new RegExp(`<${itemTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${itemTag}>`, "g")

  for (const match of xml.matchAll(itemRegex)) {
    const item = mapItem(match[1])
    if (!item) continue

    items.push(item)
    if (limit && items.length >= limit) break
  }

  return items
}

/** <연계용어> 항목. 일상↔법령 양방향이 같은 target(lstrmRlt)을 쓰므로 공통이다. */
function mapRelatedTerm(content: string): RelationItem | null {
  const name = extractTag(content, "일상용어명") || extractTag(content, "법령용어명")
  return name ? { 연계용어명: name } : null
}

/**
 * 조번호 "0024" + 조가지번호 "02" → "제24조의2"
 * 가지번호를 조 앞에 붙인 "제24의2조"는 존재하지 않는 조문 표기다.
 */
function formatArticleLabel(content: string): { 조문번호: string; 조문표기: string } {
  const articleNumber = Number.parseInt(extractTag(content, "조번호") || "0", 10)
  if (!articleNumber) return { 조문번호: "", 조문표기: "" }

  const branchNumber = Number.parseInt(extractTag(content, "조가지번호") || "0", 10)
  return branchNumber > 0
    ? { 조문번호: `${articleNumber}의${branchNumber}`, 조문표기: `제${articleNumber}조의${branchNumber}` }
    : { 조문번호: String(articleNumber), 조문표기: `제${articleNumber}조` }
}

// 1. 법령용어 지식베이스 조회 (lstrmAI)
export const getLegalTermKBSchema = z.object({
  query: z.string().describe("검색할 법령용어"),
  display: z.number().min(1).max(100).default(20).describe("결과 수 (기본:20)"),
  page: z.number().min(1).default(1).describe("페이지 (기본:1)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
});

export type GetLegalTermKBInput = z.infer<typeof getLegalTermKBSchema>;

export async function getLegalTermKB(
  apiClient: LawApiClient,
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
      return noResultHint(args.query, "법령용어 지식베이스")
    }

    let output = `법령용어 지식베이스 (${totalCount}건):\n\n`;

    for (const item of items) {
      output += `${item.법령용어명 || item.용어명}\n`;
      if (item.동음이의어) output += `   [주의] 동음이의어 있음\n`;
      if (item.용어간관계링크) output += `   용어관계: 있음\n`;
      if (item.조문간관계링크) output += `   조문관계: 있음\n`;
      output += `\n`;
    }

    return { content: [{ type: "text", text: truncateResponse(output) }] };
  } catch (error) {
    return formatToolError(error, "get_legal_term_kb");
  }
}

// 2. 법령용어 상세 조회 (lstrm 본문)
export const getLegalTermDetailSchema = z.object({
  query: z.string().describe("조회할 법령용어명"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
});

export type GetLegalTermDetailInput = z.infer<typeof getLegalTermDetailSchema>;

export async function getLegalTermDetail(
  apiClient: LawApiClient,
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
        content: [{ type: "text", text: `[NOT_FOUND] '${args.query}' 용어를 찾을 수 없습니다.\n⚠️ LLM은 용어 정의를 추측/생성하지 마세요.` }],
        isError: true,
      };
    }

    let output = `법령용어 상세\n\n`;
    output += `${termName}`;
    if (termHanja) output += ` (${termHanja})`;
    output += `\n\n`;

    if (definition) {
      output += `정의:\n${definition}\n\n`;
    }
    if (source) {
      output += `출처: ${source}\n`;
    }
    if (code) {
      output += `분류: ${code}\n`;
    }

    return { content: [{ type: "text", text: truncateResponse(output) }] };
  } catch (error) {
    return formatToolError(error, "get_legal_term_detail");
  }
}

// 3. 일상용어 조회
export const getDailyTermSchema = z.object({
  query: z.string().describe("검색할 일상용어 (예: '월세', '전세', '뺑소니')"),
  display: z.number().min(1).max(100).default(20).describe("결과 수 (기본:20)"),
  page: z.number().min(1).default(1).describe("페이지 (기본:1)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
});

export type GetDailyTermInput = z.infer<typeof getDailyTermSchema>;

export async function getDailyTerm(
  apiClient: LawApiClient,
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
      return noResultHint(args.query, "일상용어")
    }

    let output = `일상용어 검색 결과 (${totalCount}건):\n\n`;

    for (const item of items) {
      output += `${item.법령용어명 || item.용어명}\n`;
      if (item.법령용어ID) output += `   ID: ${item.법령용어ID}\n`;
      output += `\n`;
    }

    return { content: [{ type: "text", text: truncateResponse(output) }] };
  } catch (error) {
    return formatToolError(error, "get_daily_term");
  }
}

// 4. 일상용어 → 법령용어 연계
export const getDailyToLegalSchema = z.object({
  dailyTerm: z.string().describe("일상용어 (예: '월세' → '임대차')"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
});

export type GetDailyToLegalInput = z.infer<typeof getDailyToLegalSchema>;

export async function getDailyToLegal(
  apiClient: LawApiClient,
  args: GetDailyToLegalInput
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    let xmlText: string;
    try {
      xmlText = await apiClient.fetchApi({
        endpoint: "lawService.do",
        target: "lstrmRlt",
        extraParams: { query: args.dailyTerm },
        apiKey: args.apiKey,
      });
    } catch {
      return await fallbackTermSearch(apiClient, args.dailyTerm, "일상용어");
    }
    const items = parseRelationXML(xmlText, "연계용어", mapRelatedTerm);

    if (items.length === 0) {
      return await fallbackTermSearch(apiClient, args.dailyTerm, "일상용어");
    }

    let output = `일상용어 → 법령용어 연계\n\n`;
    output += `입력: ${args.dailyTerm}\n\n`;
    output += `관련 법령용어:\n`;

    for (const item of items) {
      output += `   • ${item.연계용어명}\n`;
    }

    return { content: [{ type: "text", text: truncateResponse(output) }] };
  } catch (error) {
    return formatToolError(error, "get_daily_to_legal");
  }
}

// 5. 법령용어 → 일상용어 연계
export const getLegalToDailySchema = z.object({
  legalTerm: z.string().describe("법령용어 (예: '임대차' → '월세', '전세')"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
});

export type GetLegalToDailyInput = z.infer<typeof getLegalToDailySchema>;

export async function getLegalToDaily(
  apiClient: LawApiClient,
  args: GetLegalToDailyInput
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    let xmlText: string;
    try {
      xmlText = await apiClient.fetchApi({
        endpoint: "lawService.do",
        target: "lstrmRlt",
        extraParams: { query: args.legalTerm },
        apiKey: args.apiKey,
      });
    } catch {
      return await fallbackTermSearch(apiClient, args.legalTerm, "법령용어");
    }
    const items = parseRelationXML(xmlText, "연계용어", mapRelatedTerm);

    if (items.length === 0) {
      return await fallbackTermSearch(apiClient, args.legalTerm, "법령용어");
    }

    let output = `법령용어 → 일상용어 연계\n\n`;
    output += `입력: ${args.legalTerm}\n\n`;
    output += `관련 일상용어:\n`;

    for (const item of items) {
      output += `   • ${item.연계용어명}\n`;
    }

    return { content: [{ type: "text", text: truncateResponse(output) }] };
  } catch (error) {
    return formatToolError(error, "get_legal_to_daily");
  }
}

// 6. 법령용어 → 조문 연계 (해당 용어가 사용된 조문)
export const getTermArticlesSchema = z.object({
  term: z.string().describe("검색할 법령용어"),
  display: z.number().min(1).max(100).default(20).describe("결과 수 (기본:20)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
});

export type GetTermArticlesInput = z.infer<typeof getTermArticlesSchema>;

export async function getTermArticles(
  apiClient: LawApiClient,
  args: GetTermArticlesInput
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    let xmlText: string;
    try {
      // lawService.do는 display를 무시하고 연계 조문 전문을 통째로 준다
      // (임대차 기준 196건·약 430KB). 건수 제한은 파서에서 건다.
      xmlText = await apiClient.fetchApi({
        endpoint: "lawService.do",
        target: "lstrmRltJo",
        extraParams: { query: args.term },
        apiKey: args.apiKey,
      });
    } catch {
      return {
        content: [{
          type: "text",
          text: `'${args.term}' 용어-조문 연계 조회 실패.`,
        }],
        isError: true,
      };
    }
    const items = parseRelationXML(xmlText, "연계법령", (content) => {
      const 법령명 = extractTag(content, "법령명");
      if (!법령명) return null;

      // 조문제목은 별도 필드가 없어 조문내용 머리("제24조의2(임대차 기간)")에서 뽑는다
      const title = (extractTag(content, "조문내용") || "").match(/제\d+조(?:의\d+)?\s*\(([^)]{1,60})\)/);
      return { 법령명, ...formatArticleLabel(content), 조문제목: title ? title[1] : "" };
    }, args.display || 20);

    if (items.length === 0) {
      return {
        content: [{
          type: "text",
          text: `[NOT_FOUND] '${args.term}' 용어가 사용된 조문을 찾을 수 없습니다.\n⚠️ LLM은 조문을 추측하지 마세요.`,
        }],
        isError: true,
      };
    }

    let output = `'${args.term}' 용어 사용 조문 (${items.length}건):\n\n`;

    for (const item of items) {
      output += `${item.법령명}\n`;
      if (item.조문표기) {
        output += `   ${item.조문표기}`;
        if (item.조문제목) output += ` (${item.조문제목})`;
        output += `\n`;
      }
      output += `\n`;
    }

    // 후속 도구 안내 제거 (LLM이 이미 도구 목록을 알고 있음)

    return { content: [{ type: "text", text: truncateResponse(output) }] };
  } catch (error) {
    return formatToolError(error, "get_term_articles");
  }
}

// 7. 관련법령 조회
export const getRelatedLawsSchema = z.object({
  lawId: z.string().optional().describe("법령ID"),
  lawName: z.string().optional().describe("법령명"),
  display: z.number().min(1).max(100).default(20).describe("결과 수 (기본:20)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
});

export type GetRelatedLawsInput = z.infer<typeof getRelatedLawsSchema>;

export async function getRelatedLaws(
  apiClient: LawApiClient,
  args: GetRelatedLawsInput
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    if (!args.lawId && !args.lawName) {
      throw new Error("lawId 또는 lawName 중 하나는 필수입니다.");
    }

    const extraParams: Record<string, string> = {
      display: (args.display || 20).toString(),
    };
    if (args.lawId) extraParams.ID = String(args.lawId);
    if (args.lawName) extraParams.query = String(args.lawName);

    let xmlText: string;
    try {
      xmlText = await apiClient.fetchApi({
        endpoint: "lawSearch.do",
        target: "lsRlt",
        extraParams,
        apiKey: args.apiKey,
      });
    } catch {
      return {
        content: [{
          type: "text",
          text: `[API_ERROR] 관련법령 조회 실패.\n⚠️ LLM은 관련 법령을 추측/생성하지 마세요. 잠시 후 재시도하세요.`,
        }],
        isError: true,
      };
    }
    const items = parseRelationXML(xmlText, "관련법령", (content) => {
      const 법령명 = extractTag(content, "관련법령명");
      if (!법령명) return null;

      return {
        법령명,
        법령ID: extractTag(content, "관련법령ID"),
        관계유형: extractTag(content, "법령간관계"),
      };
    }, args.display || 20);

    if (items.length === 0) {
      return {
        content: [{
          type: "text",
          text: `[NOT_FOUND] 관련법령을 찾을 수 없습니다.\n⚠️ LLM은 관련 법령을 추측하지 마세요.`,
        }],
        isError: true,
      };
    }

    let output = `관련법령 (${items.length}건):\n\n`;

    for (const item of items) {
      output += `${item.법령명}\n`;
      if (item.관계유형) output += `   관계: ${item.관계유형}\n`;
      if (item.법령ID) output += `   법령ID: ${item.법령ID}\n`;
      output += `\n`;
    }

    // 후속 도구 안내 제거 (LLM이 이미 도구 목록을 알고 있음)

    return { content: [{ type: "text", text: truncateResponse(output) }] };
  } catch (error) {
    return formatToolError(error, "get_related_laws");
  }
}

