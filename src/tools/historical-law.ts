import { z } from "zod";
import type { LawApiClient } from "../lib/api-client.js";
import { truncateResponse, formatDateDot } from "../lib/schemas.js";
import { formatToolError } from "../lib/errors.js";
import { flattenContent, formatArticleUnit } from "../lib/article-parser.js";
import { fetchHistoricalVersionsFull } from "../lib/historical-utils.js";

/** JSON 필드 안전 문자열화 — 객체/배열이 와도 "[object Object]"를 만들지 않는다 */
function safeText(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  if (Array.isArray(v)) return flattenContent(v);
  if (typeof v === "object") {
    // 법제처 JSON은 {content: "..."} 꼴 래핑이 흔함 (소관부처 등)
    const c = (v as Record<string, unknown>).content;
    return typeof c === "string" ? c : flattenContent(v as never) || "";
  }
  return String(v);
}

/** 조문 표시명 — 가지번호가 있으면 "제5조의2" */
function joLabel(a: any): string {
  const branch = String(a?.조문가지번호 || "0");
  const num = safeText(a?.조문번호 || a?.조번호);
  return branch !== "0" ? `제${num}조의${branch}` : `제${num}조`;
}

/**
 * 법령 연혁 조회 도구
 * - lsHistory API (HTML만 지원) 사용
 * - 행 파싱은 lib/historical-utils 단일 원본 (applicable_law·time_travel과 공용)
 */

/** lsHistory 한 페이지 원시 행 수 (applicable_law·time_travel이 쓰는 기본값과 같다) */
const HISTORY_PAGE_SIZE = 500;

// Search for law revision history
export const searchHistoricalLawSchema = z.object({
  lawName: z.string().describe("법령명 (예: '관세법', '민법', '형법')"),
  display: z.number().min(1).max(100).default(50).describe("결과 개수 (기본값: 50)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
});

export type SearchHistoricalLawInput = z.infer<typeof searchHistoricalLawSchema>;

export async function searchHistoricalLaw(
  apiClient: LawApiClient,
  args: SearchHistoricalLawInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    // 연혁 행 파싱을 historical-utils 단일 원본으로 돌린다. 로컬 사본은 무패딩 날짜("1961.12.8")를 못 읽어
    // 공포일이 비고, "폐지제정"을 "폐지"로 오표시했다 (2026-09-23 리뷰 B12, 실측 지방세법 제827호).
    // 원본은 원시 총계까지 페이지를 이어 받으므로(500행 단위) 동명 법령의 전체 버전 수를 알 수 있다.
    // display는 종전처럼 원시 행 수가 아니라 표시할 버전 수 상한으로 쓴다.
    const { versions, totalCount, fetchedPages } = await fetchHistoricalVersionsFull(apiClient, args.lawName, args.apiKey, HISTORY_PAGE_SIZE);
    const displayCap = args.display || 50;
    const histories = versions.slice(0, displayCap);

    if (histories.length === 0) {
      let errorMsg = `[NOT_FOUND] '${args.lawName}'의 연혁을 찾을 수 없습니다.\n⚠️ LLM은 연혁을 추측/생성하지 마세요. 법령명을 정확히 확인하거나 search_law로 먼저 검색하세요.`;

      return {
        content: [{
          type: "text",
          text: errorMsg
        }],
        isError: true
      };
    }

    // 전 페이지를 받았으면 전체 버전 수를 안다. 안전 상한(20페이지)에 걸려 못 받은 원시 행이 남은 경우만 미완으로 적는다.
    const incomplete = totalCount > 0 && fetchedPages * HISTORY_PAGE_SIZE < totalCount;
    let capNote = versions.length > displayCap ? `, 전체 ${versions.length}개 중 최근 ${displayCap}개 표시` : "";
    if (incomplete) capNote += `. 법제처 연혁 ${totalCount}행 중 일부만 수집해 이전 연혁이 더 있을 수 있음`;
    let output = `${args.lawName} 연혁 (조회된 ${histories.length}개 버전${capNote}):\n\n`;

    for (const h of histories) {
      const efDate = formatDateDot(h.efYd);
      const ancDate = formatDateDot(h.ancYd);
      output += `시행: ${efDate}`;
      if (h.rrCls) output += ` | ${h.rrCls}`;
      output += `\n`;
      output += `   공포: ${ancDate}`;
      if (h.ancNo) output += ` (제${h.ancNo}호)`;
      output += `\n`;
      output += `   MST: ${h.mst}\n`;
      output += `\n`;
    }

    // 후속 도구 안내 제거 (LLM이 이미 도구 목록을 알고 있음)

    return {
      content: [{
        type: "text",
        text: truncateResponse(output)
      }]
    };
  } catch (error) {
    return formatToolError(error, "search_historical_law");
  }
}

// Get historical law text at a specific version
export const getHistoricalLawSchema = z.object({
  mst: z.string().describe("법령일련번호 (MST) - search_historical_law에서 획득"),
  jo: z.string().optional().describe("특정 조문 번호 (예: '제38조')"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
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

    // eflaw JSON은 법령명을 "법령명_한글" 키로 주는 경우가 있고(article-detail과 동일),
    // 소관부처는 {content: "..."} 객체로 온다 — 그대로 보간하면 "[object Object]"가 노출됐다.
    const lawTitle = safeText(basic.법령명_한글 || basic.법령명한글 || basic.법령명) || "연혁법령";
    let output = `=== ${lawTitle} ===\n\n`;

    output += `기본 정보:\n`;
    output += `  법령명: ${lawTitle}\n`;
    output += `  시행일자: ${safeText(basic.시행일자) || "N/A"}\n`;
    output += `  공포일자: ${safeText(basic.공포일자) || "N/A"}\n`;
    output += `  공포번호: ${safeText(basic.공포번호) || "N/A"}\n`;
    output += `  제개정구분: ${safeText(basic.제개정구분명 || basic.제개정구분) || "N/A"}\n`;
    output += `  소관부처: ${safeText(basic.소관부처명 || basic.소관부처) || "N/A"}\n\n`;

    // Extract articles
    // 페이로드는 법령.조문.조문단위[]로 한 겹 감싼 구조다 (verify-citations·applicable-law가
    // 읽는 형태와 동일). law.조문을 조문 객체의 배열로 읽으면 래퍼 하나만 잡혀 길이 1이 되고
    // 조문번호가 undefined로 나온다 — "제undefined조" 한 줄이 조문 목록 전부였다 (#153 곁가지 2).
    const rawArticles = law.조문?.조문단위 ?? law.조문;
    const units = rawArticles == null ? [] : Array.isArray(rawArticles) ? rawArticles : [rawArticles];
    // 조문단위에는 장·절 헤더가 조문여부="전문"으로 섞여 온다 (실측 아동복지법 MST 285697:
    // 123개 중 12개). 조문으로 세면 개수와 목록이 함께 오염된다.
    const articles = units.filter((a: any) => a?.조문여부 === "조문");
    if (articles.length > 0) {
      if (args.jo) {
        // Filter to specific article
        // parseJoNumber는 "75"/"75의2" 꼴을 돌려주고, 페이로드는 조문번호와 조문가지번호로
        // 나눠 온다 — 합쳐진 문자열끼리 비교하면 가지번호 조문이 늘 NOT_FOUND가 된다.
        const [wantNum, wantBranch = "0"] = parseJoNumber(args.jo).split("의");
        const article = articles.find((a: any) => {
          const num = String(a.조문번호 ?? a.조번호 ?? "");
          const branch = String(a.조문가지번호 || "0");
          return num === wantNum && branch === wantBranch;
        });

        if (article) {
          // 조문내용에는 "제75조(과태료)" 제목줄만 들어 있고 본문은 항·호·목에 있다.
          // formatArticleUnit이 그 결합의 단일 원본이다 (law-text·article-detail 공통).
          const formatted = formatArticleUnit(article);
          output += `${args.jo}:\n`;
          if (article.조문제목) output += `제목: ${safeText(article.조문제목)}\n`;
          output += `${formatted?.body || "내용 없음"}\n`;
        } else {
          output += `[NOT_FOUND] ${args.jo}를 찾을 수 없습니다.\n⚠️ LLM은 조문을 추측/생성하지 마세요.\n`;
          output += `\n조문 목록:\n`;
          for (const a of articles.slice(0, 20)) {
            output += `  - ${joLabel(a)} ${safeText(a.조문제목)}\n`;
          }
        }
      } else {
        // Show all articles (limited)
        output += `조문 (총 ${articles.length}개):\n\n`;
        for (const article of articles.slice(0, 30)) {
          const formatted = formatArticleUnit(article);
          const title = safeText(article.조문제목);
          const content = formatted?.body || "";

          output += joLabel(article);
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

    // 후속 도구 안내 제거 (LLM이 이미 도구 목록을 알고 있음)

    return {
      content: [{
        type: "text",
        text: truncateResponse(output)
      }]
    };
  } catch (error) {
    return formatToolError(error, "get_historical_law");
  }
}

// formatDate → schemas.ts의 formatDateDot 사용

function parseJoNumber(joText: string): string {
  const match = joText.match(/제?(\d+)조?(의\d+)?/);
  if (match) {
    return match[1] + (match[2] || "");
  }
  return joText.replace(/[^0-9의]/g, "");
}
