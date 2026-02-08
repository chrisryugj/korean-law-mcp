/**
 * Knowledge Base 공통 유틸리티
 */

/**
 * XML 태그에서 텍스트 추출 (CDATA 지원)
 */
export function extractTag(xml: string, tag: string): string {
  // CDATA 처리
  const cdataRegex = new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, "i")
  const cdataMatch = xml.match(cdataRegex)
  if (cdataMatch) return cdataMatch[1].trim()

  // 일반 태그
  const regex = new RegExp(`<${tag}>([^<]*)<\\/${tag}>`, "i")
  const match = xml.match(regex)
  return match ? match[1].trim() : ""
}

/**
 * KB XML 응답 파싱
 */
export interface KBItem {
  법령용어명?: string
  용어명?: string
  법령용어ID?: string
  동음이의어?: boolean
  용어간관계링크?: string
  조문간관계링크?: string
  법령명?: string
  법령ID?: string
  조문번호?: string
  조문제목?: string
  관계유형?: string
  법령종류?: string
  연계용어명?: string
  일상용어명?: string
}

export interface KBParseResult {
  totalCnt: string
  data: KBItem[]
}

export function parseKBXML(xml: string, _rootTag: string): KBParseResult {
  const result: KBParseResult = { totalCnt: "0", data: [] }

  // totalCnt 추출
  const totalCntMatch = xml.match(/<totalCnt>(\d+)<\/totalCnt>/i) || xml.match(/<검색결과개수>(\d+)<\/검색결과개수>/i)
  result.totalCnt = totalCntMatch ? totalCntMatch[1] : "0"

  // 아이템 추출 (다양한 태그명 지원)
  const itemTags = ["lstrm", "lstrmAI", "law", "jo", "rel", "item"]

  for (const itemTag of itemTags) {
    const itemRegex = new RegExp(`<${itemTag}[^>]*>([\\s\\S]*?)<\\/${itemTag}>`, "gi")
    const matches = xml.matchAll(itemRegex)

    for (const match of matches) {
      const itemContent = match[1]
      const item: KBItem = {}

      // 공통 필드 추출
      item.법령용어명 = extractTag(itemContent, "법령용어명") || extractTag(itemContent, "용어명")
      item.법령용어ID = extractTag(itemContent, "법령용어ID") || extractTag(itemContent, "용어ID")
      item.동음이의어 = extractTag(itemContent, "동음이의어존재여부") === "Y"
      item.용어간관계링크 = extractTag(itemContent, "용어간관계링크") || extractTag(itemContent, "용어관계")
      item.조문간관계링크 = extractTag(itemContent, "조문간관계링크") || extractTag(itemContent, "조문관계")
      item.법령명 = extractTag(itemContent, "법령명")
      item.법령ID = extractTag(itemContent, "법령ID") || extractTag(itemContent, "법령일련번호")
      item.조문번호 = extractTag(itemContent, "조문번호") || extractTag(itemContent, "조번호")
      item.조문제목 = extractTag(itemContent, "조문제목")
      item.관계유형 = extractTag(itemContent, "관계유형") || extractTag(itemContent, "연계유형")
      item.법령종류 = extractTag(itemContent, "법령종류") || extractTag(itemContent, "법종류")
      item.연계용어명 = extractTag(itemContent, "연계용어명") || extractTag(itemContent, "관련용어")
      item.일상용어명 = extractTag(itemContent, "일상용어명") || extractTag(itemContent, "일상용어")

      // 빈 객체가 아닌 경우만 추가
      if (item.법령용어명 || item.법령명 || item.연계용어명) {
        result.data.push(item)
      }
    }

    if (result.data.length > 0) break
  }

  return result
}

/**
 * 용어 검색 폴백
 */
export async function fallbackTermSearch(
  apiClient: any,
  term: string,
  termType: string
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    const xmlText = await apiClient.fetchApi({
      endpoint: "lawSearch.do",
      target: "lstrm",
      extraParams: { query: term, display: "10" },
    })

    const result = parseKBXML(xmlText, "LsTrmSearch")
    const items = result.data || []

    if (items.length === 0) {
      return {
        content: [{
          type: "text",
          text: `'${term}' ${termType} 연계 정보를 찾을 수 없습니다.`,
        }],
        isError: true,
      }
    }

    let output = `📚 '${term}' 관련 용어 (폴백 검색):\n\n`
    for (const item of items) {
      if (item.법령용어명) {
        output += `   • ${item.법령용어명}\n`
      }
    }

    return { content: [{ type: "text", text: output }] }
  } catch {
    return {
      content: [{
        type: "text",
        text: `'${term}' ${termType} 연계 정보를 찾을 수 없습니다.\n\n💡 search_legal_terms(query="${term}")로 기본 검색을 시도해보세요.`,
      }],
      isError: true,
    }
  }
}
