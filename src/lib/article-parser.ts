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

/** 목 배열을 소속 호별로 그룹핑.
 *  법제처 JSON은 목(目)을 호의 자식이 아니라 **항 레벨 형제 배열**로 주고 목 객체에
 *  소속 호 정보가 없다(키는 목번호·목내용뿐). 목번호가 '가'로 리셋되는 지점을 새 호의
 *  목 시작으로 보고 순서를 복원한다 — 조판 규칙상 각 호의 목은 항상 '가'부터 시작한다. */
export function groupMokByReset(mokArray: any[]): any[][] {
  const groups: any[][] = []
  for (const mok of mokArray) {
    if (!mok || typeof mok !== "object") continue
    const num = String(mok.목번호 ?? "").trim()
    if (num.startsWith("가") || groups.length === 0) groups.push([])
    groups[groups.length - 1].push(mok)
  }
  return groups
}

/** 목 배열 → 텍스트 (앞에 개행 포함) */
function renderMok(mokArray: any[]): string {
  let out = ""
  for (const mok of mokArray) {
    if (!mok || typeof mok !== "object") continue
    if (mok.목내용) {
      const mokContent = flattenContent(mok.목내용)
      if (mokContent) out += "\n" + mokContent
    }
  }
  return out
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
    // 항 레벨 목 — 그룹 수가 호 수와 같을 때만 각 호 뒤에 배치(원문 순서 복원)
    const hangMokArray = hang.목 ? (Array.isArray(hang.목) ? hang.목 : [hang.목]) : []
    const mokGroups = groupMokByReset(hangMokArray)
    const alignable = hoArray.length > 0 && mokGroups.length === hoArray.length

    for (let i = 0; i < hoArray.length; i++) {
      const ho = hoArray[i]
      if (!ho || typeof ho !== "object") continue

      if (ho.호내용) {
        const hoContent = flattenContent(ho.호내용)
        if (hoContent) {
          content += "\n" + hoContent
        }
      }

      // 호 안에 목이 실려 오는 응답도 있어 기존 경로는 유지
      const mokArray = ho.목 ? (Array.isArray(ho.목) ? ho.목 : [ho.목]) : []
      content += renderMok(mokArray)

      if (alignable) content += renderMok(mokGroups[i])
    }

    // 호에 배정하지 못한 항 레벨 목 — 누락시키지 않고 항 말미에 모아 출력
    if (!alignable && hangMokArray.length > 0) {
      const rest = renderMok(hangMokArray)
      if (rest) {
        content += "\n[참고] 아래 목은 위 각 호의 세부 항목이나 API 응답 구조상 소속 호를 특정할 수 없어 일괄 표시합니다."
        content += rest
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
// ①~⑳(U+2460~) 뒤로 ㉑~㉟(U+3251~)·㊱~㊿(U+32B1~)는 다른 유니코드 블록 —
// ⑳에서 끊으면 제21항 이상의 실존 인용이 NaN이 되어 verify_citations가
// "존재하지 않는 항"([HALLUCINATION_DETECTED])으로 오판한다.
export const CIRCLED_DIGITS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚㉛㉜㉝㉞㉟㊱㊲㊳㊴㊵㊶㊷㊸㊹㊺㊻㊼㊽㊾㊿"

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

/**
 * HTML 정리 - 엔티티 디코딩 순서 중요: &amp; 최후 처리 (이중 인코딩 방지)
 *
 * 태그 제거는 영문 태그와 주석으로 한정한다. 조문 본문에는 `<개정 2012.8.1.>`·`<신설 2005.12.29>`·
 * `부칙 <1999.01.11>` 같은 꺾쇠 표기가 원문 그대로 오는데, `<[^>]+>` 로 지우면 개정 시점이 통째로
 * 사라졌다(민법 전문에서만 149개, 2026-09-23). 행위시법 판단의 근거라 남긴다. admin-rule 의
 * markChangedParts 와 같은 규칙이다.
 */
export function cleanHtml(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?[A-Za-z][^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')  // &amp; 반드시 마지막 (이중 인코딩 &amp;lt; → &lt; 방지)
    .trim()
}
