/**
 * 공통 XML 파싱 유틸리티
 * 법제처 API 응답 XML 파싱용
 */

/**
 * XML 태그에서 텍스트 추출 (CDATA 지원)
 */
export function extractTag(content: string, tag: string): string {
  // CDATA 형식 먼저 시도
  const cdataRegex = new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`)
  const cdataMatch = content.match(cdataRegex)
  if (cdataMatch) return cdataMatch[1]

  // 일반 형식
  const regex = new RegExp(`<${tag}>([^<]*)<\\/${tag}>`)
  const match = content.match(regex)
  return match ? match[1] : ""
}

/**
 * 검색 결과 XML 파싱
 * @param xml 전체 XML 문자열
 * @param rootTag 루트 태그 (예: PrecSearch, Expc, Decc)
 * @param itemTag 항목 태그 (예: prec, expc, decc)
 * @param fieldExtractor 필드 추출 함수
 */
export function parseSearchXML<T>(
  xml: string,
  rootTag: string,
  itemTag: string,
  fieldExtractor: (content: string) => T
): { totalCnt: number; page: number; items: T[] } {
  // 루트 태그 추출
  const rootRegex = new RegExp(`<${rootTag}[^>]*>([\\s\\S]*?)<\\/${rootTag}>`)
  const rootMatch = xml.match(rootRegex)

  if (!rootMatch) {
    return { totalCnt: 0, page: 1, items: [] }
  }

  const content = rootMatch[1]

  // totalCnt, page 추출
  const totalCnt = parseInt(extractTag(content, "totalCnt") || "0", 10)
  const page = parseInt(extractTag(content, "page") || "1", 10)

  // 항목 추출
  const itemRegex = new RegExp(`<${itemTag}[^>]*>([\\s\\S]*?)<\\/${itemTag}>`, "g")
  const items: T[] = []

  let match
  while ((match = itemRegex.exec(content)) !== null) {
    items.push(fieldExtractor(match[1]))
  }

  return { totalCnt, page, items }
}

/**
 * 판례 검색 결과 파싱
 */
export interface PrecedentItem {
  판례일련번호: string
  판례명: string
  사건번호: string
  법원명: string
  선고일자: string
  판결유형: string
  판례상세링크: string
}

export function parsePrecedentXML(xml: string) {
  return parseSearchXML<PrecedentItem>(xml, "PrecSearch", "prec", (content) => ({
    판례일련번호: extractTag(content, "판례일련번호"),
    판례명: extractTag(content, "사건명"),
    사건번호: extractTag(content, "사건번호"),
    법원명: extractTag(content, "법원명"),
    선고일자: extractTag(content, "선고일자"),
    판결유형: extractTag(content, "판결유형"),
    판례상세링크: extractTag(content, "판례상세링크")
  }))
}

/**
 * 법령해석례 검색 결과 파싱
 */
export interface InterpretationItem {
  법령해석례일련번호: string
  안건명: string
  법령해석례번호: string
  회신일자: string
  해석기관명: string
  법령해석례상세링크: string
  질의요지: string
  회답: string
  회답일자: string
  소관부처명: string
}

export function parseInterpretationXML(xml: string) {
  return parseSearchXML<InterpretationItem>(xml, "Expc", "expc", (content) => ({
    법령해석례일련번호: extractTag(content, "법령해석례일련번호"),
    법령해석례번호: extractTag(content, "안건번호"),
    회신일자: extractTag(content, "회신일자"),
    해석기관명: extractTag(content, "회신기관명"),
    법령해석례상세링크: extractTag(content, "법령해석례상세링크"),
    안건명: extractTag(content, "안건명"),
    질의요지: extractTag(content, "질의요지"),
    회답: extractTag(content, "회답"),
    회답일자: extractTag(content, "회답일자"),
    소관부처명: extractTag(content, "소관부처명")
  }))
}

/**
 * 행정심판례 검색 결과 파싱
 */
export interface AdminAppealItem {
  행정심판재결례일련번호: string
  사건명: string
  사건번호: string
  처분일자: string
  의결일자: string
  처분청: string
  재결청: string
  재결구분명: string
  재결구분코드: string
  행정심판례상세링크: string
}

export function parseAdminAppealXML(xml: string) {
  return parseSearchXML<AdminAppealItem>(xml, "Decc", "decc", (content) => ({
    행정심판재결례일련번호: extractTag(content, "행정심판재결례일련번호"),
    사건명: extractTag(content, "사건명"),
    사건번호: extractTag(content, "사건번호"),
    처분일자: extractTag(content, "처분일자"),
    의결일자: extractTag(content, "의결일자"),
    처분청: extractTag(content, "처분청"),
    재결청: extractTag(content, "재결청"),
    재결구분명: extractTag(content, "재결구분명"),
    재결구분코드: extractTag(content, "재결구분코드"),
    행정심판례상세링크: extractTag(content, "행정심판례상세링크")
  }))
}

/**
 * 헌법재판소 결정례 검색 결과 파싱
 */
export interface ConstitutionalItem {
  헌재결정례일련번호: string
  사건명: string
  사건번호: string
  종국일자: string
  헌재결정례상세링크: string
}

export function parseConstitutionalXML(xml: string) {
  // DetcSearch 루트, Detc 항목 (대문자 주의)
  return parseSearchXML<ConstitutionalItem>(xml, "DetcSearch", "Detc", (content) => ({
    헌재결정례일련번호: extractTag(content, "헌재결정례일련번호"),
    사건명: extractTag(content, "사건명"),
    사건번호: extractTag(content, "사건번호"),
    종국일자: extractTag(content, "종국일자"),
    헌재결정례상세링크: extractTag(content, "헌재결정례상세링크")
  }))
}

/**
 * 조세심판원 재결례 검색 결과 파싱
 */
export interface TaxTribunalItem {
  특별행정심판재결례일련번호: string
  사건명: string
  청구번호: string
  처분일자: string
  의결일자: string
  처분청: string
  재결청: string
  재결구분명: string
  재결구분코드: string
  행정심판재결례상세링크: string
}

export function parseTaxTribunalXML(xml: string) {
  // Decc 루트, decc 항목 (소문자)
  return parseSearchXML<TaxTribunalItem>(xml, "Decc", "decc", (content) => ({
    특별행정심판재결례일련번호: extractTag(content, "특별행정심판재결례일련번호"),
    사건명: extractTag(content, "사건명"),
    청구번호: extractTag(content, "청구번호"),
    처분일자: extractTag(content, "처분일자"),
    의결일자: extractTag(content, "의결일자"),
    처분청: extractTag(content, "처분청"),
    재결청: extractTag(content, "재결청"),
    재결구분명: extractTag(content, "재결구분명"),
    재결구분코드: extractTag(content, "재결구분코드"),
    행정심판재결례상세링크: extractTag(content, "행정심판재결례상세링크")
  }))
}

/**
 * 관세해석례 검색 결과 파싱
 */
export interface CustomsItem {
  관세행정해석례일련번호: string
  안건명: string
  질의내용: string
  회신일자: string
  처리부서: string
}

export function parseCustomsXML(xml: string) {
  return parseSearchXML<CustomsItem>(xml, "CustomsSearch", "customs", (content) => ({
    관세행정해석례일련번호: extractTag(content, "관세행정해석례일련번호"),
    안건명: extractTag(content, "안건명"),
    질의내용: extractTag(content, "질의내용"),
    회신일자: extractTag(content, "회신일자"),
    처리부서: extractTag(content, "처리부서")
  }))
}
