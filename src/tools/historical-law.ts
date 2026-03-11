import { z } from "zod";
import type { LawApiClient } from "../lib/api-client.js";
import { truncateResponse, formatDateDot } from "../lib/schemas.js";

/**
 * 법령 연혁 조회 도구
 * - lsHistory API (HTML만 지원) 사용
 * - LexDiff의 HTML 파싱 로직 이식
 */

export interface LawHistoryEntry {
  mst: string;
  efYd: string;
  ancNo: string;
  ancYd: string;
  lawNm: string;
  rrCls: string;
}

// Search for law revision history
export const searchHistoricalLawSchema = z.object({
  lawName: z.string().describe("법령명 (예: '관세법', '민법', '형법')"),
  display: z.number().min(1).max(100).default(50).describe("결과 개수 (기본값: 50)"),
  apiKey: z.string().optional().describe("API 키"),
});

export type SearchHistoricalLawInput = z.infer<typeof searchHistoricalLawSchema>;

export async function searchHistoricalLaw(
  apiClient: LawApiClient,
  args: SearchHistoricalLawInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const html = await apiClient.fetchApi({
      endpoint: "lawSearch.do",
      target: "lsHistory",
      type: "HTML",
      extraParams: {
        query: args.lawName,
        display: (args.display || 50).toString(),
        sort: "efdes",
      },
      apiKey: args.apiKey,
    });
    const histories = parseHistoryHtml(html, args.lawName);

    if (histories.length === 0) {
      let errorMsg = `'${args.lawName}'의 연혁을 찾을 수 없습니다.`;
      errorMsg += `\n\n💡 법령 연혁 조회 팁:`;
      errorMsg += `\n   - 정확한 법령명 사용: "관세법", "민법"`;
      errorMsg += `\n   - 시행령은 별도 검색: "관세법 시행령"`;
      errorMsg += `\n\n   현행 법령 검색:`;
      errorMsg += `\n   search_law(query="${args.lawName}")`;

      return {
        content: [{
          type: "text",
          text: errorMsg
        }],
        isError: true
      };
    }

    let output = `📜 ${args.lawName} 연혁 (총 ${histories.length}개 버전):\n\n`;

    for (const h of histories) {
      const efDate = formatDateDot(h.efYd);
      const ancDate = formatDateDot(h.ancYd);
      output += `📅 시행: ${efDate}`;
      if (h.rrCls) output += ` | ${h.rrCls}`;
      output += `\n`;
      output += `   공포: ${ancDate}`;
      if (h.ancNo) output += ` (제${h.ancNo}호)`;
      output += `\n`;
      output += `   MST: ${h.mst}\n`;
      output += `\n`;
    }

    output += `\n💡 특정 시점 법령 조회: get_historical_law(mst="${histories[0]?.mst || 'MST번호'}")`;
    output += `\n💡 법제처 연혁 페이지: https://www.law.go.kr/법령/${encodeURIComponent(args.lawName)}`;

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

// Get historical law text at a specific version
export const getHistoricalLawSchema = z.object({
  mst: z.string().describe("법령일련번호 (MST) - search_historical_law에서 획득"),
  jo: z.string().optional().describe("특정 조문 번호 (예: '제38조')"),
  apiKey: z.string().optional().describe("API 키"),
});

export type GetHistoricalLawInput = z.infer<typeof getHistoricalLawSchema>;

export async function getHistoricalLaw(
  apiClient: LawApiClient,
  args: GetHistoricalLawInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const responseText = await apiClient.fetchApi({
      endpoint: "lawService.do",
      target: "law",
      type: "JSON",
      extraParams: { MST: args.mst },
      apiKey: args.apiKey,
    });

    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch (err) {
      throw new Error("Failed to parse JSON response from API");
    }

    if (!data.법령) {
      throw new Error(`MST ${args.mst}에 해당하는 법령을 찾을 수 없습니다.`);
    }

    const law = data.법령;
    const basic = law.기본정보 || law;

    let output = `=== ${basic.법령명한글 || basic.법령명 || "연혁법령"} ===\n\n`;

    output += `📋 기본 정보:\n`;
    output += `  법령명: ${basic.법령명한글 || basic.법령명 || "N/A"}\n`;
    output += `  시행일자: ${basic.시행일자 || "N/A"}\n`;
    output += `  공포일자: ${basic.공포일자 || "N/A"}\n`;
    output += `  공포번호: ${basic.공포번호 || "N/A"}\n`;
    output += `  제개정구분: ${basic.제개정구분명 || basic.제개정구분 || "N/A"}\n`;
    output += `  소관부처: ${basic.소관부처명 || basic.소관부처 || "N/A"}\n\n`;

    // Extract articles
    const articles = law.조문 || [];
    if (Array.isArray(articles) && articles.length > 0) {
      if (args.jo) {
        // Filter to specific article
        const joCode = parseJoNumber(args.jo);
        const article = articles.find((a: any) => {
          const articleJo = a.조문번호 || a.조번호 || "";
          return articleJo === joCode || String(articleJo) === joCode;
        });

        if (article) {
          output += `📄 ${args.jo}:\n`;
          if (article.조문제목) output += `제목: ${article.조문제목}\n`;
          output += `${article.조문내용 || "내용 없음"}\n`;
        } else {
          output += `⚠️ ${args.jo}를 찾을 수 없습니다.\n`;
          output += `\n조문 목록:\n`;
          for (const a of articles.slice(0, 20)) {
            output += `  - 제${a.조문번호 || a.조번호}조 ${a.조문제목 || ""}\n`;
          }
        }
      } else {
        // Show all articles (limited)
        output += `📄 조문 (총 ${articles.length}개):\n\n`;
        for (const article of articles.slice(0, 30)) {
          const joNum = article.조문번호 || article.조번호 || "";
          const title = article.조문제목 || "";
          const content = article.조문내용 || "";

          output += `제${joNum}조`;
          if (title) output += ` (${title})`;
          output += `\n`;
          if (content) {
            output += `${content.substring(0, 500)}`;
            if (content.length > 500) output += "...";
            output += `\n`;
          }
          output += `\n`;
        }
        if (articles.length > 30) {
          output += `\n... 외 ${articles.length - 30}개 조문\n`;
        }
      }
    }

    output += `\n💡 현행 법령 조회: get_law_text(lawName="...")`;

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

/**
 * HTML 파싱 함수 - LexDiff에서 이식
 * lsHistory API는 HTML만 반환하므로 정규식으로 파싱
 */
function parseHistoryHtml(html: string, targetLawName: string): LawHistoryEntry[] {
  const histories: LawHistoryEntry[] = [];

  // 테이블 행에서 연혁 정보 추출
  const rowPattern = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
  const rows = html.match(rowPattern) || [];

  for (const row of rows) {
    // MST와 efYd 추출
    const linkMatch = row.match(/MST=(\d+)[^"]*efYd=(\d*)/);
    if (!linkMatch) continue;

    const mst = linkMatch[1];
    const efYd = linkMatch[2] || '';

    // 법령명 추출 (링크 텍스트)
    const lawNmMatch = row.match(/<a[^>]+>([^<]+)<\/a>/);
    const lawNm = lawNmMatch?.[1]?.trim() || '';

    if (!lawNm) continue;

    // 정확한 법령명 매칭 (시행령/시행규칙 제외)
    const normalizedTarget = targetLawName.replace(/\s/g, '');
    const normalizedLaw = lawNm.replace(/\s/g, '');

    // 시행령/시행규칙 필터링
    const targetHasDecree = targetLawName.includes('시행령') || targetLawName.includes('시행규칙');
    const lawHasDecree = lawNm.includes('시행령') || lawNm.includes('시행규칙');

    if (!targetHasDecree && lawHasDecree) {
      continue;
    }

    // 정확히 일치하는지 확인
    const isExactMatch = normalizedLaw === normalizedTarget;
    if (!isExactMatch) continue;

    // 공포번호 추출 (제 XXXXX호)
    const ancNoMatch = row.match(/제\s*(\d+)\s*호/);
    const ancNo = ancNoMatch?.[1] || '';

    // 공포일자 추출
    const dateCells = row.match(/<td[^>]*>(\d{4}[.\-]?\d{2}[.\-]?\d{2})<\/td>/g) || [];
    let ancYd = '';
    if (dateCells.length >= 1 && dateCells[0]) {
      const dateMatch = dateCells[0].match(/(\d{4})[.\-]?(\d{2})[.\-]?(\d{2})/);
      if (dateMatch) {
        ancYd = `${dateMatch[1]}${dateMatch[2]}${dateMatch[3]}`;
      }
    }

    // 제개정구분 추출
    const rrClsMatch = row.match(/(제정|일부개정|전부개정|폐지|타법개정|타법폐지|일괄개정|일괄폐지)/);
    const rrCls = rrClsMatch?.[1] || '';

    histories.push({ mst, efYd, ancNo, ancYd, lawNm, rrCls });
  }

  // 시행일자 내림차순 정렬
  histories.sort((a, b) => {
    const aDate = parseInt(a.efYd || '0', 10);
    const bDate = parseInt(b.efYd || '0', 10);
    return bDate - aDate;
  });

  return histories;
}

// formatDate → schemas.ts의 formatDateDot 사용

function parseJoNumber(joText: string): string {
  const match = joText.match(/제?(\d+)조?(의\d+)?/);
  if (match) {
    return match[1] + (match[2] || "");
  }
  return joText.replace(/[^0-9의]/g, "");
}
