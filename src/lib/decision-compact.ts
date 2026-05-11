/**
 * Decision Compact — 판례/헌재/행심 응답 토큰 최적화 유틸
 *
 * B. compactBody: 본문("이유"/"전문")을 "앞 800자 + 중략 + 뒤 400자"로 계단식 축약.
 *    판시사항/판결요지/주문은 이미 별도 필드로 분리 반환되므로 본문에만 적용.
 *    문장 경계(마침표·판례 특유 종결어미)를 존중하여 중간 절단 방지.
 *
 * C. densifyLawRefs / densifyPrecedentRefs: 참조조문·참조판례의 서지 잉여 제거.
 *    괄호 안 조문명, "선고"/"판결" 군더더기, 날짜 공백 압축. 구조 유지 + 압축.
 *
 * D. compactLongSections: 통합 후처리용. 응답 텍스트에서 알려진 긴 섹션 헤더
 *    ("이유:", "전문:", "회답:" 등)를 찾아 해당 섹션 본문에 compactBody 적용.
 *    unified-decisions.ts가 도메인별 스키마를 바꾸지 않고 full=false 기본값을
 *    강제하기 위해 사용.
 *
 * 안전성: 모든 함수는 매칭 실패 / 빈 입력 / 짧은 입력 시 **원본 그대로 반환**.
 */

export interface CompactOptions {
  /** true 시 축약 비활성 → 원본 반환 */
  full?: boolean
  /** 앞쪽 보존 길이 (기본 800자) */
  headSize?: number
  /** 뒤쪽 보존 길이 (기본 400자) */
  tailSize?: number
  /** head+tail+minSave 이하면 축약 안 함 (기본 500자) */
  minSave?: number
}

/**
 * 본문 계단식 축약
 * - 앞 800자 + 중략 마커 + 뒤 400자
 * - 문장 경계 가드: 마침표/판례 종결어미/빈 줄에서 끊기
 * - head 기준 50% 이상 위치에 경계 없으면 원시 슬라이스 사용 (fallback)
 */
export function compactBody(text: string, opts: CompactOptions = {}): string {
  if (opts.full || !text) return text

  const HEAD = opts.headSize ?? 800
  const TAIL = opts.tailSize ?? 400
  const MIN_SAVE = opts.minSave ?? 500

  // 짧으면 축약 이득 없음 → 원본
  if (text.length <= HEAD + TAIL + MIN_SAVE) return text

  // HEAD — 앞에서 HEAD자까지 중 문장 끝에서 자르기
  const headRaw = text.slice(0, HEAD)
  const headBoundaries = [
    headRaw.lastIndexOf("다.\n"),
    headRaw.lastIndexOf("라.\n"),
    headRaw.lastIndexOf("다. "),
    headRaw.lastIndexOf("라. "),
    headRaw.lastIndexOf(".\n\n"),
    headRaw.lastIndexOf("\n\n"),
    headRaw.lastIndexOf(". "),
  ]
  const headCutCandidate = Math.max(...headBoundaries)
  const headCut = headCutCandidate > HEAD * 0.5 ? headCutCandidate + 2 : HEAD
  const head = text.slice(0, headCut).trimEnd()

  // TAIL — 뒤에서 TAIL자 범위 중 문장 시작에서 자르기
  // ". " 경계는 소수점("1,234.00 원")/영문 약어("No. 3") 오탐 위험으로 제외.
  // 판례 한국어 특성상 "다." / "라." 종결어미가 지배적이라 이걸로 충분.
  const tailStart = text.length - TAIL
  const tailRaw = text.slice(tailStart)
  const tailBoundaryIdx = [
    tailRaw.indexOf("\n\n"),
    tailRaw.indexOf("다.\n"),
    tailRaw.indexOf("라.\n"),
    tailRaw.indexOf("다. "),
    tailRaw.indexOf("라. "),
    tailRaw.indexOf("한다. "),
  ]
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)[0]

  const tailFrom =
    tailBoundaryIdx !== undefined && tailBoundaryIdx < TAIL * 0.5
      ? tailStart + tailBoundaryIdx + 2
      : tailStart
  const tail = text.slice(tailFrom).trimStart()

  const omitted = text.length - head.length - tail.length
  if (omitted < MIN_SAVE) return text // 실질 절감 미달 시 원본

  return `${head}\n\n⋯ 중략 ${omitted.toLocaleString()}자 (full=true로 전문 조회) ⋯\n\n${tail}`
}

/**
 * 참조조문 densify
 *
 * 압축 전략:
 *   1) 조문명 괄호 설명 제거: "제390조(채무불이행과 손해배상)" → "제390조"
 *   2) 연속 공백/구분자 정리
 *
 * 조문명 괄호는 평균 15~30자 × 참조조문 5~10개 = 150~300자 절감 (40%).
 * 법령명 자체는 건드리지 않음 — LLM이 후속 도구 호출 시 파싱 필요.
 */
export function densifyLawRefs(text: string): string {
  if (!text) return text
  const original = text

  // 1) 조문 뒤 괄호 설명 제거
  //    "제390조(채무불이행과 손해배상)" → "제390조"
  //    "제1항(적용범위)" → "제1항"
  //    길이 3~40자 괄호만 타겟 (짧은 건 의미 있을 수 있음)
  let compact = text.replace(/(제\d+조(?:의\d+)?|제\d+항|제\d+호)\s*\([^)]{3,40}\)/g, "$1")

  // 2) 공백/구분자 정리
  compact = compact
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  // 실질 절감 없으면 원본
  if (compact.length >= original.length * 0.95) return original
  return compact
}

/**
 * 참조판례 densify
 *
 * 압축 전략:
 *   1) "선고" 생략: "대법원 2020. 3. 26. 선고 2018두56077 판결" → "대법원 2020.3.26. 2018두56077"
 *   2) 날짜 공백 압축: "2020. 3. 26." → "2020.3.26."
 *   3) "판결" 접미어 제거
 *   4) 구분자 정리
 */
export function densifyPrecedentRefs(text: string): string {
  if (!text) return text
  const original = text

  let compact = text
    // "선고" 앞뒤 공백 포함 제거
    .replace(/\s*선고\s*/g, " ")
    // "판결" 접미어 (공백 포함) 제거
    .replace(/\s*판결(?=[\s,/;]|$)/g, "")
    // 날짜 공백 압축: "2020. 3. 26." → "2020.3.26."
    // 경계 가드: 시작/공백/구분자/괄호 뒤의 4자리 연도만 대상
    // (문서 중간 "제2020." 같은 오탐 방지)
    .replace(/(^|[\s,(\[;/])(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\./g, "$1$2.$3.$4.")
    // "[동지] ", "[공보 생략]" 같은 부가표기 제거
    .replace(/\s*\[[^\]]{2,15}\]\s*/g, " ")
    // 연속 공백
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim()

  if (compact.length >= original.length * 0.95) return original
  return compact
}

/**
 * 본문에서 판시사항/판결요지가 반복 등장하면 제거
 *
 * 법제처 API 판례 응답은 `판시사항`, `판결요지`가 별도 필드로 나오지만
 * `판례내용`(전문) 앞쪽에 같은 내용이 반복되는 케이스가 많다.
 * 이미 상단에 렌더된 부분을 본문에서 제거하여 LLM 중복 소비 방지.
 *
 * 경계 탐지: 요약의 앞 80자로 시작점(idx)을, 요약의 끝 60자로 실제 종료점(endIdx)을
 * 탐지. 끝 매칭이 실패하면 보수적으로 s.length만큼만 제거하여 본문 다른 내용이
 * 같이 날아가는 사고 방지.
 */
export function stripRepeatedSummary(
  body: string,
  summaries: Array<string | undefined>
): string {
  if (!body) return body
  let result = body
  for (const s of summaries) {
    if (!s || s.length < 20) continue
    const trimmed = s.trim()
    const headLen = Math.min(80, trimmed.length)
    const head = trimmed.slice(0, headLen)
    if (head.length < 20) continue
    // 본문 앞 25% 안에서 동일 구간 탐지
    const zone = result.slice(0, Math.floor(result.length * 0.25))
    const idx = zone.indexOf(head)
    if (idx < 0) continue

    // 실제 종료점 탐지: 요약의 끝 60자를 본문에서 찾아 정확한 end 위치 계산
    const tailLen = Math.min(60, trimmed.length - headLen)
    let end: number
    if (tailLen >= 20) {
      const tail = trimmed.slice(trimmed.length - tailLen)
      // idx 이후 ±20% 범위 내에서만 tail 매칭 (다른 위치 오탐 방지)
      const searchZone = result.slice(idx, Math.min(idx + Math.floor(trimmed.length * 1.3), result.length))
      const tailIdxInZone = searchZone.indexOf(tail)
      end = tailIdxInZone >= 0
        ? idx + tailIdxInZone + tail.length
        : Math.min(idx + trimmed.length, result.length)
    } else {
      end = Math.min(idx + trimmed.length, result.length)
    }
    result = result.slice(0, idx) + result.slice(end)
  }
  return result
}

/**
 * 통합 후처리 축약 — unified-decisions.ts용
 *
 * 응답 포맷(도구별 getter 핸들러가 출력하는 텍스트)에서 알려진 긴 섹션
 * 헤더("이유:", "전문:", "회답:" 등)를 찾아 해당 섹션 본문에 compactBody 적용.
 *
 * 이미 compactBody가 적용된 도메인(precedent, constitutional, admin_appeal)은
 * unified-decisions.ts에서 skip 리스트로 관리되므로 여기서는 무조건 적용.
 *
 * 안전성:
 *   - 알려진 섹션 헤더가 없으면 원본 반환
 *   - 이미 "⋯ 중략 N자" 마커가 있으면 원본 반환 (이중 축약 방지)
 *   - 본문이 짧으면 compactBody가 원본 반환
 */
const KNOWN_SECTION_HEADERS = [
  "이유",
  "전문",
  "결정내용",
  "본문",
  "회답",
  "재결이유",
  "판결이유",
  "판례내용",
  "심판요지",
  "의결내용",
  "결정이유",
  "조문내용",
]

export function compactLongSections(text: string): string {
  if (!text || text.length < 1500) return text
  // 이미 축약된 경우 skip
  if (text.includes("⋯ 중략 ") && text.includes("(full=true로 전문 조회)")) return text

  const pattern = new RegExp(`\\n(${KNOWN_SECTION_HEADERS.join("|")}):\\n`, "g")
  let lastMatch: RegExpExecArray | null = null
  let m: RegExpExecArray | null
  while ((m = pattern.exec(text)) !== null) {
    lastMatch = m
  }
  if (!lastMatch) return text

  const sectionStart = lastMatch.index + lastMatch[0].length
  const body = text.slice(sectionStart)
  const compacted = compactBody(body, { full: false })
  if (compacted === body) return text
  return text.slice(0, sectionStart) + compacted
}
