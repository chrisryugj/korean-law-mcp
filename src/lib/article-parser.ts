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

/**
 * 조문단위 객체를 텍스트로 포맷팅 (law-text, batch-articles, article-detail 공통)
 * 조문 헤더(제X조 제목) + 본문 + 항/호/목을 결합하여 반환
 */
export function formatArticleUnit(unit: {
  조문여부?: string
  조문번호?: string
  조문가지번호?: string
  조문제목?: string
  조문내용?: unknown
  항?: unknown
}): { header: string; body: string } | null {
  if (unit.조문여부 !== "조문") return null

  const joNum = unit.조문번호 || ""
  const joBranch = unit.조문가지번호 || ""
  const joTitle = unit.조문제목 || ""

  // 헤더
  let header = ""
  if (joNum) {
    const displayNum = joBranch && joBranch !== "0" ? `제${joNum}조의${joBranch}` : `제${joNum}조`
    header = joTitle ? `${displayNum} ${joTitle}` : displayNum
  }

  // 본문: 조문내용에서 헤더 패턴 제거
  let mainContent = ""
  if (unit.조문내용) {
    const contentStr = flattenContent(unit.조문내용)
    if (contentStr) {
      const headerMatch = contentStr.match(/^(제\d+조(?:의\d+)?\s*(?:\([^)]+\))?)[\s\S]*/)
      if (headerMatch) {
        const bodyPart = contentStr.substring(headerMatch[1].length).trim()
        mainContent = bodyPart || contentStr
      } else {
        mainContent = contentStr
      }
    }
  }

  // 항/호/목
  let paraContent = ""
  if (unit.항) {
    paraContent = extractHangContent(unit.항)
  }

  // 결합
  let body = ""
  if (mainContent) {
    body = mainContent
    if (paraContent) body += "\n" + paraContent
  } else {
    body = paraContent
  }

  // HTML 정리
  if (body) body = cleanHtml(body)

  return { header, body }
}

/**
 * 항번호 문자열을 숫자로 변환.
 * 법제처 API는 항번호를 원숫자(①②③…)로 돌려주는 경우가 많아 일반 숫자 추출만 하면 NaN.
 * 원숫자 ①=1 … ⑳=20 매핑 + fallback으로 일반 숫자 추출.
 */
const CIRCLED_DIGITS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"

export function parseHangNumber(raw: unknown): number {
  const s = String(raw ?? "").trim()
  if (!s) return NaN
  // 원숫자 매핑 (첫 글자 기준)
  const circledIdx = CIRCLED_DIGITS.indexOf(s[0])
  if (circledIdx >= 0) return circledIdx + 1
  // 일반 숫자 매칭 (예: "1", "제1항", "제 1 항")
  const numMatch = s.match(/\d+/)
  return numMatch ? parseInt(numMatch[0], 10) : NaN
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
