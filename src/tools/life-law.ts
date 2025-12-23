import { z } from "zod";

// Life law search tool - Search for everyday legal guides
export const searchLifeLawSchema = z.object({
  query: z.string().describe("검색할 생활법령 주제 (예: '창업', '부동산', '교통사고', '이혼')"),
  display: z.number().min(1).max(100).default(20).describe("페이지당 결과 개수 (기본값: 20, 최대: 100)"),
  page: z.number().min(1).default(1).describe("페이지 번호 (기본값: 1)"),
  apiKey: z.string().optional().describe("API 키"),
});

export type SearchLifeLawInput = z.infer<typeof searchLifeLawSchema>;

export async function searchLifeLaw(
  apiClient: any,
  args: SearchLifeLawInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const apiKey = args.apiKey || process.env.LAW_OC;
    if (!apiKey) {
      throw new Error("API 키가 필요합니다. api_key 파라미터를 전달하거나 LAW_OC 환경변수를 설정하세요.");
    }

    const params = new URLSearchParams({
      OC: apiKey,
      target: "lifeLaw",
      type: "XML",
      query: args.query,
      display: (args.display || 20).toString(),
      page: (args.page || 1).toString(),
    });

    const url = `https://www.law.go.kr/DRF/lawSearch.do?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const xmlText = await response.text();
    const result = parseLifeLawXML(xmlText);

    if (!result.LifeLawSearch) {
      throw new Error("Invalid response format from API");
    }

    const data = result.LifeLawSearch;
    const totalCount = parseInt(data.totalCnt || "0");
    const currentPage = parseInt(data.page || "1");
    const guides = data.lifeLaw ? (Array.isArray(data.lifeLaw) ? data.lifeLaw : [data.lifeLaw]) : [];

    if (totalCount === 0) {
      let errorMsg = "검색 결과가 없습니다.";
      errorMsg += `\n\n💡 주요 생활법령 분야:`;
      errorMsg += `\n   - 창업/사업: "창업", "개인사업자", "법인설립"`;
      errorMsg += `\n   - 부동산: "아파트", "전월세", "부동산매매"`;
      errorMsg += `\n   - 가정: "이혼", "상속", "입양"`;
      errorMsg += `\n   - 교통: "교통사고", "자동차", "운전면허"`;
      errorMsg += `\n   - 노동: "근로계약", "해고", "퇴직금"`;
      errorMsg += `\n\n   일반 법령 검색:`;
      errorMsg += `\n   search_law(query="${args.query}")`;

      return {
        content: [{
          type: "text",
          text: errorMsg
        }],
        isError: true
      };
    }

    let output = `생활법령 검색 결과 (총 ${totalCount}건, ${currentPage}페이지):\n\n`;

    for (const guide of guides) {
      output += `📚 [${guide.생활법령ID}] ${guide.생활법령명}\n`;
      if (guide.분야) {
        output += `   분야: ${guide.분야}\n`;
      }
      if (guide.요약) {
        output += `   요약: ${guide.요약.substring(0, 100)}${guide.요약.length > 100 ? '...' : ''}\n`;
      }
      if (guide.상세링크) {
        output += `   링크: ${guide.상세링크}\n`;
      }
      output += `\n`;
    }

    output += `\n💡 상세 내용을 조회하려면 get_life_law_guide(id="생활법령ID")를 사용하세요.`;
    output += `\n💡 법제처 생활법령정보: https://easylaw.go.kr`;

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

// Life law guide retrieval tool
export const getLifeLawGuideSchema = z.object({
  id: z.string().describe("생활법령ID (검색 결과에서 획득)"),
  apiKey: z.string().optional().describe("API 키"),
});

export type GetLifeLawGuideInput = z.infer<typeof getLifeLawGuideSchema>;

export async function getLifeLawGuide(
  apiClient: any,
  args: GetLifeLawGuideInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const apiKey = args.apiKey || process.env.LAW_OC;
    if (!apiKey) {
      throw new Error("API 키가 필요합니다. api_key 파라미터를 전달하거나 LAW_OC 환경변수를 설정하세요.");
    }

    const params = new URLSearchParams({
      OC: apiKey,
      target: "lifeLaw",
      type: "JSON",
      ID: args.id,
    });

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

    if (!data.LifeLawService) {
      throw new Error("생활법령 가이드를 찾을 수 없거나 응답 형식이 올바르지 않습니다.");
    }

    const guide = data.LifeLawService;

    let output = `=== ${guide.생활법령명 || "생활법령 가이드"} ===\n\n`;

    if (guide.분야) {
      output += `📂 분야: ${guide.분야}\n\n`;
    }

    if (guide.목차 || guide.내용목록) {
      output += `📋 목차:\n`;
      const toc = guide.목차 || guide.내용목록;
      if (Array.isArray(toc)) {
        for (const item of toc) {
          output += `  - ${typeof item === 'string' ? item : item.제목 || item.항목명}\n`;
        }
      } else {
        output += `  ${toc}\n`;
      }
      output += `\n`;
    }

    if (guide.핵심내용 || guide.요약) {
      output += `📌 핵심내용:\n${guide.핵심내용 || guide.요약}\n\n`;
    }

    if (guide.관련법령) {
      output += `📖 관련법령:\n`;
      const laws = guide.관련법령;
      if (Array.isArray(laws)) {
        for (const law of laws) {
          output += `  - ${typeof law === 'string' ? law : law.법령명}\n`;
        }
      } else {
        output += `  ${laws}\n`;
      }
      output += `\n`;
    }

    if (guide.관련서식) {
      output += `📝 관련서식:\n${guide.관련서식}\n\n`;
    }

    if (guide.QA || guide.FAQ) {
      output += `❓ 자주 묻는 질문:\n`;
      const qa = guide.QA || guide.FAQ;
      if (Array.isArray(qa)) {
        for (const item of qa.slice(0, 5)) {
          output += `  Q: ${item.질문 || item.Q}\n`;
          output += `  A: ${item.답변 || item.A}\n\n`;
        }
      } else {
        output += `  ${qa}\n`;
      }
    }

    output += `\n💡 더 자세한 내용: https://easylaw.go.kr`;

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

// XML parser for life law search
function parseLifeLawXML(xml: string): any {
  const obj: any = {};

  // Try different root element patterns
  const searchMatch = xml.match(/<LifeLawSearch[^>]*>([\s\S]*?)<\/LifeLawSearch>/) ||
                      xml.match(/<lifeLawSearch[^>]*>([\s\S]*?)<\/lifeLawSearch>/) ||
                      xml.match(/<LawSearch[^>]*>([\s\S]*?)<\/LawSearch>/);
  if (!searchMatch) return obj;

  const content = searchMatch[1];
  obj.LifeLawSearch = {};

  const totalCntMatch = content.match(/<totalCnt>([^<]*)<\/totalCnt>/);
  const pageMatch = content.match(/<page>([^<]*)<\/page>/);

  obj.LifeLawSearch.totalCnt = totalCntMatch ? totalCntMatch[1] : "0";
  obj.LifeLawSearch.page = pageMatch ? pageMatch[1] : "1";

  // Extract lifeLaw items
  const itemMatches = content.matchAll(/<lifeLaw[^>]*>([\s\S]*?)<\/lifeLaw>/gi) ||
                      content.matchAll(/<law[^>]*>([\s\S]*?)<\/law>/gi);
  obj.LifeLawSearch.lifeLaw = [];

  for (const match of itemMatches) {
    const itemContent = match[1];
    const item: any = {};

    const extractTag = (tag: string) => {
      const cdataRegex = new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\/${tag}>`, 'i');
      const cdataMatch = itemContent.match(cdataRegex);
      if (cdataMatch) return cdataMatch[1];

      const regex = new RegExp(`<${tag}>([^<]*)<\/${tag}>`, 'i');
      const match = itemContent.match(regex);
      return match ? match[1] : "";
    };

    item.생활법령ID = extractTag("생활법령ID") || extractTag("ID") || extractTag("법령ID");
    item.생활법령명 = extractTag("생활법령명") || extractTag("법령명");
    item.분야 = extractTag("분야") || extractTag("카테고리");
    item.요약 = extractTag("요약") || extractTag("설명");
    item.상세링크 = extractTag("상세링크") || extractTag("링크");

    obj.LifeLawSearch.lifeLaw.push(item);
  }

  return obj;
}
