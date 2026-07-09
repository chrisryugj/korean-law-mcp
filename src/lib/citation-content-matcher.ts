/**
 * 법령 조문 인용 내용 일치 검증
 *
 * LLM이 "제5조(목적)"로 인용한 내용이 실제 제5조의 본문/제목과 의미적으로
 * 일치하는가를 다층 매칭으로 판정한다. 존재 검증만으로는 "존재하는 조문에
 * 엉뚱한 내용 환각"을 잡지 못하기 때문.
 *
 * 레이어:
 *  L1 (exact)   — 정규화 후 연속 30자+ 공통 substring
 *  L2 (jaccard) — 문자 bigram Jaccard ≥ 0.25 (조사/어미 차이에 robust)
 *
 * ⚠️ LexDiff(lib/citation-content-matcher.ts)에서 이식한 순수함수. 수정 시
 *    원본 확인 필수 (CLAUDE.md 규칙 1: LexDiff 이식 코드 무단 수정 금지).
 *    단, normalizeLegalText의 zero-width/NBSP 제거는 유니코드 이스케이프가
 *    소스에 실제 제어문자로 박히는 것을 피하려 코드포인트 비교로 재구현함
 *    (동작 동일).
 */

export type MatchMethod = 'exact' | 'token-jaccard' | 'semantic' | 'mismatch'

export interface ContentMatchResult {
  matched: boolean
  method: MatchMethod
  score: number
  normalizedLenClaim: number
  normalizedLenActual: number
}

const MIN_EXACT_LEN = 30
// 문자 bigram jaccard의 실전 threshold. 완전히 관련 없는 법령 조문 간 값은
// 0.05~0.10 수준. 어순/조사 paraphrase로 공통 의미를 유지하면 0.25~0.50.
const JACCARD_THRESHOLD = 0.25

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮'

// zero-width: U+200B ZWSP, U+200C ZWNJ, U+200D ZWJ, U+FEFF BOM
function isZeroWidth(cp: number): boolean {
  return cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0xfeff
}

/**
 * 법률 텍스트 정규화:
 *  - 원문자 ①②③ → (1)(2)(3)
 *  - 「」, 『』 괄호 제거
 *  - 중점/구분자(·•) → 공백
 *  - whitespace 단일 공백
 *  - NBSP(U+00A0)/zero-width 제거·치환
 */
export function normalizeLegalText(s: string): string {
  if (!s) return ''
  // NBSP→공백, zero-width 제거 (코드포인트 비교 — 소스에 제어문자 미포함)
  let cleaned = ''
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number
    if (isZeroWidth(cp)) continue
    cleaned += cp === 0x00a0 ? ' ' : ch
  }
  return cleaned
    .replace(/[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮]/g, (m) => `(${CIRCLED.indexOf(m) + 1})`)
    .replace(/[「『]/g, '')
    .replace(/[」』]/g, '')
    .replace(/[·•]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 한국어는 교착어라 조사/어미가 단어에 붙어 word-level jaccard 신뢰도 낮음.
 * 문자 bigram(연속 두 글자)을 토큰으로 사용하면 "관세를" vs "관세" 같은
 * 미세한 어미 차이에도 overlap이 발생해 robust.
 * 구두점/공백은 bigram 생성 전에 제거.
 */
function tokenize(s: string): string[] {
  const compact = normalizeLegalText(s)
    .toLowerCase()
    .replace(/[\s,.?!;:()[\]{}"'`~<>/\\|+=*&^%$#@!-]+/gu, '')
  if (compact.length < 2) return compact ? [compact] : []
  const grams: string[] = []
  for (let i = 0; i < compact.length - 1; i++) {
    grams.push(compact.slice(i, i + 2))
  }
  return grams
}

/** Rolling-hash 없이도 실용적으로 충분한 최장 공통 substring 길이 (small inputs) */
function longestCommonSubstringLen(a: string, b: string): number {
  if (!a || !b) return 0
  // DP O(n*m). 조문 본문은 일반적으로 수천자 이내 → 실사용에서 문제없음.
  // 메모리 절감 위해 이전 행만 보관.
  const n = a.length, m = b.length
  if (n === 0 || m === 0) return 0
  let prev = new Uint16Array(m + 1)
  let curr = new Uint16Array(m + 1)
  let best = 0
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a.charCodeAt(i - 1) === b.charCodeAt(j - 1)) {
        const v = prev[j - 1] + 1
        curr[j] = v
        if (v > best) best = v
      } else {
        curr[j] = 0
      }
    }
    ;[prev, curr] = [curr, prev]
    curr.fill(0)
  }
  return best
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

/**
 * LLM claim 텍스트와 실제 조문 본문/제목을 비교해 일치 여부 판정.
 * claim 또는 actual이 비어있으면 matched=false.
 */
export function matchCitationContent(claim: string, actual: string): ContentMatchResult {
  const c = normalizeLegalText(claim)
  const a = normalizeLegalText(actual)

  if (!c || !a) {
    return { matched: false, method: 'mismatch', score: 0, normalizedLenClaim: c.length, normalizedLenActual: a.length }
  }

  // 과도하게 짧은 claim은 exact만으로 판정 곤란 — jaccard도 low. actual에 포함만 되면 통과.
  if (c.length < MIN_EXACT_LEN) {
    if (a.includes(c)) {
      return { matched: true, method: 'exact', score: 1, normalizedLenClaim: c.length, normalizedLenActual: a.length }
    }
  }

  // L1: 연속 substring
  const lcs = longestCommonSubstringLen(c, a)
  if (lcs >= MIN_EXACT_LEN) {
    return {
      matched: true,
      method: 'exact',
      score: Math.min(1, lcs / Math.max(1, c.length)),
      normalizedLenClaim: c.length,
      normalizedLenActual: a.length,
    }
  }

  // L2: token jaccard
  const tc = new Set(tokenize(c))
  const ta = new Set(tokenize(a))
  const jscore = jaccard(tc, ta)
  if (jscore >= JACCARD_THRESHOLD) {
    return {
      matched: true,
      method: 'token-jaccard',
      score: jscore,
      normalizedLenClaim: c.length,
      normalizedLenActual: a.length,
    }
  }

  return {
    matched: false,
    method: 'mismatch',
    score: Math.max(lcs / Math.max(1, c.length), jscore),
    normalizedLenClaim: c.length,
    normalizedLenActual: a.length,
  }
}
