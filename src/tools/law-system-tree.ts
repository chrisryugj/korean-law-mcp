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
      target: "lsTree",
      type: "JSON",
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

    if (!data.LsTreeService && !data.법령체계도) {
      throw new Error("법령체계도를 찾을 수 없거나 응답 형식이 올바르지 않습니다.");
    }

    const tree = data.LsTreeService || data.법령체계도;

    let output = `=== 법령체계도 ===\n\n`;

    // Root law info
    const rootLaw = tree.법령정보 || tree;
    output += `📋 기준 법령:\n`;
    output += `  법령명: ${rootLaw.법령명한글 || rootLaw.법령명 || "N/A"}\n`;
    output += `  법령구분: ${rootLaw.법령구분명 || rootLaw.법령구분 || "N/A"}\n`;
    output += `  소관부처: ${rootLaw.소관부처명 || rootLaw.소관부처 || "N/A"}\n\n`;

    // Law hierarchy
    output += `📊 법령 체계:\n\n`;

    // Upper laws (상위법령)
    const upperLaws = tree.상위법령 || tree.상위법 || [];
    if (Array.isArray(upperLaws) && upperLaws.length > 0) {
      output += `🔼 상위법령:\n`;
      for (const law of upperLaws) {
        output += `  ├─ ${law.법령명한글 || law.법령명} (${law.법령구분명 || law.법령구분 || ""})\n`;
      }
      output += `\n`;
    }

    // Current law
    output += `📌 현재 법령:\n`;
    output += `  └─ ${rootLaw.법령명한글 || rootLaw.법령명}\n\n`;

    // Lower laws (하위법령)
    const lowerLaws = tree.하위법령 || tree.하위법 || [];
    if (Array.isArray(lowerLaws) && lowerLaws.length > 0) {
      output += `🔽 하위법령:\n`;
      for (const law of lowerLaws) {
        const indent = law.법령구분명?.includes("시행령") ? "  ├─" : "  │  └─";
        output += `${indent} ${law.법령명한글 || law.법령명} (${law.법령구분명 || law.법령구분 || ""})\n`;
      }
      output += `\n`;
    }

    // Related laws (관련법령)
    const relatedLaws = tree.관련법령 || [];
    if (Array.isArray(relatedLaws) && relatedLaws.length > 0) {
      output += `🔗 관련법령:\n`;
      for (const law of relatedLaws.slice(0, 10)) {
        output += `  • ${law.법령명한글 || law.법령명} (${law.관계유형 || ""})\n`;
      }
      if (relatedLaws.length > 10) {
        output += `  ... 외 ${relatedLaws.length - 10}개\n`;
      }
      output += `\n`;
    }

    // Tree visualization
    output += `📐 체계도 시각화:\n\n`;
    output += buildTreeVisualization(tree);

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

// Helper function to build tree visualization
function buildTreeVisualization(tree: any): string {
  const rootLaw = tree.법령정보 || tree;
  const upperLaws = tree.상위법령 || tree.상위법 || [];
  const lowerLaws = tree.하위법령 || tree.하위법 || [];

  let viz = "";

  // Show constitution if applicable
  if (upperLaws.some((l: any) => (l.법령명한글 || l.법령명 || "").includes("헌법"))) {
    viz += "  ┌─────────────┐\n";
    viz += "  │    헌법     │\n";
    viz += "  └──────┬──────┘\n";
    viz += "         │\n";
  }

  // Parent laws (법률)
  const parentLaws = upperLaws.filter((l: any) =>
    (l.법령구분명 || l.법령구분 || "").includes("법률")
  );
  if (parentLaws.length > 0) {
    viz += "  ┌─────────────┐\n";
    viz += `  │ ${truncate(parentLaws[0].법령명한글 || parentLaws[0].법령명, 10)} │ (법률)\n`;
    viz += "  └──────┬──────┘\n";
    viz += "         │\n";
  }

  // Current law or 시행령
  const lawName = rootLaw.법령명한글 || rootLaw.법령명 || "법령";
  const lawType = rootLaw.법령구분명 || rootLaw.법령구분 || "";
  viz += "  ┌─────────────┐\n";
  viz += `  │ ${truncate(lawName, 10)} │ (${lawType})\n`;
  viz += "  └──────┬──────┘\n";

  // Child laws (시행규칙)
  const childLaws = lowerLaws.filter((l: any) =>
    (l.법령구분명 || l.법령구분 || "").includes("시행규칙")
  );
  if (childLaws.length > 0) {
    viz += "         │\n";
    viz += "  ┌──────┴──────┐\n";
    viz += `  │ ${truncate(childLaws[0].법령명한글 || childLaws[0].법령명, 10)} │ (시행규칙)\n`;
    viz += "  └─────────────┘\n";
  }

  return viz;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str.padEnd(maxLen);
  return str.substring(0, maxLen - 2) + "..";
}
