import { z } from "zod";
import type { LawApiClient } from "../lib/api-client.js";
import { truncateResponse } from "../lib/schemas.js";
import { parseSearchXML, extractTag } from "../lib/xml-parser.js";
import { formatToolError, noResultHint, notFoundResponse } from "../lib/errors.js";
import { decisionFields } from "../lib/decision-fields.js";
import { rethrowIfFatal } from "../lib/fatal-errors.js";
import { extractTaxlawEditorBody, fetchTaxlawAction, normalizeHtmlText } from "./precedents.js";
import { ministryLabel } from "../lib/cgm-expc-ministries.js";

// 관세청(kcsCgmExpc)·국세청(ntsCgmExpc)·고용노동부(moelCgmExpc)·행정안전부(moisCgmExpc) 등 중앙부처 1차 해석은
// 응답 구조(CgmExpc/cgmExpc, CgmExpcService)가 동일하므로 target만 분기해 재사용 (부처 목록: lib/cgm-expc-ministries)
export type CgmExpcTarget = `${string}CgmExpc`;
const TOOL_NAMES: Record<string, { search: string; text: string }> = {
  kcsCgmExpc: { search: "search_customs_interpretations", text: "get_customs_interpretation_text" },
  ntsCgmExpc: { search: "search_nts_interpretations", text: "get_nts_interpretation_text" },
  moelCgmExpc: { search: "search_moel_interpretations", text: "get_moel_interpretation_text" },
  moisCgmExpc: { search: "search_mois_interpretations", text: "get_mois_interpretation_text" },
};
const toolNames = (target: CgmExpcTarget) =>
  TOOL_NAMES[target] ?? { search: "search_decisions[ministry]", text: "get_decision_text[ministry]" };

/** 검색범위 search(1=안건명 기본, 2=본문). options 경유로 문자열 "2"가 올 수 있다 */
function normalizeSearchScope(value: unknown): string | undefined {
  const text = typeof value === "number" ? String(Math.trunc(value)) : typeof value === "string" ? value.trim() : ""
  return text === "1" || text === "2" ? text : undefined
}

// Customs legal interpretation search tool - Search for customs law interpretations
export const searchCustomsInterpretationsSchema = z.object({
  query: z.string().optional().describe("Search keyword (e.g., '거래명세서', '세금')"),
  display: z.number().min(1).max(100).default(20).describe("Results per page (default: 20, max: 100)"),
  page: z.number().min(1).default(1).describe("Page number (default: 1)"),
  inq: z.number().optional().describe("Inquiry organization code (질의기관코드)"),
  rpl: z.number().optional().describe("Interpretation organization code (해석기관코드)"),
  gana: z.string().optional().describe("Dictionary search (ga, na, da, etc.)"),
  explYd: z.string().optional().describe("Interpretation date range (YYYYMMDD~YYYYMMDD, e.g., '20200101~20201231')"),
  sort: z.enum(["lasc", "ldes", "dasc", "ddes"]).optional()
    .describe("Sort option: lasc/ldes (interpretation name), dasc/ddes (interpretation date)"),
  search: z.union([z.number(), z.string()]).optional()
    .describe("Search scope: 1=안건명 (default), 2=본문"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
});

export type SearchCustomsInterpretationsInput = z.infer<typeof searchCustomsInterpretationsSchema>;

export async function searchCustomsInterpretations(
  apiClient: LawApiClient,
  args: SearchCustomsInterpretationsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  return searchCgmExpcByTarget(apiClient, args, "kcsCgmExpc");
}

/** 국세청 법령해석 검색 (#35) — 응답 구조 관세청과 동일, target만 분기. unified-decisions만 사용 */
export async function searchNtsInterpretations(
  apiClient: LawApiClient,
  args: SearchCustomsInterpretationsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  return searchCgmExpcByTarget(apiClient, args, "ntsCgmExpc");
}

/** 고용노동부 법령해석(질의회시) 검색 — 응답 구조 관세청과 동일, target만 분기. unified-decisions만 사용 */
export async function searchMoelInterpretations(
  apiClient: LawApiClient,
  args: SearchCustomsInterpretationsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  return searchCgmExpcByTarget(apiClient, args, "moelCgmExpc");
}

/** 행정안전부 법령해석(지방세 등 유권해석) 검색 (#182) — 응답 구조 관세청과 동일, target만 분기. unified-decisions만 사용 */
export async function searchMoisInterpretations(
  apiClient: LawApiClient,
  args: SearchCustomsInterpretationsInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  return searchCgmExpcByTarget(apiClient, args, "moisCgmExpc");
}

export async function searchCgmExpcByTarget(
  apiClient: LawApiClient,
  args: SearchCustomsInterpretationsInput,
  target: CgmExpcTarget
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  const orgLabel = ministryLabel(target);
  try {
    const extraParams: Record<string, string> = {
      display: (args.display || 20).toString(),
      page: (args.page || 1).toString(),
    };
    if (args.query) extraParams.query = args.query;
    if (args.inq !== undefined) extraParams.inq = args.inq.toString();
    if (args.rpl !== undefined) extraParams.rpl = args.rpl.toString();
    if (args.gana) extraParams.gana = args.gana;
    if (args.explYd) extraParams.explYd = args.explYd;
    if (args.sort) extraParams.sort = args.sort;
    const searchScope = normalizeSearchScope(args.search);
    if (searchScope) extraParams.search = searchScope;

    const xmlText = await apiClient.fetchApi({
      endpoint: "lawSearch.do",
      target,
      extraParams,
      apiKey: args.apiKey,
    });

    // parseSearchXML 사용 (rootTag: CgmExpc, itemTag: cgmExpc)
    const { totalCnt, page: currentPage, items: expcs } = parseSearchXML(
      xmlText, "CgmExpc", "cgmExpc",
      (content) => ({
        법령해석일련번호: extractTag(content, "법령해석일련번호"),
        안건명: extractTag(content, "안건명"),
        안건번호: extractTag(content, "안건번호"),
        질의기관코드: extractTag(content, "질의기관코드"),
        질의기관명: extractTag(content, "질의기관명"),
        해석기관코드: extractTag(content, "해석기관코드"),
        해석기관명: extractTag(content, "해석기관명"),
        해석일자: extractTag(content, "해석일자"),
        법령해석상세링크: extractTag(content, "법령해석상세링크"),
      })
    );

    const totalCount = totalCnt;

    if (totalCount === 0) {
      return noResultHint(args.query || "", `${orgLabel} 법령해석`)
    }

    let output = `${orgLabel} 법령해석 검색 결과 (총 ${totalCount}건, ${currentPage}페이지):\n\n`;

    for (const expc of expcs) {
      output += `[${expc.법령해석일련번호}] ${expc.안건명}\n`;
      if (expc.안건번호) output += `  안건번호: ${expc.안건번호}\n`;
      output += `  질의기관: ${expc.질의기관명 || "N/A"}\n`;
      output += `  해석기관: ${expc.해석기관명 || "N/A"}\n`;
      output += `  해석일자: ${expc.해석일자 || "N/A"}\n`;
      if (expc.법령해석상세링크) {
        output += `  링크: ${expc.법령해석상세링크}\n`;
      }
      // 국세청·재정경제부는 법제처 일련번호로 본문을 못 받는다 — 상세링크가 taxlaw 면 본문 조회 키(ntstDcmId)를 따로 싣는다 (#178, #182)
      const ntstDcmId = extractNtstDcmId(expc.법령해석상세링크);
      if (ntstDcmId) output += `  본문조회ID(ntstDcmId): ${ntstDcmId}\n`;
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
    return formatToolError(error, toolNames(target).search);
  }
}

// Customs legal interpretation text retrieval tool - Get full text of a specific interpretation
export const getCustomsInterpretationTextSchema = z.object({
  id: z.string().describe("Customs interpretation serial number (법령해석일련번호) from search results"),
  interpretationName: z.string().optional().describe("Interpretation name (optional, for verification)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
});

export type GetCustomsInterpretationTextInput = z.infer<typeof getCustomsInterpretationTextSchema>;

export async function getCustomsInterpretationText(
  apiClient: LawApiClient,
  args: GetCustomsInterpretationTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  return getCgmExpcTextByTarget(apiClient, args, "kcsCgmExpc");
}

/** 고용노동부 법령해석(질의회시) 본문 조회 — lawService.do?target=moelCgmExpc (CgmExpcService) */
export async function getMoelInterpretationText(
  apiClient: LawApiClient,
  args: GetCustomsInterpretationTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  return getCgmExpcTextByTarget(apiClient, args, "moelCgmExpc");
}

/** 행정안전부 법령해석 본문 조회 — lawService.do?target=moisCgmExpc (CgmExpcService) (#182) */
export async function getMoisInterpretationText(
  apiClient: LawApiClient,
  args: GetCustomsInterpretationTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  return getCgmExpcTextByTarget(apiClient, args, "moisCgmExpc");
}

/** 국세법령정보시스템 문서 ID — 18자리 숫자 또는 그것을 담은 taxlaw.nts.go.kr 상세링크 */
export function extractNtstDcmId(value: string | undefined): string {
  const text = (value || "").trim();
  if (/^\d{18}$/.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.hostname !== "taxlaw.nts.go.kr") return "";
    const id = url.searchParams.get("ntstDcmId") || "";
    return /^\d{18}$/.test(id) ? id : "";
  } catch {
    return "";
  }
}

/** taxlaw 날짜 "20220623" → "2022.06.23" */
function formatTaxlawDate(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  return /^\d{8}$/.test(text) ? `${text.slice(0, 4)}.${text.slice(4, 6)}.${text.slice(6)}` : text;
}

/**
 * 국세청 법령해석 본문 조회 (#35, #178)
 *
 * 법제처 OPEN API는 국세청 법령해석에 대해 **목록 조회만 제공**한다
 * (`lawService.do?target=ntsCgmExpc` 없음). 본문은 국세법령정보시스템(taxlaw.nts.go.kr)에만 있어,
 * 검색 결과 상세링크의 ntstDcmId로 판례 폴백과 같은 action(ASIQTB002PR01)을 부른다.
 * 판례와 달리 해석례는 둘로 나뉘어 온다(실측 2026-10-24): 편집기 HTML = 사실관계·질의·관련법령,
 * ntstDcmCntn = 회신. 판례 폴백처럼 하나만 고르면 회신이 빠진다.
 * 법제처 일련번호는 ntstDcmId로 바꿀 길이 없어 종전처럼 링크 안내로 돌려보낸다.
 */
export async function getNtsInterpretationText(
  _apiClient: LawApiClient,
  args: GetCustomsInterpretationTextInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  const ntstDcmId = extractNtstDcmId(args.id);
  if (!ntstDcmId) {
    const text =
      `[NOT_SUPPORTED] 국세청 법령해석은 법제처 OPEN API에서 본문 조회를 제공하지 않습니다.\n\n` +
      `입력 ID: ${args.id}\n` +
      `법제처 일련번호로는 본문을 받을 수 없습니다. search_decisions(domain="nts") 결과의 ` +
      `'본문조회ID(ntstDcmId)'(18자리) 또는 '링크'(taxlaw.nts.go.kr) 주소를 id로 넘기세요.\n\n` +
      `⚠️ LLM은 본문을 추측/생성하지 말고, 검색 결과에 포함된 링크를 그대로 사용자에게 안내하세요.`;
    return { content: [{ type: "text", text }], isError: true };
  }

  const detailUrl = `https://taxlaw.nts.go.kr/qt/USEQTA002P.do?ntstDcmId=${ntstDcmId}`;
  try {
    const actionJson = await fetchTaxlawAction(ntstDcmId, detailUrl);
    const actionData = actionJson?.data?.ASIQTB002PR01;
    const dcm = actionData?.dcmDVO;
    // 부존재 단정은 양성 신호로만: 실측상 없는 ID 는 status SUCCESS + dcmDVO null. 그 밖의 모양은 응답 고장이다
    if (!dcm && !(actionJson?.status === "SUCCESS" && actionData && actionData.dcmDVO === null)) {
      throw new Error("taxlaw response did not include dcmDVO");
    }
    if (!dcm) {
      return notFoundResponse(`국세법령정보시스템에 ntstDcmId ${ntstDcmId} 문서가 없습니다.`, [
        `search_decisions(domain="nts")로 다시 검색해 본문조회ID를 확인하세요.`,
      ]);
    }

    const clean = (v: unknown) => typeof v === "string" ? normalizeHtmlText(v) : "";
    const gist = clean(dcm.ntstDcmGistCntn);
    const reply = clean(dcm.ntstDcmCntn);
    const body = extractTaxlawEditorBody(actionData);

    let output = `=== ${dcm.ntstDcmTtl || "국세청 법령해석"} ===\n\n`;
    output += `기본 정보:\n`;
    output += `  안건번호: ${dcm.ntstDcmDscmCntn || "N/A"}\n`;
    if (dcm.ntstDcmRplyCntn) output += `  회신번호: ${dcm.ntstDcmRplyCntn}\n`;
    output += `  생산일자: ${formatTaxlawDate(dcm.ntstDcmRgtDt) || "N/A"}\n`;
    output += `  ntstDcmId: ${ntstDcmId}\n\n`;
    if (gist) output += `요지:\n${gist}\n\n`;
    if (reply) output += `회신:\n${reply}\n\n`;
    if (body) output += `본문:\n${body}\n\n`;
    if (!reply && !body) output += `본문: (국세법령정보시스템 응답에 본문 없음 — 아래 링크에서 확인)\n\n`;
    output += `출처: 국세법령정보시스템 공개 페이지(법제처 OPEN API 아님) — 인용 전 원문 대조 권장\n`;
    output += `원문 링크: ${detailUrl}\n`;

    return { content: [{ type: "text", text: truncateResponse(output) }] };
  } catch (error) {
    rethrowIfFatal(error);
    return formatToolError(error, `${TOOL_NAMES.ntsCgmExpc.text} (원문 링크: ${detailUrl})`);
  }
}

export async function getCgmExpcTextByTarget(
  apiClient: LawApiClient,
  args: GetCustomsInterpretationTextInput,
  target: CgmExpcTarget
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const extraParams: Record<string, string> = { ID: args.id };
    if (args.interpretationName) extraParams.LM = args.interpretationName;

    const responseText = await apiClient.fetchApi({
      endpoint: "lawService.do",
      target,
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

    if (!data.CgmExpcService) {
      throw new Error(`${ministryLabel(target)} interpretation not found or invalid response format`);
    }

    const expc = decisionFields(data.CgmExpcService);
    const basic = {
      안건명: expc.안건명,
      안건번호: expc.안건번호,
      법령해석일련번호: expc.법령해석일련번호,
      업무분야: expc.업무분야,
      해석일자: expc.해석일자,
      해석기관명: expc.해석기관명,
      질의기관명: expc.질의기관명,
      등록일시: expc.등록일시
    };
    const content = {
      질의요지: expc.질의요지,
      회답: expc.회답,
      이유: expc.이유,
      관련법령: expc.관련법령,
      관세법령정보포털원문링크: expc.관세법령정보포털원문링크
    };

    let output = `=== ${basic.안건명 || `${ministryLabel(target)} 법령해석`} ===\n\n`;

    output += `기본 정보:\n`;
    output += `  해석일련번호: ${basic.법령해석일련번호 || "N/A"}\n`;
    if (basic.안건번호) output += `  안건번호: ${basic.안건번호}\n`;
    output += `  업무분야: ${basic.업무분야 || "N/A"}\n`;
    output += `  해석일자: ${basic.해석일자 || "N/A"}\n`;
    output += `  질의기관: ${basic.질의기관명 || "N/A"}\n`;
    output += `  해석기관: ${basic.해석기관명 || "N/A"}\n`;
    output += `  등록일시: ${basic.등록일시 || "N/A"}\n\n`;

    if (content.질의요지) {
      output += `질의요지:\n${content.질의요지}\n\n`;
    }

    if (content.회답) {
      output += `회답:\n${content.회답}\n\n`;
    }

    if (content.이유) {
      output += `이유:\n${content.이유}\n\n`;
    }

    if (content.관련법령) {
      output += `관련법령:\n${content.관련법령}\n\n`;
    }

    if (content.관세법령정보포털원문링크) {
      output += `원문 링크: ${content.관세법령정보포털원문링크}\n`;
    }

    return {
      content: [{
        type: "text",
        text: truncateResponse(output)
      }]
    };
  } catch (error) {
    return formatToolError(error, toolNames(target).text);
  }
}
