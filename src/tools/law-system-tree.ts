import { z } from "zod";
import type { LawApiClient } from "../lib/api-client.js";
import { truncateResponse, formatDateDot } from "../lib/schemas.js";
import { formatToolError } from "../lib/errors.js";

// Law system tree tool - Get hierarchical structure of laws
export const getLawSystemTreeSchema = z.object({
  lawId: z.string().optional().describe("법령ID (search_law에서 획득)"),
  mst: z.string().optional().describe("법령일련번호 (MST)"),
  lawName: z.string().optional().describe("법령명"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
});

export type GetLawSystemTreeInput = z.infer<typeof getLawSystemTreeSchema>;

export async function getLawSystemTree(
  apiClient: LawApiClient,
  args: GetLawSystemTreeInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    if (!args.lawId && !args.mst && !args.lawName) {
      throw new Error("lawId, mst, 또는 lawName 중 하나가 필요합니다.");
    }

    const extraParams: Record<string, string> = {};
    if (args.lawId) extraParams.ID = String(args.lawId);
    if (args.mst) extraParams.MST = String(args.mst);
    if (args.lawName) extraParams.LM = String(args.lawName);

    // XML로 요청 (JSON에서는 행정규칙 노드가 누락되므로)
    const xmlText = await apiClient.fetchApi({
      endpoint: "lawService.do",
      target: "lsStmd",
      type: "XML",
      extraParams,
      apiKey: args.apiKey,
    });

    // JSON 파싱도 시도 (상하위법/관련법령 구조는 JSON이 편리)
    const jsonText = await apiClient.fetchApi({
      endpoint: "lawService.do",
      target: "lsStmd",
      type: "JSON",
      extraParams,
      apiKey: args.apiKey,
    });

    let data: any;
    try {
      data = JSON.parse(jsonText);
    } catch (err) {
      throw new Error("Failed to parse JSON response from API");
    }

    if (!data.법령체계도) {
      throw new Error("법령체계도를 찾을 수 없거나 응답 형식이 올바르지 않습니다.");
    }

    const tree = data.법령체계도;
    const basicInfo = tree.기본정보 || {};

    // XML에서 행정규칙 추출
    const adminRules = parseAdminRulesFromXml(xmlText);

    let output = `=== 법령체계도 ===\n\n`;

    // Basic info
    const lawName = basicInfo.법령명 || "N/A";
    const lawType = basicInfo.법종구분?.content || basicInfo.법종구분 || "N/A";
    const revision = basicInfo.제개정구분?.content || basicInfo.제개정구분 || "N/A";

    output += `기준 법령:\n`;
    output += `  법령명: ${lawName}\n`;
    output += `  법령구분: ${lawType}\n`;
    output += `  제개정: ${revision}\n`;
    output += `  시행일자: ${formatDateDot(basicInfo.시행일자)}\n`;
    output += `  공포일자: ${formatDateDot(basicInfo.공포일자)}${basicInfo.공포번호 ? ` (제${basicInfo.공포번호}호)` : ""}\n\n`;

    // Law hierarchy (상하위법)
    output += `법령 체계:\n\n`;

    const hierarchy = tree.상하위법 || {};

    // 법률 section
    if (hierarchy.법률) {
      const lawSection = hierarchy.법률;

      // 시행령
      if (lawSection.시행령) {
        const decrees = Array.isArray(lawSection.시행령) ? lawSection.시행령 : [lawSection.시행령];
        output += `시행령 (${decrees.length}건):\n`;
        for (const decree of decrees.slice(0, 10)) {
          const info = decree.기본정보 || decree;
          output += `  ├─ ${info.법령명} (${info.법종구분?.content || ""})\n`;
        }
        if (decrees.length > 10) {
          output += `  └─ ... 외 ${decrees.length - 10}건\n`;
        }
        output += `\n`;
      }

      // 시행규칙
      if (lawSection.시행규칙) {
        const rules = Array.isArray(lawSection.시행규칙) ? lawSection.시행규칙 : [lawSection.시행규칙];
        output += `시행규칙 (${rules.length}건):\n`;
        for (const rule of rules.slice(0, 10)) {
          const info = rule.기본정보 || rule;
          output += `  ├─ ${info.법령명} (${info.법종구분?.content || ""})\n`;
        }
        if (rules.length > 10) {
          output += `  └─ ... 외 ${rules.length - 10}건\n`;
        }
        output += `\n`;
      }
    }

    // Related laws (관련법령)
    if (tree.관련법령) {
      const related = tree.관련법령.conlaw;
      const relatedList = related ? (Array.isArray(related) ? related : [related]) : [];
      if (relatedList.length > 0) {
        output += `관련법령 (${relatedList.length}건):\n`;
        for (const law of relatedList.slice(0, 5)) {
          output += `  • ${law.법령명} (${law.법종구분?.content || ""})\n`;
        }
        if (relatedList.length > 5) {
          output += `  ... 외 ${relatedList.length - 5}건\n`;
        }
        output += `\n`;
      }
    }

    // 행정규칙 (훈령/예규/고시/지침 등)
    if (adminRules.length > 0) {
      output += `행정규칙 (${adminRules.length}건):\n`;
      for (const rule of adminRules.slice(0, 20)) {
        output += `  ├─ [${rule.type}] ${rule.name}`;
        if (rule.date) output += ` (${rule.date})`;
        output += `\n`;
      }
      if (adminRules.length > 20) {
        output += `  └─ ... 외 ${adminRules.length - 20}건\n`;
      }
      output += `\n`;
    }

    // Tree visualization
    output += `체계도 시각화:\n\n`;
    output += buildTreeVisualization(tree, lawName, lawType);

    return {
      content: [{
        type: "text",
        text: truncateResponse(output)
      }]
    };
  } catch (error) {
    return formatToolError(error, "get_law_system_tree");
  }
}

// formatDate → schemas.ts의 formatDateDot 사용

// Helper function to build tree visualization
function buildTreeVisualization(tree: any, lawName: string, lawType: string): string {
  const hierarchy = tree.상하위법 || {};
  let viz = "";

  // Current law (법률)
  viz += "  ┌─────────────────────┐\n";
  viz += `  │ ${truncate(lawName, 18)} │ (${lawType})\n`;
  viz += "  └──────────┬──────────┘\n";

  // 시행령
  if (hierarchy.법률?.시행령) {
    const decrees = Array.isArray(hierarchy.법률.시행령) ? hierarchy.법률.시행령 : [hierarchy.법률.시행령];
    viz += "             │\n";
    viz += "  ┌──────────┴──────────┐\n";
    const firstDecree = decrees[0]?.기본정보 || decrees[0];
    viz += `  │ ${truncate(firstDecree?.법령명 || "시행령", 18)} │ (시행령)\n`;
    viz += "  └──────────┬──────────┘\n";

    // 시행규칙
    if (hierarchy.법률?.시행규칙) {
      viz += "             │\n";
      viz += "  ┌──────────┴──────────┐\n";
      const rules = Array.isArray(hierarchy.법률.시행규칙) ? hierarchy.법률.시행규칙 : [hierarchy.법률.시행규칙];
      const firstRule = rules[0]?.기본정보 || rules[0];
      viz += `  │ ${truncate(firstRule?.법령명 || "시행규칙", 18)} │ (시행규칙)\n`;
      viz += "  └─────────────────────┘\n";
    }
  }

  return viz;
}

interface AdminRuleInfo {
  name: string
  type: string  // 훈령, 예규, 고시, 지침, 공고, 기타
  id: string
  date: string
}

/** XML 응답에서 행정규칙 목록 추출 (JSON에서는 누락되므로 XML 파싱 필수) */
function parseAdminRulesFromXml(xml: string): AdminRuleInfo[] {
  const rules: AdminRuleInfo[] = []
  const adminBlock = xml.match(/<행정규칙>([\s\S]*?)<\/행정규칙>/)
  if (!adminBlock) return rules

  const content = adminBlock[1]
  const types = ["훈령", "예규", "고시", "지침", "공고", "기타"]

  for (const type of types) {
    const itemRegex = new RegExp(`<${type}>[\\s\\S]*?<기본정보>([\\s\\S]*?)<\\/기본정보>[\\s\\S]*?<\\/${type}>`, "g")
    let match
    while ((match = itemRegex.exec(content)) !== null) {
      const info = match[1]
      const nameMatch = info.match(/<행정규칙명>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/행정규칙명>/)
      const idMatch = info.match(/<행정규칙일련번호>(.*?)<\/행정규칙일련번호>/)
      const dateMatch = info.match(/<시행일자>(.*?)<\/시행일자>/)
      if (nameMatch) {
        rules.push({
          name: nameMatch[1],
          type,
          id: idMatch?.[1] || "",
          date: dateMatch?.[1] ? formatDateDot(dateMatch[1]) : "",
        })
      }
    }
  }

  return rules
}

function truncate(str: string, maxLen: number): string {
  if (!str) return "".padEnd(maxLen);
  if (str.length <= maxLen) return str.padEnd(maxLen);
  return str.substring(0, maxLen - 2) + "..";
}
