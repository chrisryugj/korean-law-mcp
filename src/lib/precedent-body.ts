/**
 * 판례 본문 판독 — 판시사항 발췌와 변경·폐기 신호 스캔 (cite_check 지원)
 *
 * 사건명(예: "손해배상(기)")만으로는 판결의 정체성을 알 수 없다. 생사 판정만 받아든
 * 소비자(LLM)는 "강제동원 손해배상 전원합의체"를 "조약 해석 판례"로 소개하게 된다(#95).
 * 판시사항 한두 줄이면 교정되므로, 전문을 붙이는 대신 그 필드만 짧게 발췌한다.
 */
import { cleanHtml } from "./article-parser.js"
import { escapeRegex } from "./escape-regex.js"

/** 변경·폐기 treatment 신호 패턴 (대법원 전원합의체 판례변경 상투 문구) */
const CHANGE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /변경하기로\s*(?:한다|하면서|함|하였)/, label: "판례 변경 선언" },
  { re: /폐기하기로|폐기한다|폐기되었/, label: "판례 폐기 선언" },
  { re: /더\s*이상\s*유지(?:될\s*수\s*없|하기\s*어렵)/, label: "선례 유지 불가 판시" },
  { re: /배치되는\s*범위\s*에?서?\s*(?:이를\s*)?(?:모두\s*)?변경/, label: "저촉 범위 변경" },
]

/**
 * 법제처 JSON 필드는 문자열·배열·`{"#text":…}` 중 무엇으로도 온다(CLAUDE.md 규칙 6).
 * String()으로 뭉개면 판시사항이 "[object Object]"로 출력된다 — 법률 도구에서는 침묵보다 나쁘다.
 */
export function fieldText(value: unknown): string {
  if (value == null) return ""
  if (Array.isArray(value)) return value.map(fieldText).filter(Boolean).join(" ")
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>
    const wrapped = rec["#text"] ?? rec._
    if (wrapped != null) return fieldText(wrapped)
    // 래퍼 키 이름이 다를 수 있다. 값에서 문자열만 모아 잇는다 — 빈 문자열로 뭉개면
    // 호출부의 `if (!body) return` 가드를 통과하는 "[object Object]"보다는 낫지만,
    // 내용을 통째로 잃는 것도 조용한 실패다.
    return Object.values(rec).map(fieldText).filter(Boolean).join(" ")
  }
  return String(value).trim()
}

/**
 * 대상 판례의 판시사항(없으면 판결요지)을 1~2줄로 발췌.
 * 전문(판례내용)은 절대 붙이지 않는다 — 토큰이 폭증하고 cite_check의 목적도 아니다.
 */
export function extractHolding(
  detail: Record<string, unknown> | null,
  maxChars = 240
): { label: string; text: string } | undefined {
  const 판시사항 = fieldText(detail?.판시사항)
  const source = 판시사항
    ? { label: "판시사항", raw: 판시사항 }
    : fieldText(detail?.판결요지)
      ? { label: "판결요지", raw: fieldText(detail?.판결요지) }
      : undefined
  if (!source) return undefined

  const clean = cleanHtml(source.raw).replace(/\s+/g, " ").trim()
  if (!clean) return undefined
  const text = clean.length > maxChars
    ? `${clean.slice(0, maxChars).replace(/\s+\S*$/, "")}…`
    : clean
  return { label: source.label, text }
}

/**
 * 본문에서 대상 판례 언급 주변 ±window 자 내 변경 문구 감지 + 인용 맥락 추출.
 *
 * 판결문 관행 주의: 사건번호를 한 번 쓰고 "(이하 '2008년 전원합의체 판결'이라 한다)"로
 * 별칭을 정의한 뒤, 정작 변경 선언은 별칭으로 한다 (예: 2018다248626 → 2007다27670 변경).
 * 사건번호만 추적하면 false negative — 별칭 정의를 감지해 별칭 출현 지점도 함께 스캔한다.
 */
export function scanTreatment(body: string, targetCaseNo: string, window = 250): {
  changeSignals: string[]
  context?: string
} {
  const clean = cleanHtml(body).replace(/\s+/g, " ")
  // 사건번호는 본문에서 "2013다61381" 또는 "2013 다 61381" 형태
  const targetSrc = `(?<!\\d)${escapeRegex(targetCaseNo).replace(/(\d)([가-힣]+)(\d)/, "$1\\s*$2\\s*$3")}(?!\\d)`
  const refIndices: number[] = []
  let m: RegExpExecArray | null

  const targetRe = new RegExp(targetSrc, "g")
  while ((m = targetRe.exec(clean)) !== null) refIndices.push(m.index)

  // 별칭 정의: "…2007다27670 전원합의체 판결(이하 '2008년 전원합의체 판결'이라 한다)"
  const aliasDefRe = new RegExp(
    targetSrc + "[^(]{0,40}\\(\\s*이하\\s*[‘'\"“]?([^’'\"”)]{2,40}?)[’'\"”]?\\s*(?:이?라\\s*고?\\s*)?한다",
    "g"
  )
  const aliases = new Set<string>()
  while ((m = aliasDefRe.exec(clean)) !== null) aliases.add(m[1].trim())
  for (const alias of aliases) {
    const aliasRe = new RegExp(escapeRegex(alias), "g")
    while ((m = aliasRe.exec(clean)) !== null) refIndices.push(m.index)
  }

  const signals = new Set<string>()
  let context: string | undefined
  for (const idx of refIndices.sort((a, b) => a - b)) {
    const win = clean.slice(Math.max(0, idx - window), Math.min(clean.length, idx + window))
    if (!context) context = win.slice(0, 300)
    for (const { re, label } of CHANGE_PATTERNS) {
      if (re.test(win)) {
        signals.add(label)
        context = win.slice(0, 300)  // 신호 잡힌 맥락을 우선 노출
      }
    }
  }
  return { changeSignals: [...signals], context }
}
