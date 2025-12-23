import { z } from "zod";

// Constitutional Court decision search tool - Search for Constitutional Court rulings
export const searchConstitutionalDecisionsSchema = z.object({
  query: z.string().optional().describe("검색 키워드 (예: '위헌', '기본권', '재산권')"),
  caseNumber: z.string().optional().describe("사건번호 (예: '2020헌바123')"),
  display: z.number().min(1).max(100).default(20).describe("페이지당 결과 개수 (기본값: 20, 최대: 100)"),
  page: z.number().min(1).default(1).describe("페이지 번호 (기본값: 1)"),
  sort: z.enum(["lasc", "ldes", "dasc", "ddes", "nasc", "ndes"]).optional()
    .describe("정렬 옵션: lasc/ldes (법령명순), dasc/ddes (날짜순), nasc/ndes (사건번호순)"),
  apiKey: z.string().optional().describe("API 키"),
});

export type SearchConstitutionalDecisionsInput = z.infer<typeof searchConstitutionalDecisionsSchema>;

export async function searchConstitutionalDecisions(
  apiClient: any,
  args: SearchConstitutionalDecisionsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const apiKey = args.apiKey || process.env.LAW_OC;
    if (!apiKey) {
      throw new Error("API 키가 필요합니다. api_key 파라미터를 전달하거나 LAW_OC 환경변수를 설정하세요.");
    }

    const params = new URLSearchParams({
      OC: apiKey,
      target: "ccJudg",
      type: "XML",
      display: (args.display || 20).toString(),
      page: (args.page || 1).toString(),
    });

    if (args.query) params.append("query", args.query);
    if (args.caseNumber) params.append("nb", args.caseNumber);
    if (args.sort) params.append("sort", args.sort);

    const url = `https://www.law.go.kr/DRF/lawSearch.do?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const xmlText = await response.text();
    const result = parseConstitutionalXML(xmlText);

    if (!result.CcJudgSearch) {
      throw new Error("Invalid response format from API");
    }

    const data = result.CcJudgSearch;
    const totalCount = parseInt(data.totalCnt || "0");
    const currentPage = parseInt(data.page || "1");
    const decisions = data.ccJudg ? (Array.isArray(data.ccJudg) ? data.ccJudg : [data.ccJudg]) : [];

    if (totalCount === 0) {
      let errorMsg = "검색 결과가 없습니다.";
      errorMsg += `\n\n💡 개선 방법:`;
      errorMsg += `\n   1. 단순 키워드 사용:`;
      if (args.query) {
        const words = args.query.split(/\s+/);
        if (words.length > 1) {
          errorMsg += `\n      search_constitutional_decisions(query="${words[0]}")`;
        }
      }
      errorMsg += `\n\n   2. 일반 판례 검색:`;
      errorMsg += `\n      search_precedents(query="${args.query || '관련 키워드'}")`;
      errorMsg += `\n\n   3. 법령해석례 검색:`;
      errorMsg += `\n      search_interpretations(query="${args.query || '관련 키워드'}")`;

      return {
        content: [{
          type: "text",
          text: errorMsg
        }],
        isError: true
      };
    }

    let output = `헌재결정례 검색 결과 (총 ${totalCount}건, ${currentPage}페이지):\n\n`;

    for (const decision of decisions) {
      output += `[${decision.헌재결정일련번호}] ${decision.사건명}\n`;
      output += `  사건번호: ${decision.사건번호 || "N/A"}\n`;
      output += `  선고일: ${decision.선고일자 || "N/A"}\n`;
      output += `  결정유형: ${decision.결정유형 || "N/A"}\n`;
      output += `  사건종류: ${decision.사건종류명 || "N/A"}\n`;
      if (decision.판례상세링크) {
        output += `  링크: ${decision.판례상세링크}\n`;
      }
      output += `\n`;
    }

    output += `\n💡 전문을 조회하려면 get_constitutional_decision_text(id="헌재결정일련번호")를 사용하세요.`;

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

// Constitutional Court decision text retrieval tool
export const getConstitutionalDecisionTextSchema = z.object({
  id: z.string().describe("헌재결정일련번호 (검색 결과에서 획득)"),
  caseName: z.string().optional().describe("사건명 (선택사항, 검증용)"),
  apiKey: z.string().optional().describe("API 키"),
});

export type GetConstitutionalDecisionTextInput = z.infer<typeof getConstitutionalDecisionTextSchema>;

export async function getConstitutionalDecisionText(
  apiClient: any,
  args: GetConstitutionalDecisionTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const apiKey = args.apiKey || process.env.LAW_OC;
    if (!apiKey) {
      throw new Error("API 키가 필요합니다. api_key 파라미터를 전달하거나 LAW_OC 환경변수를 설정하세요.");
    }

    const params = new URLSearchParams({
      OC: apiKey,
      target: "ccJudg",
      type: "JSON",
      ID: args.id,
    });

    if (args.caseName) {
      params.append("LM", args.caseName);
    }

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

    if (!data.CcJudgService) {
      throw new Error("헌재결정례를 찾을 수 없거나 응답 형식이 올바르지 않습니다.");
    }

    const decision = data.CcJudgService;
    const basic = {
      사건명: decision.사건명,
      사건번호: decision.사건번호,
      선고일자: decision.선고일자,
      사건종류명: decision.사건종류명,
      결정유형: decision.결정유형,
      청구인: decision.청구인,
      피청구인: decision.피청구인,
    };
    const content = {
      판시사항: decision.판시사항,
      결정요지: decision.결정요지 || decision.판결요지,
      참조조문: decision.참조조문,
      참조판례: decision.참조판례,
      전문: decision.판례내용 || decision.결정내용,
    };

    let output = `=== ${basic.사건명 || "헌재결정례"} ===\n\n`;

    output += `📋 기본 정보:\n`;
    output += `  사건번호: ${basic.사건번호 || "N/A"}\n`;
    output += `  선고일자: ${basic.선고일자 || "N/A"}\n`;
    output += `  사건종류: ${basic.사건종류명 || "N/A"}\n`;
    output += `  결정유형: ${basic.결정유형 || "N/A"}\n`;
    if (basic.청구인) output += `  청구인: ${basic.청구인}\n`;
    if (basic.피청구인) output += `  피청구인: ${basic.피청구인}\n`;
    output += `\n`;

    if (content.판시사항) {
      output += `📌 판시사항:\n${content.판시사항}\n\n`;
    }

    if (content.결정요지) {
      output += `📝 결정요지:\n${content.결정요지}\n\n`;
    }

    if (content.참조조문) {
      output += `📖 참조조문:\n${content.참조조문}\n\n`;
    }

    if (content.참조판례) {
      output += `⚖️ 참조판례:\n${content.참조판례}\n\n`;
    }

    if (content.전문) {
      output += `📄 전문:\n${content.전문}\n`;
    }

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

// XML parser for Constitutional Court decisions
function parseConstitutionalXML(xml: string): any {
  const obj: any = {};

  // Try different root element patterns
  const searchMatch = xml.match(/<CcJudgSearch[^>]*>([\s\S]*?)<\/CcJudgSearch>/) ||
                      xml.match(/<ccJudgSearch[^>]*>([\s\S]*?)<\/ccJudgSearch>/);
  if (!searchMatch) return obj;

  const content = searchMatch[1];
  obj.CcJudgSearch = {};

  const totalCntMatch = content.match(/<totalCnt>([^<]*)<\/totalCnt>/);
  const pageMatch = content.match(/<page>([^<]*)<\/page>/);

  obj.CcJudgSearch.totalCnt = totalCntMatch ? totalCntMatch[1] : "0";
  obj.CcJudgSearch.page = pageMatch ? pageMatch[1] : "1";

  // Extract ccJudg items
  const itemMatches = content.matchAll(/<ccJudg[^>]*>([\s\S]*?)<\/ccJudg>/gi);
  obj.CcJudgSearch.ccJudg = [];

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

    item.헌재결정일련번호 = extractTag("헌재결정일련번호") || extractTag("판례일련번호");
    item.사건명 = extractTag("사건명");
    item.사건번호 = extractTag("사건번호");
    item.선고일자 = extractTag("선고일자");
    item.결정유형 = extractTag("결정유형") || extractTag("판결유형");
    item.사건종류명 = extractTag("사건종류명");
    item.판례상세링크 = extractTag("판례상세링크");

    obj.CcJudgSearch.ccJudg.push(item);
  }

  return obj;
}
