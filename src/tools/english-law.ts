import { z } from "zod";
import type { LawApiClient } from "../lib/api-client.js";
import { truncateResponse } from "../lib/schemas.js";
import { parseSearchXML, extractTag, stripHtml } from "../lib/xml-parser.js";
import { formatToolError, noResultHint } from "../lib/errors.js";

// English law search tool - Search for English translations of Korean laws
export const searchEnglishLawSchema = z.object({
  query: z.string().optional().describe("법령명 검색어 (영문 또는 한글, 예: 'Customs Act', '관세법')"),
  display: z.number().min(1).max(100).default(20).describe("페이지당 결과 개수 (기본값: 20, 최대: 100)"),
  page: z.number().min(1).default(1).describe("페이지 번호 (기본값: 1)"),
  sort: z.enum(["lasc", "ldes", "dasc", "ddes"]).optional()
    .describe("정렬 옵션: lasc/ldes (법령명순), dasc/ddes (날짜순)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
});

export type SearchEnglishLawInput = z.infer<typeof searchEnglishLawSchema>;

export async function searchEnglishLaw(
  apiClient: LawApiClient,
  args: SearchEnglishLawInput
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
      target: "elaw",
      extraParams,
      apiKey: args.apiKey,
    });
    // parseSearchXML 사용 (rootTag: "" = 전체 XML, itemTag: law)
    // 영문법령 API는 루트 태그가 일정하지 않아 전체 XML에서 추출
    const { totalCnt, page: currentPage, items: allLaws } = parseSearchXML(
      xmlText, "", "law",
      (content) => ({
        법령ID: extractTag(content, "법령ID"),
        영문법령명: extractTag(content, "법령명영문"),
        한글법령명: stripHtml(extractTag(content, "법령명한글")),
        시행일자: extractTag(content, "시행일자"),
        법령구분: extractTag(content, "법령구분명"),
        법령상세링크: extractTag(content, "법령상세링크"),
      })
    );

    const totalCount = totalCnt;
    // 유효한 항목만 필터링 (기존 동작 유지)
    const laws = allLaws.filter(item => item.법령ID || item.영문법령명);

    if (totalCount === 0) {
      return noResultHint(args.query || "", "영문법령")
    }

    let output = `영문법령 검색 결과 (총 ${totalCount}건, ${currentPage}페이지):\n\n`;

    for (const law of laws) {
      output += `[${law.법령ID}] ${law.영문법령명}\n`;
      output += `  한글명: ${law.한글법령명 || "N/A"}\n`;
      output += `  시행일자: ${law.시행일자 || "N/A"}\n`;
      output += `  법령구분: ${law.법령구분 || "N/A"}\n`;
      if (law.법령상세링크) {
        output += `  링크: ${law.법령상세링크}\n`;
      }
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
    return formatToolError(error, "search_english_law");
  }
}

// English law text retrieval tool
export const getEnglishLawTextSchema = z.object({
  lawId: z.string().optional().describe("법령ID (검색 결과에서 획득)"),
  mst: z.string().optional().describe("법령일련번호 (MST)"),
  lawName: z.string().optional().describe("법령명 (영문 또는 한글)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
});

export type GetEnglishLawTextInput = z.infer<typeof getEnglishLawTextSchema>;

export async function getEnglishLawText(
  apiClient: LawApiClient,
  args: GetEnglishLawTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    if (!args.lawId && !args.mst && !args.lawName) {
      throw new Error("lawId, mst, 또는 lawName 중 하나가 필요합니다.");
    }

    const extraParams: Record<string, string> = {};
    if (args.lawId) extraParams.ID = String(args.lawId);
    if (args.mst) extraParams.MST = String(args.mst);
    if (args.lawName) extraParams.LM = String(args.lawName);

    const responseText = await apiClient.fetchApi({
      endpoint: "lawService.do",
      target: "elaw",
      type: "JSON",
      extraParams,
      apiKey: args.apiKey,
    });

    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch (err) {
      throw new Error("Failed to parse JSON response from API");
    }

    // API 응답 형식: ElawService (구형) 또는 Law (신형)
    const law = data.ElawService || data.Law;
    if (!law) {
      throw new Error("영문법령을 찾을 수 없거나 응답 형식이 올바르지 않습니다.");
    }

    // 신형 API: Law.InfSection에 기본정보, Law.JoSection.Jo[]에 조문
    const inf = law.InfSection || {};
    const basic = {
      영문법령명: law.영문법령명 || law.법령명_영문 || inf.lsNmEng,
      한글법령명: law.한글법령명 || law.법령명_한글 || inf.lsNmKor,
      시행일자: law.시행일자 || inf.ancYd,
      공포일자: law.공포일자 || inf.ancYd,
      법령구분: law.법령구분,
      소관부처: law.소관부처,
    };

    let output = `=== ${basic.영문법령명 || "English Law"} ===\n`;
    output += `(${basic.한글법령명 || "N/A"})\n\n`;

    output += `Basic Information:\n`;
    output += `  English Name: ${basic.영문법령명 || "N/A"}\n`;
    output += `  Korean Name: ${basic.한글법령명 || "N/A"}\n`;
    output += `  Effective Date: ${basic.시행일자 || "N/A"}\n`;
    output += `  Promulgation Date: ${basic.공포일자 || "N/A"}\n`;
    output += `  Law Type: ${basic.법령구분 || "N/A"}\n`;
    output += `  Competent Ministry: ${basic.소관부처 || "N/A"}\n\n`;

    // 조문 추출: ElawService 형식 또는 Law.JoSection.Jo[] 형식
    const joSection = law.JoSection?.Jo;
    const articles = law.조문 || law.조문목록 || (joSection ? (Array.isArray(joSection) ? joSection : [joSection]) : []);
    if (Array.isArray(articles) && articles.length > 0) {
      output += `Articles:\n\n`;
      for (const article of articles.slice(0, 50)) {
        const articleNo = article.조문번호 || article.조번호 || article.joNo || "";
        const articleTitle = article.조문제목_영문 || article.조문제목 || "";
        const articleContent = article.조문내용_영문 || article.조문내용 || article.joCts || "";

        if (articleNo || articleTitle) {
          output += `Article ${articleNo}`;
          if (articleTitle) output += ` ${articleTitle}`;
          output += `\n`;
        }
        if (articleContent) {
          output += `${articleContent}\n\n`;
        }
      }
      if (articles.length > 50) {
        output += `\n... and ${articles.length - 50} more articles\n`;
      }
    } else if (law.법령내용_영문 || law.법령내용) {
      output += `Content:\n${law.법령내용_영문 || law.법령내용}\n`;
    }

    return {
      content: [{
        type: "text",
        text: truncateResponse(output)
      }]
    };
  } catch (error) {
    return formatToolError(error, "get_english_law_text");
  }
}

