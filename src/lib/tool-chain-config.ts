/**
 * 검색 → 상세조회 자동 체인 설정
 *
 * 자연어 CLI에서 search_* 실행 후 첫 번째 결과의 상세 내용을
 * 자동으로 조회하기 위한 매핑 테이블.
 */

export interface SearchDetailChain {
  /** 상세조회 도구 이름 */
  detailTool: string
  /** 상세조회 도구의 ID 파라미터 이름 */
  detailParam: string
  /** 검색 결과 텍스트에서 첫 번째 ID를 추출하는 정규식 (group 1) */
  idRegex: RegExp
}

/** 대부분의 검색 도구: [ID] 제목 형식 */
const BRACKET_ID = /\[(\d+)\]/

export const SEARCH_DETAIL_CHAINS: Record<string, SearchDetailChain> = {
  search_precedents: {
    detailTool: "get_precedent_text",
    detailParam: "id",
    idRegex: BRACKET_ID,
  },
  search_interpretations: {
    detailTool: "get_interpretation_text",
    detailParam: "id",
    idRegex: BRACKET_ID,
  },
  search_tax_tribunal_decisions: {
    detailTool: "get_tax_tribunal_decision_text",
    detailParam: "id",
    idRegex: BRACKET_ID,
  },
  search_customs_interpretations: {
    detailTool: "get_customs_interpretation_text",
    detailParam: "id",
    idRegex: BRACKET_ID,
  },
  search_constitutional_decisions: {
    detailTool: "get_constitutional_decision_text",
    detailParam: "id",
    idRegex: BRACKET_ID,
  },
  search_admin_appeals: {
    detailTool: "get_admin_appeal_text",
    detailParam: "id",
    idRegex: BRACKET_ID,
  },
  search_ftc_decisions: {
    detailTool: "get_ftc_decision_text",
    detailParam: "id",
    idRegex: BRACKET_ID,
  },
  search_pipc_decisions: {
    detailTool: "get_pipc_decision_text",
    detailParam: "id",
    idRegex: BRACKET_ID,
  },
  search_nlrc_decisions: {
    detailTool: "get_nlrc_decision_text",
    detailParam: "id",
    idRegex: BRACKET_ID,
  },
  search_english_law: {
    detailTool: "get_english_law_text",
    detailParam: "lawId",
    idRegex: /\[([^\]]+)\]/,  // 영문 법령 ID는 숫자가 아닐 수 있음
  },
  search_admin_rule: {
    detailTool: "get_admin_rule",
    detailParam: "id",
    idRegex: /행정규칙ID:\s*(\S+)/,  // 행정규칙은 [ID] 형식이 아님
  },
  search_ordinance: {
    detailTool: "get_ordinance",
    detailParam: "ordinSeq",
    idRegex: BRACKET_ID,
  },
}
