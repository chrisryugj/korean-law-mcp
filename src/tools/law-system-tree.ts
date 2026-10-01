import { z } from "zod";
import type { LawApiClient } from "../lib/api-client.js";
import { truncateResponse, formatDateDot } from "../lib/schemas.js";
import { formatToolError } from "../lib/errors.js";
import { collectLawHierarchy, renderLawHierarchy } from "../lib/law-system-hierarchy.js";

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

    // 두 응답은 서로의 결과를 쓰지 않는다 — XML은 최상위 행정규칙 블록만, JSON은
    // 상하위법/관련법령 그래프만 공급한다. lsStmd는 왕복이 계열 최저속(각 ~5.6초)이라
    // 직렬로 두면 그대로 더해져 히트가 11초를 넘었다. 동시에 띄워 벽시계를 왕복 한 번으로 줄인다.
    //
    // XML 호출을 없앨 수 있는지 실호출로 검증했다(#128, 2026-08-17, 4개 법령).
    // JSON에도 행정규칙 노드가 있고 XML 항목을 전부 포함하지만(XML에만 있는 항목 0/4건),
    // **두 집합은 같지 않다**: JSON 쪽은 형제 법령마다 매달린 것을 합친 더 넓은 집합이고
    // (관세법 XML 22건 vs JSON 고유 97건), XML의 22건은 JSON에서 관세법(9)·시행령(10)·
    // 시행규칙(22)에 흩어져 나타나 **어떤 소유 법령으로도 XML 집합을 재현할 수 없다.**
    // 즉 XML 블록은 별도 큐레이션이라 치환하면 목록 내용이 바뀐다 — 호출 1회 절감보다
    // 표시 집합이 조용히 넓어지는 쪽이 위험하므로 두 호출을 유지한다.
    // allSettled인 이유: 한쪽이 먼저 거절될 때 다른 쪽 거절이 미처리로 남지 않게 한다.
    // 둘 중 하나라도 실패하면 기존과 동일하게 도구 전체를 실패시킨다 — 행정규칙 목록이
    // 조용히 빠진 체계도를 성공처럼 돌려주지 않는다.
    const request = (type: "XML" | "JSON") => apiClient.fetchApi({
      endpoint: "lawService.do",
      target: "lsStmd",
      type,
      extraParams,
      apiKey: args.apiKey,
    });
    const settled = await Promise.allSettled([request("XML"), request("JSON")]);
    const failure = settled.find((r) => r.status === "rejected");
    if (failure) throw failure.reason;
    const [xmlText, jsonText] = settled.map((r) => (r as PromiseFulfilledResult<string>).value);

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

    // 하위 규칙은 법률 직속과 시행령 하위 양쪽에 있다. 기준 법령이 하위법이어도 부모 법률을 유지한다.
    const sections = collectLawHierarchy(hierarchy);
    for (const kind of ["법률", "시행령", "시행규칙"] as const) {
      const entries = sections[kind];
      if (!entries.length) continue;
      output += `${kind} (${entries.length}건):\n`;
      for (const entry of entries.slice(0, 10)) {
        const info = entry.기본정보;
        const type = typeof info?.법종구분 === "string" ? info.법종구분 : info?.법종구분?.content;
        output += `  ├─ ${info?.법령명 || kind} (${type || ""})\n`;
      }
      if (entries.length > 10) output += `  └─ ... 외 ${entries.length - 10}건\n`;
      output += `\n`;
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
    output += renderLawHierarchy(hierarchy, lawName, lawType);

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
