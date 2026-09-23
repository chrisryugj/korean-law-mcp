/**
 * 별표/서식 선택 — 사용자가 준 힌트(번호·제목 키워드)로 목록에서 항목을 고른다.
 *
 * 같은 번호에 별표와 서식이 공존하기도 해서 번호만으로는 고를 수 없다 — 그 판단이 여기다.
 * 표기 문법("별표4" · "별표 제4호" · "별표 1의2")은 lib/annex-notation 이 단일 원본이다.
 */

import { ANNEX_KEYWORDS, ANNEX_NOTATION_RE, fromAnnexCode, parseAnnexNumber, toAnnexCode } from "../lib/annex-notation.js"
import { escapeRegex } from "../lib/escape-regex.js"

/** 법제처 별표/서식 API 응답 개별 항목 */
export interface AnnexItem {
  별표번호?: string
  별표명?: string
  별표종류?: string
  별표서식파일링크?: string
  별표서식PDF파일링크?: string
  별표파일링크?: string
  관련법령명?: string
  관련자치법규명?: string
  관련행정규칙명?: string
  자치법규시행일자?: string
  공포일자?: string
  소관부처?: string
  소관부처명?: string
  지자체기관명?: string
  관련법령일련번호?: string
}

/**
 * 모법명 추출 (시행규칙/시행령 제거)
 * "여권법 시행규칙" → "여권법", "관세법 시행령" → "관세법"
 */
export function extractParentLawName(lawName: string): string | null {
  // 2026-09-23 리뷰 C2: 종전 `\s*(시행규칙|시행령)$` 는 공백 덩어리의 시작 위치마다 끝까지 훑어
  // 제곱이었다(공백 10만 자 13.4초). 접미어만 끝에서 찾고 그 앞 공백은 trimEnd 로 걷는다.
  // `\s` 와 trimEnd 는 같은 공백 집합이라 결과는 같다.
  const suffix = /(?:시행규칙|시행령)$/.exec(lawName)
  if (!suffix) return null
  const cleaned = lawName.slice(0, suffix.index).trimEnd()
  return cleaned !== lawName ? cleaned : null
}

/**
 * 별표 선택값으로 항목 매칭.
 *
 * 자치법규 등에서 [별표 N]과 [별지 제N호서식]이 동일 별표번호(bylSeq)를 공유하는 경우가
 * 있어, 번호만으로 find() 하면 목록 순서상 먼저 오는 항목(주로 서식)이 잘못 선택된다.
 * (예: 서울특별시 건축 조례 — [별표4] 대지안의 공지기준 / [별지 제4호서식] 공개공지 관리대장이
 *  모두 별표번호 000400을 가짐.)
 * 따라서 번호가 일치하는 후보를 모두 모은 뒤, knd(별표/서식 의도)로 별표종류를 구분해
 * 올바른 항목을 고른다. knd 미지정 시 표(별표)를 서식보다 우선한다.
 */
export function findMatchingAnnex(
  annexList: AnnexItem[],
  annexSelector: string,
  knd?: string
): AnnexItem | undefined {
  const selectorCandidates = buildSelectorCandidates(annexSelector)
  const selectorNumbers = extractSelectorNumbers(annexSelector)

  // 번호/제목으로 매칭되는 후보 "전체" 수집 (find → filter)
  const matches = annexList.filter((annex: AnnexItem) => {
    const annexNum = String(annex.별표번호 || "").trim()
    const annexTitle = String(annex.별표명 || "")
    if (annexNum && selectorCandidates.has(annexNum)) {
      return true
    }
    return selectorNumbers.some((num) => titleMatchesAnnexNumber(annexTitle, num))
  })

  if (matches.length === 0) {
    // 번호가 안 맞아도 별표가 유일 1건이면 그 별표를 정답으로 폴백.
    // 여권법 시행령 '수수료 및 사무의 대행에 드는 비용(제39조 관련)'처럼 번호 없는 단일 별표는
    // 모델이 "별표1" 등 임의 번호로 불러도 매칭 0건 → NOT_FOUND로 새는 대신 유일 별표를 반환.
    // 단, 가지번호(1의2) 요청은 폴백 금지 — 유일 항목이 본번(별표 1)이어도 다른 별표라서,
    // 위 buildSelectorCandidates가 막은 "별표 1 무음 오선택"이 여기로 재개방되면 안 된다.
    if (annexList.length === 1 && parseAnnexNumber(annexSelector)?.sub == null) {
      return annexList[0]
    }
    return undefined
  }
  if (matches.length === 1) return matches[0]

  // 별표번호 충돌 → 별표종류("별표"/"서식")로 구분
  const isForm = (a: AnnexItem) => /서식/.test(String(a.별표종류 || ""))
  const isTable = (a: AnnexItem) => /별표/.test(String(a.별표종류 || ""))

  if (knd === "2" || knd === "4") {
    // 서식을 명시적으로 요청
    return matches.find(isForm) || matches[0]
  }
  if (knd === "1" || knd === "3") {
    // 별표를 명시적으로 요청
    return matches.find(isTable) || matches[0]
  }
  // knd 미지정/전체(5): 표(별표)를 서식보다 우선
  return matches.find(isTable) || matches[0]
}

export function buildSelectorCandidates(selector: string): Set<string> {
  const candidates = new Set<string>()
  const trimmed = selector.trim()

  if (!trimmed) {
    return candidates
  }

  candidates.add(trimmed)

  // 6자리 입력은 이미 정본 코드(AAAABB)다. 자연어 번호로 다시 읽으면 "000102"
  // (별표 1의2)가 parseInt를 거쳐 "102" 후보를 만들어 무관한 별표 102를 집는다 —
  // 코드로 해독해 정본 후보만 생성한다. 가지번호 코드는 아래 원칙 그대로 본번 후보 금지.
  if (/^\d{6}$/.test(trimmed)) {
    const decoded = fromAnnexCode(trimmed)
    if (decoded) {
      if (decoded.sub === 0) {
        candidates.add(String(decoded.main))
        candidates.add(String(decoded.main).padStart(6, "0"))
      }
      return candidates
    }
  }

  const rawDigits = trimmed.match(/\d{1,6}/)?.[0]
  const parsed = parseAnnexNumber(trimmed)
  if (!rawDigits || !parsed) {
    return candidates
  }

  // 가지번호(별표 1의2)가 있으면 6자리 코드가 유일한 정답이다. 본번 후보까지 함께
  // 내면 가지 별표가 목록에 없을 때 **별표 1이 조용히 선택된다** — NOT_FOUND 보다
  // 나쁜 실패다. lawName 경로(parseLawNameAndHint)와 같은 코드로 수렴시킨다.
  if (parsed.sub != null) {
    candidates.add(toAnnexCode(parsed.main, parsed.sub))
    return candidates
  }

  candidates.add(rawDigits)
  candidates.add(String(parsed.main))

  // 법제처 별표번호는 관행적으로 000100, 000200 형식이 많아 둘 다 허용
  candidates.add(String(parsed.main).padStart(6, "0"))
  if (rawDigits.length <= 3) {
    candidates.add(toAnnexCode(parsed.main, 0))
  }

  return candidates
}

export function extractSelectorNumbers(selector: string): string[] {
  const rawDigits = selector.match(/\d{1,6}/)?.[0]

  // 6자리는 코드(AAAABB)로 먼저 읽는다. 자연어 파서에 그냥 넘기면 `001712`가
  // `1712`가 되어 제목 `[별지 제17호의12]`를 놓친다 — 응답이 알려 준 코드를
  // 사용자가 되돌려주는 왕복 경로가 여기서 끊겼다(N7).
  if (rawDigits && rawDigits.length === 6 && rawDigits === selector.trim()) {
    const decoded = fromAnnexCode(rawDigits)
    if (decoded) {
      return decoded.sub > 0
        ? [`${decoded.main}의${decoded.sub}`]
        : Array.from(new Set([String(decoded.main)]))
    }
  }

  const parsed = parseAnnexNumber(selector)
  if (!rawDigits || !parsed) {
    return []
  }

  // 제목 매칭도 가지번호를 지킨다 — "1"로 돌려주면 "[별표1]"이 잡힌다
  if (parsed.sub != null) {
    return [`${parsed.main}의${parsed.sub}`]
  }

  const numbers = new Set<string>([String(parsed.main)])

  if (rawDigits.length === 6 && parsed.main % 100 === 0) {
    numbers.add(String(parsed.main / 100))
  }

  return Array.from(numbers)
}

function titleMatchesAnnexNumber(title: string, annexNumber: string): boolean {
  // 법제처 제목은 가지번호에 호를 중위로 끼운다 — "[별지 제59호의2서식]" (#150).
  // selector의 "59의2"를 리터럴로 찾으면 이 표기를 통째로 놓치므로, 가지번호는
  // 본번 뒤 호를 허용하는 패턴으로 푼다. 본번은 종전 리터럴 그대로다.
  const parsed = parseAnnexNumber(annexNumber)
  const numberSrc = parsed?.sub != null
    ? `${parsed.main}\\s*(?:호)?\\s*의\\s*${parsed.sub}`
    : escapeRegex(annexNumber)
  const kw = ANNEX_KEYWORDS.join("|")
  // 어휘는 annex-notation 단일 원본에서 온다 — 여기 `별표|서식`만 적어 두면
  // 이 파일이 대표 사례로 드는 `[별지 제4호서식]` 제목이 제 번호에 안 걸린다.
  // 꼬리의 `서식`까지 받는 이유도 그 표기다(번호가 낱말 사이에 낀다).
  const patterns = [
    new RegExp(`\\[\\s*(?:${kw})\\s*(?:제)?\\s*${numberSrc}\\s*(?:호)?\\s*(?:서식)?\\s*\\]`),
    new RegExp(`(?:${kw})\\s*제?\\s*${numberSrc}\\s*(?:호)?`),
  ]

  if (patterns.some((pattern) => pattern.test(title))) {
    return true
  }

  // 묶음 별표 범위 매칭: "[별표1~5]", "[별표 1 ~ 5]" 등
  const num = Number.parseInt(annexNumber, 10)
  if (!Number.isNaN(num)) {
    const rangePattern = /별표\s*(\d+)\s*[~\-]\s*(\d+)/g
    let match: RegExpExecArray | null
    while ((match = rangePattern.exec(title)) !== null) {
      const start = Number.parseInt(match[1], 10)
      const end = Number.parseInt(match[2], 10)
      if (num >= start && num <= end) {
        return true
      }
    }
  }

  return false
}


/**
 * 묶음 별표 여부 판별: "[별표1~5]" 같은 범위 표기가 있는지.
 *
 * `별표` 전용으로 둔다 — 2026-08-17 licbyl 실호출(출입국관리법 시행규칙 100건 /
 * 여권법 시행규칙 12건)에서 **범위 표기 제목 0건**이었고, 그 표본의 licbyl 제목은
 * 애초에 `별표`·`별지` 접두어를 달고 오지 않았다(묶음 판정은 자치법규·행정규칙 제목에서
 * 발화한다). 즉 `별지` 묶음의 실재를 확인하지 못했으므로 근거 없이 어휘를 넓히지 않는다.
 * 반례가 관측되면 아래 `extractBundledSection` 처럼 ANNEX_KEYWORDS 기반으로 올릴 것.
 */
export function isBundledAnnex(annexTitle: string): boolean {
  return /별표\s*\d+\s*[~\-]\s*\d+/.test(annexTitle)
}

/** 묶음 문서 안의 섹션 표제(`## [별표 3]`)를 읽는 정규식 — 어휘는 단일 원본에서 */
const BUNDLED_HEADING_SRC =
  `##\\s*\\[\\s*(?:${ANNEX_KEYWORDS.join("|")})\\s*(?:제)?\\s*`

/**
 * 묶음 별표 마크다운에서 특정 섹션만 추출.
 *
 * 번호부는 `parseAnnexNumber` 로 읽는다 — `parseInt("17의12")` 는 **17** 이라
 * 가지번호를 물었는데 옆 번호(별표 17) 섹션을 조용히 돌려줬다. 묶음 문서는 그 옆
 * 번호를 실제로 담고 있으므로 오답이 정답처럼 보인다(N7 짝 연산의 마지막 자리).
 */
export function extractBundledSection(markdown: string, targetNum: string): string | null {
  const parsed = parseAnnexNumber(targetNum)
  if (!parsed) return null

  // 묶음 표제도 호 중위 표기("## [별표 제1호의2]")로 온다 — 본번 뒤 호를 허용 (#150)
  const label = parsed.sub != null
    ? `${parsed.main}\\s*(?:호)?\\s*의\\s*${parsed.sub}`
    : String(parsed.main)
  const pattern = new RegExp(
    `(${BUNDLED_HEADING_SRC}${label}\\s*(?:호)?\\s*(?:서식)?\\s*\\][\\s\\S]*?)(?=${BUNDLED_HEADING_SRC}\\d|$)`
  )
  return markdown.match(pattern)?.[1].trim() ?? null
}

/** 묶음 문서가 담고 있는 섹션 표제 목록 — 못 찾았을 때 무엇이 있는지 알려 준다 */
export function listBundledSections(markdown: string): string[] {
  const re = new RegExp(`${BUNDLED_HEADING_SRC}([^\\]]{1,20})\\]`, "g")
  const found: string[] = []
  for (const m of markdown.matchAll(re)) {
    const label = m[1].trim()
    if (label && !found.includes(label)) found.push(label)
  }
  return found
}

/** 요청한 번호가 가지번호(의N)인가 — `extractSelectorNumbers` 가 낸 정규 표기 기준 */
export function isBranchNumber(selectorNumber: string): boolean {
  return parseAnnexNumber(selectorNumber)?.sub != null
}

/**
 * 관련법규명으로 annexList 필터링: 사용자 쿼리와 가장 일치하는 조례 우선
 * 여러 조례(예: "광진구의회 복무 조례" vs "광진구 복무 조례")가 혼합된 경우 분리
 */
export function filterByRelatedLawName(annexList: AnnexItem[], queryName: string): AnnexItem[] {
  if (annexList.length <= 1) return annexList

  // 쿼리에서 단어 추출
  const queryWords = queryName.split(/\s+/).filter((w) => w.length > 0)
  if (queryWords.length === 0) return annexList

  // 각 항목에 관련법규명 단어 매칭 점수 부여
  const scored = annexList.map((annex: AnnexItem) => {
    // 관련행정규칙명도 본다 — 빠뜨리면 admbyl 폴백 결과가 전부 0점이라 필터를 그대로
    // 통과해, 요청 법령명을 부분 포함하는 무관 행정규칙의 별표가 함께 섞여 나온다
    const relatedName = String(annex.관련자치법규명 || annex.관련법령명 || annex.관련행정규칙명 || "")
      .replace(/<[^>]+>/g, "")   // HTML 태그 제거
    const relatedWords = relatedName.split(/\s+/).filter((w) => w.length > 0)
    // 쿼리 단어가 관련법규명에 정확히 포함되는 수
    const score = queryWords.filter((qw) => relatedWords.includes(qw)).length
    return { annex, score }
  })

  const maxScore = Math.max(...scored.map((s) => s.score))
  if (maxScore === 0) return annexList

  // 최고 점수 항목만 필터 (동점 허용)
  const best = scored.filter((s) => s.score === maxScore).map((s) => s.annex)
  return best.length > 0 ? best : annexList
}

// ─── query 필터 (#94) ─────────────────────────────────

/**
 * query에서 별표명 검색에 쓸 키워드를 뽑는다.
 * 번호 힌트("별표28")는 selector 쪽에서 이미 쓰이므로 여기서는 제외하고,
 * 조사·군더더기("기준", "관련")까지 붙은 자연어를 그대로 토큰으로 쓴다.
 */
/** 테스트 도달용 공개 — 프로덕션 소비자는 이 파일 안뿐이다 (#143) */
export function annexQueryKeywords(query?: string): string[] {
  if (!query) return []
  // 표기 문법은 annex-notation 단일 원본이 쥔다 — 여기에 사본을 두면 어휘가 또 갈린다
  // 2026-09-23 리뷰 C2: ANNEX_NOTATION_RE 의 선두 `\s*` 는 공백 덩어리에서 제곱이었다(10만 자 6.3초).
  // 공백을 먼저 한 칸으로 접는다. 토큰은 어차피 공백으로 나누므로 결과는 같다.
  return query
    .replace(/\s+/g, " ")
    .replace(ANNEX_NOTATION_RE, " ")
    .split(/[\s,·ㆍ]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
}

// ─── 조문 맥락 (#133) ─────────────────────────────────

/**
 * 별표 제목의 위임 조문 표기. 법제처 별표명은 `수수료(제39조 관련)`처럼 근거 조문을
 * 괄호에 달고 오므로, 조문 동반 질의("관세법 제38조 별표 2")의 조문 슬롯을 여기서 맞춘다.
 */
const DELEGATION_RE = /제\s*(\d+)\s*조(?:\s*의\s*(\d+))?\s*(?:관련|에?\s*따른)/g

/** 별표 제목이 근거로 밝힌 조문들 ("제38조" 정규 표기) */
export function annexDelegatingArticles(annex: AnnexItem): string[] {
  const title = String(annex.별표명 || "").replace(/<[^>]+>/g, "")
  const found: string[] = []
  for (const m of title.matchAll(DELEGATION_RE)) {
    const jo = m[2] ? `제${m[1]}조의${m[2]}` : `제${m[1]}조`
    if (!found.includes(jo)) found.push(jo)
  }
  return found
}

/**
 * 조문으로 목록을 좁힌다. `filterByAnnexQuery`와 같은 계약이다 — 한 건도 못 맞히면
 * 원본을 돌려주고 `matched=false`로 알린다. 조용히 전체를 주면 "그 조문이 위임한
 * 별표"로 오인되고, 조용히 0건을 주면 "그런 별표는 없다"는 오답이 된다.
 */
export function filterByArticle(
  annexList: AnnexItem[],
  jo?: string
): { list: AnnexItem[], article?: string, matched: boolean } {
  const article = jo ? normalizeArticleLabel(jo) : undefined
  if (!article) return { list: annexList, matched: true }

  const hits = annexList.filter((a) => annexDelegatingArticles(a).includes(article))
  return hits.length > 0
    ? { list: hits, article, matched: true }
    : { list: annexList, article, matched: false }
}

/** "38" · "제38조" · "38조의2" → "제38조" / "제38조의2" */
export function normalizeArticleLabel(raw: string): string | undefined {
  const m = raw.match(/(\d+)\s*(?:조)?(?:\s*의\s*(\d+))?/)
  if (!m) return undefined
  return m[2] ? `제${m[1]}조의${m[2]}` : `제${m[1]}조`
}

/**
 * 별표명이 키워드를 모두 담고 있는지. 전부 만족(AND)을 요구해야
 * "운전면허 취소"가 "운전면허" 하나만 걸린 수십 건으로 번지지 않는다.
 */
function matchesAnnexKeywords(annex: AnnexItem, keywords: string[]): boolean {
  if (keywords.length === 0) return true
  const title = String(annex.별표명 || "").replace(/<[^>]+>/g, "")
  return keywords.every((k) => title.includes(k))
}

/**
 * query 키워드로 목록을 좁힌다. 한 건도 못 맞히면 원본을 돌려주고 matched=false로
 * 알린다 — 조용히 전체 목록을 주면 "필터가 동작한 결과"로 오인된다(#94의 증상 자체).
 */
export function filterByAnnexQuery(
  annexList: AnnexItem[],
  query?: string
): { list: AnnexItem[], keywords: string[], matched: boolean } {
  const keywords = annexQueryKeywords(query)
  if (keywords.length === 0) return { list: annexList, keywords, matched: true }

  const hits = annexList.filter((a) => matchesAnnexKeywords(a, keywords))
  return hits.length > 0
    ? { list: hits, keywords, matched: true }
    : { list: annexList, keywords, matched: false }
}
