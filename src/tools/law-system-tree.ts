import { z } from "zod";

// Law system tree tool - Get hierarchical structure of laws
export const getLawSystemTreeSchema = z.object({
  lawId: z.string().optional().describe("법령ID (search_law에서 획득)"),
  mst: z.string().optional().describe("법령일련번호 (MST)"),
  lawName: z.string().optional().describe("법령명"),
  apiKey: z.string().optional().describe("API 키"),
});

export type GetLawSystemTreeInput = z.infer<typeof getLawSystemTreeSchema>;

export async function getLawSystemTree(
  apiClient: any,
  args: GetLawSystemTreeInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const apiKey = args.apiKey || process.env.LAW_OC;
    if (!apiKey) {
      throw new Error("API 키가 필요합니다. api_key 파라미터를 전달하거나 LAW_OC 환경변수를 설정하세요.");
    }

    if (!args.lawId && !args.mst && !args.lawName) {
      throw new Error("lawId, mst, 또는 lawName 중 하나가 필요합니다.");
    }

    const params = new URLSearchParams({
      OC: apiKey,
      target: "lsStmd",
      type: "JSON",
    });

    // lsStmd uses ID/MST/LM parameters
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

    if (!data.법령체계도) {
      throw new Error("법령체계도를 찾을 수 없거나 응답 형식이 올바르지 않습니다.");
    }

    const tree = data.법령체계도;
    const basicInfo = tree.기본정보 || {};

    let output = `=== 법령체계도 ===\n\n`;

    // Basic info
    const lawName = basicInfo.법령명 || "N/A";
    const lawType = basicInfo.법종구분?.content || basicInfo.법종구분 || "N/A";
    const revision = basicInfo.제개정구분?.content || basicInfo.제개정구분 || "N/A";

    output += `📋 기준 법령:\n`;
    output += `  법령명: ${lawName}\n`;
    output += `  법령구분: ${lawType}\n`;
    output += `  제개정: ${revision}\n`;
    output += `  시행일자: ${formatDate(basicInfo.시행일자)}\n`;
    output += `  공포일자: ${formatDate(basicInfo.공포일자)} (제${basicInfo.공포번호}호)\n\n`;

    // Law hierarchy (상하위법)
    output += `📊 법령 체계:\n\n`;

    const hierarchy = tree.상하위법 || {};

    // 법률 section
    if (hierarchy.법률) {
      const lawSection = hierarchy.법률;

      // 시행령
      if (lawSection.시행령) {
        const decrees = Array.isArray(lawSection.시행령) ? lawSection.시행령 : [lawSection.시행령];
        output += `📜 시행령 (${decrees.length}건):\n`;
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
        output += `📄 시행규칙 (${rules.length}건):\n`;
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
        output += `🔗 관련법령 (${relatedList.length}건):\n`;
        for (const law of relatedList.slice(0, 5)) {
          output += `  • ${law.법령명} (${law.법종구분?.content || ""})\n`;
        }
        if (relatedList.length > 5) {
          output += `  ... 외 ${relatedList.length - 5}건\n`;
        }
        output += `\n`;
      }
    }

    // Tree visualization
    output += `📐 체계도 시각화:\n\n`;
    output += buildTreeVisualization(tree, lawName, lawType);

    output += `\n\n💡 위임조문 상세 조회: get_three_tier(lawId="...")`;
    output += `\n💡 법령 본문 조회: get_law_text(lawId="...")`;

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

// Helper function to format date
function formatDate(dateStr: string): string {
  if (!dateStr || dateStr.length < 8) return dateStr || "N/A";
  return `${dateStr.substring(0, 4)}.${dateStr.substring(4, 6)}.${dateStr.substring(6, 8)}`;
}

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

function truncate(str: string, maxLen: number): string {
  if (!str) return "".padEnd(maxLen);
  if (str.length <= maxLen) return str.padEnd(maxLen);
  return str.substring(0, maxLen - 2) + "..";
}
