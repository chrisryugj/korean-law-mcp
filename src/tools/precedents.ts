import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { cleanHtml } from "../lib/article-parser.js"
import { parsePrecedentXML } from "../lib/xml-parser.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"
import { fetchWithRetry } from "../lib/fetch-with-retry.js"
import {
  compactBody,
  densifyLawRefs,
  densifyPrecedentRefs,
  stripRepeatedSummary,
} from "../lib/decision-compact.js"

export const searchPrecedentsSchema = z.object({
  query: z.string().optional().describe("검색 키워드 (예: '자동차', '담보권')"),
  search: z.number().int().min(1).max(2).optional()
    .describe("검색범위: 1=판례명 검색(기본), 2=본문검색"),
  court: z.string().optional().describe("법원명 필터 (예: '대법원', '서울고등법원')"),
  caseNumber: z.string().optional().describe("사건번호 (예: '2009느합133')"),
  display: z.number().min(1).max(100).default(20).describe("결과 수 (기본:20, 최대:100)"),
  page: z.number().min(1).default(1).describe("페이지 번호 (기본:1)"),
  sort: z.enum(["lasc", "ldes", "dasc", "ddes", "nasc", "ndes"]).optional()
    .describe("정렬: lasc/ldes(법령명), dasc/ddes(날짜), nasc/ndes(사건번호)"),
  fromDate: z.string().optional().describe("선고일 시작 (YYYYMMDD)"),
  toDate: z.string().optional().describe("선고일 종료 (YYYYMMDD)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
});

export type SearchPrecedentsInput = z.infer<typeof searchPrecedentsSchema>;

export async function searchPrecedents(
  apiClient: LawApiClient,
  args: SearchPrecedentsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const extraParams: Record<string, string> = {
      display: (args.display || 20).toString(),
      page: (args.page || 1).toString(),
    };
    if (args.query) extraParams.query = args.query;
    if (args.search) extraParams.search = args.search.toString();
    if (args.court) extraParams.curt = args.court;
    if (args.caseNumber) extraParams.nb = args.caseNumber;
    if (args.sort) extraParams.sort = args.sort;

    const xmlText = await apiClient.fetchApi({
      endpoint: "lawSearch.do",
      target: "prec",
      extraParams,
      apiKey: args.apiKey,
    });

  // 공통 파서 사용
  const result = parsePrecedentXML(xmlText);
  const currentPage = result.page;
  let precs = result.items;

  // 날짜 범위 필터링 (클라이언트 사이드)
  if (args.fromDate || args.toDate) {
    precs = precs.filter(p => {
      const d = (p.선고일자 || "").replace(/[.\-\s]/g, "")
      if (!d) return true
      if (args.fromDate && d < args.fromDate) return false
      if (args.toDate && d > args.toDate) return false
      return true
    })
  }
  const totalCount = (args.fromDate || args.toDate) ? precs.length : result.totalCnt;

  if (totalCount === 0) {
    const kw = args.query || "관련 키워드"
    const keywords = kw.trim().split(/\s+/)
    const lines = [`[NOT_FOUND] '${kw}' 판례 검색 결과가 없습니다.`, "", "⚠️ LLM은 판례를 추측/생성하지 마세요. 사용자에게 '검색 실패'를 보고하세요."]
    if (keywords.length >= 2) {
      lines.push("")
      lines.push("힌트: 법제처 API는 공백 구분 키워드를 AND 조건으로 처리합니다. 키워드가 많을수록 결과가 줄어듭니다.")
      lines.push(`재시도 제안: "${keywords[0]}" 또는 "${keywords.slice(0, 2).join(" ")}"`)
    }
    lines.push("")
    lines.push("대안:")
    lines.push(`  1. 해석례 검색: search_interpretations(query="${kw}")`)
    lines.push(`  2. 법령 검색: search_law(query="${kw}")`)
    return { content: [{ type: "text", text: lines.join("\n") }], isError: true };
  }

  let output = `판례 검색 결과 (총 ${totalCount}건, ${currentPage}페이지)`;
  if (args.fromDate || args.toDate) {
    output += ` [기간: ${args.fromDate || "시작"} ~ ${args.toDate || "종료"}]`
  }
  output += `:\n\n`;

  for (const prec of precs) {
    output += `[${prec.판례일련번호}] ${prec.판례명}\n`;
    output += `  사건번호: ${prec.사건번호 || "N/A"}\n`;
    output += `  법원: ${prec.법원명 || "N/A"}\n`;
    output += `  선고일: ${prec.선고일자 || "N/A"}\n`;
    output += `  판결유형: ${prec.판결유형 || "N/A"}\n`;
    if (prec.판례상세링크) {
      output += `  링크: ${prec.판례상세링크}\n`;
    }
    output += `\n`;
  }

  // 다음 단계 힌트
  if (precs.length > 0 && precs[0].판례일련번호) {
    output += `💡 다음: get_precedent_text(id="${precs[0].판례일련번호}") 로 판결문 전문. full=true 로 축약 해제. 유사판례 원하면 find_similar_precedents 사용.\n`
  }

  return {
    content: [{
      type: "text",
      text: truncateResponse(output)
    }]
  };
  } catch (error) {
    return formatToolError(error, "search_precedents")
  }
}

export const getPrecedentTextSchema = z.object({
  id: z.string().describe("판례일련번호 (search_precedents 결과에서 획득)"),
  caseName: z.string().optional().describe("사건명 (선택, 검증용)"),
  full: z.boolean().optional().describe("true=전문 그대로. 미지정 시 '전문' 섹션을 계단식 축약 (판시/요지/참조는 항상 full)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
});

export type GetPrecedentTextInput = z.infer<typeof getPrecedentTextSchema>;

interface PrecedentBasic {
  판례명?: string
  사건번호?: string
  법원명?: string
  선고일자?: string
  사건종류명?: string
  판결유형?: string
}

interface PrecedentContent {
  판시사항?: string
  판결요지?: string
  참조조문?: string
  참조판례?: string
  전문?: string
}

function formatPrecedentText(
  basic: PrecedentBasic,
  content: PrecedentContent,
  full?: boolean
): string {
  let output = `=== ${basic.판례명 || "판례"} ===\n\n`;

  output += `기본 정보:\n`;
  output += `  사건번호: ${basic.사건번호 || "N/A"}\n`;
  output += `  법원: ${basic.법원명 || "N/A"}\n`;
  output += `  선고일: ${basic.선고일자 || "N/A"}\n`;
  output += `  사건종류: ${basic.사건종류명 || "N/A"}\n`;
  output += `  판결유형: ${basic.판결유형 || "N/A"}\n\n`;

  if (content.판시사항) {
    output += `판시사항:\n${content.판시사항}\n\n`;
  }

  if (content.판결요지) {
    output += `판결요지:\n${content.판결요지}\n\n`;
  }

  if (content.참조조문) {
    output += `참조조문:\n${densifyLawRefs(content.참조조문)}\n\n`;
  }

  if (content.참조판례) {
    output += `참조판례:\n${densifyPrecedentRefs(content.참조판례)}\n\n`;
  }

  if (content.전문) {
    const deduped = stripRepeatedSummary(content.전문, [content.판시사항, content.판결요지]);
    const compacted = compactBody(deduped, { full });
    output += `전문:\n${compacted}\n`;
  }

  return output;
}

function normalizeHtmlText(html: string): string {
  const withBlockBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|tr|table|tbody|thead|tfoot|ul|ol|li|h[1-6])\s*>/gi, "\n")
    .replace(/<\s*(p|div|tr|table|tbody|thead|tfoot|ul|ol|li|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<\/\s*td\s*>/gi, "\t")
    .replace(/<\s*td\b[^>]*>/gi, "")

  return cleanHtml(withBlockBreaks)
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function hasSubstantiveTaxlawBody(text: string): boolean {
  const compact = text.replace(/\s+/g, "")
  if (compact.length < 20) return false
  return !/(내용없음|본문없음|조회된내용이없습니다|자료가없습니다)/.test(compact)
}

function normalizeTaxlawBodyCandidate(value: unknown): string {
  if (typeof value !== "string") return ""
  const body = normalizeHtmlText(value)
  return hasSubstantiveTaxlawBody(body) ? body : ""
}

function extractTaxlawEditorBody(actionData: any): string {
  const editorList = Array.isArray(actionData.dcmHwpEditorDVOList)
    ? actionData.dcmHwpEditorDVOList
    : []

  for (const item of editorList) {
    const value = typeof item?.dcmFleByte === "string" ? item.dcmFleByte : ""
    if (!value.includes("<html") && !value.includes("<body") && value.length <= 100) continue
    const body = normalizeTaxlawBodyCandidate(value)
    if (body) return body
  }

  return ""
}

function extractTaxlawBody(actionData: any, dcm: any): string {
  return extractTaxlawEditorBody(actionData) || normalizeTaxlawBodyCandidate(dcm?.ntstDcmCntn)
}

function extractIframeSrc(html: string): string {
  return html.match(/<iframe\b[^>]*\bsrc\s*=\s*["']?\s*([^"'>\s]+)\s*["']?/i)?.[1] || ""
}

function extractHiddenPrecSeq(html: string): string {
  return html.match(/id\s*=\s*["']precSeq["'][^>]*value\s*=\s*["']?\s*(\d+)/i)?.[1] || ""
}

function normalizeUrl(url: string, base = "https://www.law.go.kr"): string {
  return new URL(url, base).toString()
}

function iframeMatchesPrecedentId(iframeUrl: string, id: string): boolean {
  try {
    return new URL(iframeUrl).searchParams.get("precSeq") === id
  } catch {
    return false
  }
}

function isMissingPrecedentJson(data: unknown): boolean {
  if (!data || typeof data !== "object") return true
  const obj = data as Record<string, unknown>
  if (obj.PrecService) return false
  const lawMessage = typeof obj.Law === "string" ? obj.Law : ""
  return lawMessage.includes("일치하는 판례가 없습니다") || !obj.PrecService
}

async function fetchText(response: Response, context: string): Promise<string> {
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${context} failed with HTTP ${response.status}`)
  }
  return text
}

async function fetchTaxlawAction(ntstDcmId: string, referer: string): Promise<any> {
  const body = new URLSearchParams({
    actionId: "ASIQTB002PR01",
    paramData: JSON.stringify({ dcmDVO: { ntstDcmId } }),
  })

  const response = await fetchWithRetry("https://taxlaw.nts.go.kr/action.do", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "origin": "https://taxlaw.nts.go.kr",
      "referer": referer,
      "x-requested-with": "XMLHttpRequest",
    },
    body: body.toString(),
  })

  const text = await fetchText(response, "taxlaw action.do")
  return JSON.parse(text)
}

async function resolveTaxlawDetailUrl(iframeUrl: string): Promise<string> {
  let currentUrl = iframeUrl
  for (let redirectCount = 0; redirectCount < 3; redirectCount++) {
    const iframeResponse = await fetchWithRetry(currentUrl, { redirect: "manual" })
    const location = iframeResponse.headers.get("location")
    if (!location) {
      throw new Error(`precedent iframe did not include taxlaw redirect location (HTTP ${iframeResponse.status})`)
    }

    const nextUrl = normalizeUrl(location, currentUrl)
    const parsedNextUrl = new URL(nextUrl)
    if (parsedNextUrl.searchParams.get("ntstDcmId")) {
      return nextUrl
    }
    if (parsedNextUrl.hostname === "taxlaw.nts.go.kr") {
      throw new Error("HTML fallback response did not expose ntstDcmId")
    }
    currentUrl = nextUrl
  }

  throw new Error("HTML fallback response did not expose ntstDcmId")
}

async function fetchHtmlFallbackPrecedent(
  apiClient: LawApiClient,
  args: GetPrecedentTextInput,
  extraParams: Record<string, string>
): Promise<{ basic: PrecedentBasic; content: PrecedentContent }> {
  const html = await apiClient.fetchApi({
    endpoint: "lawService.do",
    target: "prec",
    type: "HTML",
    extraParams,
    apiKey: args.apiKey,
  })

  const hiddenPrecSeq = extractHiddenPrecSeq(html)
  const iframeSrc = extractIframeSrc(html)
  const iframeUrl = iframeSrc ? normalizeUrl(iframeSrc) : ""
  if (hiddenPrecSeq !== args.id && !iframeMatchesPrecedentId(iframeUrl, args.id)) {
    throw new Error("Precedent not found or invalid response format")
  }
  if (!iframeUrl) {
    throw new Error("HTML fallback response did not include a precedent iframe URL")
  }

  const taxlawDetailUrl = await resolveTaxlawDetailUrl(iframeUrl)
  const ntstDcmId = new URL(taxlawDetailUrl).searchParams.get("ntstDcmId")
  if (!ntstDcmId) {
    throw new Error("HTML fallback response did not expose ntstDcmId")
  }

  const actionJson = await fetchTaxlawAction(ntstDcmId, taxlawDetailUrl)
  const actionData = actionJson?.data?.ASIQTB002PR01
  const dcm = actionData?.dcmDVO
  if (!dcm) {
    throw new Error("HTML fallback taxlaw response did not include dcmDVO")
  }

  const body = extractTaxlawBody(actionData, dcm)
  if (!body) {
    throw new Error("HTML fallback taxlaw response did not include precedent body")
  }

  return {
    basic: {
      판례명: dcm.ntstDcmTtl,
      사건번호: dcm.ntstDcmDscmCntn || dcm.ntstPrdgHpnnNoCntn,
      법원명: dcm.ogzNm,
      선고일자: dcm.ntstDcmRgtDt,
      사건종류명: "국세법령정보시스템 판례",
      판결유형: dcm.ntstDcmClNm,
    },
    content: {
      판결요지: dcm.ntstDcmGistCntn,
      전문: body,
    },
  }
}

export async function getPrecedentText(
  apiClient: LawApiClient,
  args: GetPrecedentTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const extraParams: Record<string, string> = { ID: args.id };
    if (args.caseName) extraParams.LM = args.caseName;

    let responseText: string;
    try {
      responseText = await apiClient.fetchApi({
        endpoint: "lawService.do",
        target: "prec",
        type: "JSON",
        extraParams,
        apiKey: args.apiKey,
      });
    } catch (err) {
      const fallback = await fetchHtmlFallbackPrecedent(apiClient, args, extraParams)
      const output = formatPrecedentText(fallback.basic, fallback.content, args.full)
      return {
        content: [{
          type: "text",
          text: truncateResponse(output)
        }]
      };
    }

  let data: any;
  try {
    data = JSON.parse(responseText);
  } catch (err) {
    const fallback = await fetchHtmlFallbackPrecedent(apiClient, args, extraParams)
    const output = formatPrecedentText(fallback.basic, fallback.content, args.full)
    return {
      content: [{
        type: "text",
        text: truncateResponse(output)
      }]
    };
  }

  if (isMissingPrecedentJson(data)) {
    const fallback = await fetchHtmlFallbackPrecedent(apiClient, args, extraParams)
    const output = formatPrecedentText(fallback.basic, fallback.content, args.full)
    return {
      content: [{
        type: "text",
        text: truncateResponse(output)
      }]
    };
  }

  if (!data.PrecService) {
    throw new Error("Precedent not found or invalid response format");
  }

  const prec = data.PrecService;
  // API returns fields directly in PrecService, not nested
  const basic = {
    판례명: prec.사건명,
    사건번호: prec.사건번호,
    법원명: prec.법원명,
    선고일자: prec.선고일자,
    사건종류명: prec.사건종류명,
    판결유형: prec.판결유형
  };
  const content = {
    판시사항: prec.판시사항,
    판결요지: prec.판결요지,
    참조조문: prec.참조조문,
    참조판례: prec.참조판례,
    전문: prec.판례내용
  };

  const output = formatPrecedentText(basic, content, args.full)

  return {
    content: [{
      type: "text",
      text: truncateResponse(output)
    }]
  };
  } catch (error) {
    return formatToolError(error, "get_precedent_text")
  }
}

