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
export function extractHangContent(hangArray: any[]): string {
  let content = ""

  for (const hang of hangArray) {
    if (hang.항내용) {
      const hangContent = flattenContent(hang.항내용)
      if (hangContent) {
        content += (content ? "\n" : "") + hangContent
      }
    }

    if (hang.호 && Array.isArray(hang.호)) {
      for (const ho of hang.호) {
        if (ho.호내용) {
          const hoContent = flattenContent(ho.호내용)
          if (hoContent) {
            content += "\n" + hoContent
          }
        }

        if (ho.목 && Array.isArray(ho.목)) {
          for (const mok of ho.목) {
            if (mok.목내용) {
              const mokContent = flattenContent(mok.목내용)
              if (mokContent) {
                content += "\n" + mokContent
              }
            }
          }
        }
      }
    }
  }

  return content
}

/** HTML 정리 */
export function cleanHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .trim()
}
