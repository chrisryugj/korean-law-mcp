/**
 * 인용조문(knd=1) 봉투 어댑터. LexDiff/lib/three-tier-parser.ts의 citation 경로와
 * 법제처 실응답(2026-10-02 관세법)을 대조: 루트와 하위 조문 목록 봉투가 위임 모드와 다르다.
 * 기존 LexDiff 위임 파서는 유지하고, 하위 조문 파싱만 같은 형태로 바꿔 재사용한다.
 */
import { parseThreeTierDelegation } from "./three-tier-parser.js"
import { formatJO } from "./law-parser.js"
import { toArray } from "./xml-parser.js"
import type { ThreeTierData } from "./types.js"

export function parseThreeTierCitation(json: any): ThreeTierData {
  const service = json?.ThdCmpLawXService
  if (!service) throw new Error("ThdCmpLawXService 데이터가 없습니다")
  const rows = toArray<any>(service.인용조문삼단비교?.법률조문)
    // 인용 모드 전문에는 같은 조번호의 장·절 헤더도 섞인다.
    .filter(row => row.조제목 || !/^제\d+(?:편|장|절|관)/.test(String(row.조내용 || "").trim()))
  const adapted = rows.map(row => ({
    ...row,
    시행령조문: row.시행령조문목록?.시행령조문 ?? row.시행령조문,
    시행규칙조문: row.시행규칙조문목록?.시행규칙조문 ?? row.시행규칙조문,
  }))
  const parsed = parseThreeTierDelegation({ LspttnThdCmpLawXService: {
    기본정보: service.기본정보,
    위임조문삼단비교: { 법률조문: adapted },
  } })
  const links = new Map(parsed.articles.map(article => [article.jo, article.delegations]))
  return {
    meta: parsed.meta,
    kndType: "인용조문",
    articles: rows.map(row => {
      const jo = String(row.조번호 || "0").padStart(4, "0") + String(row.조가지번호 || "0").padStart(2, "0")
      return { jo, joNum: formatJO(jo), title: row.조제목 || "", content: row.조내용 || "", delegations: links.get(jo) ?? [], citations: [] }
    }),
  }
}
