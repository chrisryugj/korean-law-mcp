import { z } from "zod";
import type { LawApiClient } from "../lib/api-client.js";
import { extractTag, parseSearchXML } from "../lib/xml-parser.js";
import { truncateResponse } from "../lib/schemas.js";

// ========================================
// Common helpers
// ========================================

const searchSchema = {
  query: z.string().describe("검색 키워드"),
  display: z.number().min(1).max(100).default(20).describe("페이지당 결과 개수 (기본값: 20, 최대: 100)"),
  page: z.number().min(1).default(1).describe("페이지 번호 (기본값: 1)"),
  sort: z.enum(["lasc", "ldes", "dasc", "ddes"]).optional()
    .describe("정렬 옵션: lasc/ldes (법령명순), dasc/ddes (날짜순)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
};

const textSchema = {
  id: z.string().describe("규정 일련번호 (검색 결과에서 획득)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
};

interface RuleItem {
  일련번호: string;
  규정명: string;
  기관명: string;
  공포일자: string;
  시행일자: string;
  상세링크: string;
}

type TargetType = "school" | "public" | "pi";

const targetConfig: Record<TargetType, { rootTag: string; itemTag: string; label: string; serviceKey: string }> = {
  school: { rootTag: "School", itemTag: "school", label: "학칙", serviceKey: "SchoolService" },
  public: { rootTag: "Public", itemTag: "public", label: "지방공사공단 규정", serviceKey: "PublicService" },
  pi: { rootTag: "Pi", itemTag: "pi", label: "공공기관 규정", serviceKey: "PiService" },
};

function parseRuleXML(xml: string, target: TargetType) {
  const cfg = targetConfig[target];
  return parseSearchXML<RuleItem>(xml, cfg.rootTag, cfg.itemTag, (content) => ({
    일련번호: extractTag(content, "학칙일련번호") || extractTag(content, "규정일련번호") || extractTag(content, "일련번호"),
    규정명: extractTag(content, "학칙명") || extractTag(content, "규정명") || extractTag(content, "제목"),
    기관명: extractTag(content, "학교명") || extractTag(content, "기관명"),
    공포일자: extractTag(content, "공포일자") || extractTag(content, "제정일자"),
    시행일자: extractTag(content, "시행일자"),
    상세링크: extractTag(content, "학칙상세링크") || extractTag(content, "규정상세링크") || extractTag(content, "상세링크"),
  }));
}

async function searchRules(
  apiClient: LawApiClient,
  args: { query: string; display?: number; page?: number; sort?: string; apiKey?: string },
  target: TargetType,
  textToolName: string
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    const extraParams: Record<string, string> = {
      query: args.query,
      display: (args.display || 20).toString(),
      page: (args.page || 1).toString(),
    };
    if (args.sort) extraParams.sort = args.sort;

    const xmlText = await apiClient.fetchApi({
      endpoint: "lawSearch.do",
      target,
      extraParams,
      apiKey: args.apiKey,
    });

    const cfg = targetConfig[target];
    const result = parseRuleXML(xmlText, target);

    if (result.totalCnt === 0) {
      return {
        content: [{ type: "text", text: `${cfg.label} 검색 결과가 없습니다. 다른 키워드를 시도하세요.` }],
        isError: true,
      };
    }

    let output = `${cfg.label} 검색 결과 (총 ${result.totalCnt}건, ${result.page}페이지):\n\n`;
    for (const item of result.items) {
      output += `[${item.일련번호}] ${item.규정명}\n`;
      if (item.기관명) output += `  기관: ${item.기관명}\n`;
      if (item.공포일자) output += `  공포일: ${item.공포일자}\n`;
      if (item.시행일자) output += `  시행일: ${item.시행일자}\n`;
      if (item.상세링크) output += `  링크: ${item.상세링크}\n`;
      output += `\n`;
    }
    output += `\n전문 조회: ${textToolName}(id="일련번호")`;

    return { content: [{ type: "text", text: output }] };
  } catch (error) {
    return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
  }
}

async function getRuleText(
  apiClient: LawApiClient,
  args: { id: string; apiKey?: string },
  target: TargetType
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    const cfg = targetConfig[target];
    const responseText = await apiClient.fetchApi({
      endpoint: "lawService.do",
      target,
      type: "JSON",
      extraParams: { ID: args.id },
      apiKey: args.apiKey,
    });

    let data: any;
    try { data = JSON.parse(responseText); } catch { throw new Error("Failed to parse JSON response from API"); }

    const rule = data[cfg.serviceKey];
    if (!rule) throw new Error(`${cfg.label}을(를) 찾을 수 없거나 응답 형식이 올바르지 않습니다.`);

    let output = `=== ${rule.학칙명 || rule.규정명 || rule.제목 || cfg.label} ===\n\n`;
    output += `기본 정보:\n`;
    if (rule.학교명 || rule.기관명) output += `  기관: ${rule.학교명 || rule.기관명}\n`;
    if (rule.공포일자 || rule.제정일자) output += `  공포일: ${rule.공포일자 || rule.제정일자}\n`;
    if (rule.시행일자) output += `  시행일: ${rule.시행일자}\n`;
    output += `\n`;

    if (rule.조문내용 || rule.본문) {
      output += `본문:\n${rule.조문내용 || rule.본문}\n`;
    }
    if (rule.전문) {
      output += `전문:\n${rule.전문}\n`;
    }

    return { content: [{ type: "text", text: truncateResponse(output) }] };
  } catch (error) {
    return { content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
  }
}

// ========================================
// 학칙 (School Rules)
// ========================================

export const searchSchoolRulesSchema = z.object(searchSchema);
export type SearchSchoolRulesInput = z.infer<typeof searchSchoolRulesSchema>;
export async function searchSchoolRules(apiClient: LawApiClient, args: SearchSchoolRulesInput) {
  return searchRules(apiClient, args, "school", "get_school_rule_text");
}

export const getSchoolRuleTextSchema = z.object(textSchema);
export type GetSchoolRuleTextInput = z.infer<typeof getSchoolRuleTextSchema>;
export async function getSchoolRuleText(apiClient: LawApiClient, args: GetSchoolRuleTextInput) {
  return getRuleText(apiClient, args, "school");
}

// ========================================
// 지방공사공단 규정 (Public Corp Rules)
// ========================================

export const searchPublicCorpRulesSchema = z.object(searchSchema);
export type SearchPublicCorpRulesInput = z.infer<typeof searchPublicCorpRulesSchema>;
export async function searchPublicCorpRules(apiClient: LawApiClient, args: SearchPublicCorpRulesInput) {
  return searchRules(apiClient, args, "public", "get_public_corp_rule_text");
}

export const getPublicCorpRuleTextSchema = z.object(textSchema);
export type GetPublicCorpRuleTextInput = z.infer<typeof getPublicCorpRuleTextSchema>;
export async function getPublicCorpRuleText(apiClient: LawApiClient, args: GetPublicCorpRuleTextInput) {
  return getRuleText(apiClient, args, "public");
}

// ========================================
// 공공기관 규정 (Public Institution Rules)
// ========================================

export const searchPublicInstitutionRulesSchema = z.object(searchSchema);
export type SearchPublicInstitutionRulesInput = z.infer<typeof searchPublicInstitutionRulesSchema>;
export async function searchPublicInstitutionRules(apiClient: LawApiClient, args: SearchPublicInstitutionRulesInput) {
  return searchRules(apiClient, args, "pi", "get_public_institution_rule_text");
}

export const getPublicInstitutionRuleTextSchema = z.object(textSchema);
export type GetPublicInstitutionRuleTextInput = z.infer<typeof getPublicInstitutionRuleTextSchema>;
export async function getPublicInstitutionRuleText(apiClient: LawApiClient, args: GetPublicInstitutionRuleTextInput) {
  return getRuleText(apiClient, args, "pi");
}
