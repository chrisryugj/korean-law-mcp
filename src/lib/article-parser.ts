/**
 * 법령 조문 파싱 유틸리티 (law-text.ts, batch-articles.ts 공통)
 */

/** 중첩 배열 평탄화 후 문자열 결합 (<img> 태그 제외) */
export function flattenContent(value: any): string {
  if (typeof value === "string") return value
  if (!Array.isArray(value)) return ""

  const result: string[] = []
  for (const item of value) {
    if (typeof item === "string") {
      if (!item.startsWith("<img") && !item.startsWith("</img")) {
        result.push(item)
      }
    } else if (Array.isArray(item)) {
      result.push(flattenContent(item))
    }
  }
  return result.join("\n")
}

/** 항 배열에서 내용 추출 (재귀적으로 호/목 처리) */
export function extractHangContent(hangInput: any[] | any): string {
  // API가 단일 항을 객체로 반환하는 경우 배열로 정규화
  const hangArray = Array.isArray(hangInput) ? hangInput : [hangInput]
  let content = ""

  for (const hang of hangArray) {
    if (!hang || typeof hang !== "object") continue

    if (hang.항내용) {
      const hangContent = flattenContent(hang.항내용)
      if (hangContent) {
        content += (content ? "\n" : "") + hangContent
      }
    }

    // 호도 단일 객체일 수 있으므로 정규화
    const hoArray = hang.호 ? (Array.isArray(hang.호) ? hang.호 : [hang.호]) : []
    for (const ho of hoArray) {
      if (!ho || typeof ho !== "object") continue

      if (ho.호내용) {
        const hoContent = flattenContent(ho.호내용)
        if (hoContent) {
          content += "\n" + hoContent
        }
      }

      // 목도 단일 객체일 수 있으므로 정규화
      const mokArray = ho.목 ? (Array.isArray(ho.목) ? ho.목 : [ho.목]) : []
      for (const mok of mokArray) {
        if (!mok || typeof mok !== "object") continue

        if (mok.목내용) {
          const mokContent = flattenContent(mok.목내용)
          if (mokContent) {
            content += "\n" + mokContent
          }
        }
      }
    }
  }

  return content
}

/** HTML 정리 - 엔티티 디코딩 순서 중요: &amp; 최후 처리 (이중 인코딩 방지) */
export function cleanHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')  // &amp; 반드시 마지막 (이중 인코딩 &amp;lt; → &lt; 방지)
    .trim()
}
