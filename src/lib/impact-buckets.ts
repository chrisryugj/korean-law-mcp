/**
 * impact_map 버킷 가공 — 검색 결과를 항목 단위로 쪼개 조문 경계로 거르고 집계한다 (#90)
 *
 * 5개 하위 검색(판례·헌재·해석례·행정심판·자치법규)의 렌더 형식은 모두 같다:
 *   `[일련번호] 제목` + 들여쓴 `키: 값` 줄들 + 빈 줄.
 * 줄 단위로 훑으면 제목과 사건번호가 서로 다른 항목으로 흩어져 경계 판정을 걸 수 없다.
 * 항목 블록으로 묶은 뒤에야 "이 항목이 어느 조문 것인가"를 물을 수 있다.
 */
import { classifyArticleRefs, LAW_NAME_SUFFIX_PATTERN, type ArticleAnchor } from "./article-anchor.js"

export interface BucketStat {
  /** 조문 경계를 통과한 건수 — 이 도구가 사실로 주장할 수 있는 유일한 수 */
  verified: number
  /** 업스트림 키워드 검색이 보고한 총건수. 유사 조번호·타 법령이 섞인 상한값이다 */
  searchCount: number
  topItems: string[]
  /** 조번호 불일치로 제외한 건수 */
  excludedArticle: number
  /** 조번호는 맞으나 법령이 확정적으로 달라 제외한 건수.
   *  합산 단일 카운터는 제외 사유를 전부 "조문 불일치"로 둔갑시켰다 (#150) */
  excludedLaw: number
  /** 표본이 업스트림 검색 건수를 전부 덮었는지 */
  covered: boolean
  /** 법령명까지 확정 일치한 건수 */
  lawConfirmed: number
  /** 조번호는 맞으나 법령명 판정 불가로 보류한 건수 (제외하지 않고 유지) */
  lawHeld: number
  /** 하위 검색 자체가 실패했다 (업스트림 오류·예산 소진 등). 이때의 0은 "인용 없음"이 아니라 "모름"이다 */
  failed?: boolean
}

const EMPTY: BucketStat = {
  verified: 0, searchCount: 0, topItems: [], excludedArticle: 0, excludedLaw: 0, covered: true, lawConfirmed: 0, lawHeld: 0,
}

/**
 * 조회 실패 버킷 (2026-09-23 리뷰 B#5).
 * 종전엔 isError 를 전부 EMPTY(covered:true)로 접어 "0건"으로 찍었다. 하위 검색이 5xx·HTML 안내
 * 페이지·예산 소진으로 실패해도 "이 조문을 인용한 판례 0건"이라는 사실 주장이 되어 나갔다.
 */
const FAILED: BucketStat = { ...EMPTY, covered: false, failed: true }

// 사건명이 비어 `[111] `만 오는 항목도 항목이다. `\S`를 요구하면 그 항목과 딸린
// 사건번호 줄이 통째로 사라져 표본 수가 줄고 covered 판정까지 뒤집힌다.
const ITEM_HEADER_RE = /^\[\d+\]/
// 5개 렌더러가 실제로 내보내는 식별 키만 적는다 — precedents/constitutional-decisions/
// admin-appeals는 `사건번호:`, interpretations는 `해석례번호:`, ordinance-search는 `지자체:`.
// 없는 키를 넣어두면 죽은 분기가 조용히 쌓인다.
const ITEM_DETAIL_RE = /^(사건번호|해석례번호|지자체)\s*:\s*(.+)$/

function summarizeItem(block: string[]): string {
  const header = block[0].replace(/\s*\([^)]*OC=[^)]*\)\s*/g, "").slice(0, 110)
  for (const line of block.slice(1)) {
    const m = ITEM_DETAIL_RE.exec(line)
    if (m) return `${header} · ${m[1]}: ${m[2]}`.slice(0, 150)
  }
  return header
}

/** 렌더된 검색 결과를 항목 블록으로 분해. 빈 줄이 항목 경계다(후속 안내문 혼입 차단). */
function splitItemBlocks(text: string): string[][] {
  const blocks: string[][] = []
  let current: string[] | null = null
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (ITEM_HEADER_RE.test(line)) {
      current = [line]
      blocks.push(current)
    } else if (current) {
      if (!line) current = null
      else current.push(line)
    }
  }
  return blocks
}

/**
 * 도구 결과에서 카운트 + 상위 항목 추출. 조문 경계에 어긋나는 항목은 버린다.
 * 조문 표기가 없는 항목(사건명만 있는 판례 등)은 판정 불가이므로 살린다 —
 * 앵커를 이유로 정상 결과를 죽이면 오탐을 오탐으로 갚는 셈이다.
 */
export function parseBucket(
  result: { text: string; isError: boolean },
  anchor: ArticleAnchor,
  maxItems: number
): BucketStat {
  // 0건 응답은 각 검색 도구가 [NOT_FOUND] 로 표시한다. 그 표시 없는 isError 는 "검색 실패"다 (B#5)
  if (result.isError && !/\[NOT_FOUND\]/.test(result.text || "")) return FAILED
  if (result.isError || !result.text || !result.text.trim()) return EMPTY
  if (/\[NOT_FOUND\]/.test(result.text)) return EMPTY

  const cm = result.text.match(/총\s*(\d+)\s*건/)
  const searchCount = cm ? Number.parseInt(cm[1], 10) : 0

  const blocks = splitItemBlocks(result.text)
  if (blocks.length === 0) {
    // 알려진 5개 렌더 형식이 아니면 항목을 만들지 않는다 — 검증 못 한 것을 인용하지 않기 위해.
    return { ...EMPTY, searchCount, covered: false }
  }

  const judged = blocks.map(b => ({ block: b, verdict: classifyArticleRefs(b.join(" "), anchor) }))
  const kept = judged.filter(j => j.verdict !== "mismatch" && j.verdict !== "law-mismatch")
  return {
    verified: kept.length,
    searchCount,
    topItems: kept.slice(0, maxItems).map(j => summarizeItem(j.block)),
    excludedArticle: judged.filter(j => j.verdict === "mismatch").length,
    excludedLaw: judged.filter(j => j.verdict === "law-mismatch").length,
    covered: blocks.length >= searchCount,
    lawConfirmed: judged.filter(j => j.verdict === "match").length,
    // silent(조문 표기 없음)도 법령명으로 확인된 바 없으므로 보류로 센다.
    lawHeld: judged.filter(j => j.verdict === "hold" || j.verdict === "silent").length,
  }
}

/**
 * 버킷 한 줄. **주장하는 수는 항상 경계 통과 건수(verified)** 다.
 * 표본이 검색 결과를 못 덮으면 업스트림 총건수를 함께 적되, 그것이 검증된 수가 아님을
 * 문장으로 못박는다 — 예전에는 이 자리에 총건수만 적혀서 유사 조번호가 섞인 수를
 * "이 조문을 인용한 건수"로 단정했다(#90의 오탐이 수치에 그대로 남아 있었다).
 */
/** 제외 사유를 축별로 적는다 — 합산해 "조문 불일치"로만 적으면 타 법령 제외가 조문 문제로 둔갑한다 (#150) */
export function exclusionPhrase(stat: Pick<BucketStat, "excludedArticle" | "excludedLaw">): string {
  const parts: string[] = []
  if (stat.excludedArticle > 0) parts.push(`조문 불일치 ${stat.excludedArticle}건`)
  if (stat.excludedLaw > 0) parts.push(`다른 법령 ${stat.excludedLaw}건`)
  return parts.join("·")
}

export function bucketLine(stat: BucketStat): string {
  if (stat.failed) return `조회 실패 (업스트림 오류로 확인 못 함, 0건이 아님)`
  const phrase = exclusionPhrase(stat)
  const excl = phrase ? ` (${phrase} 제외)` : ""
  if (stat.covered) return `${stat.verified}건${excl}`
  const sampled = stat.verified + stat.excludedArticle + stat.excludedLaw
  return `${stat.verified}건 확인${excl} / 검색 ${stat.searchCount}건 — 표본 ${sampled}건만 경계 확인, 나머지는 미확인`
}

/**
 * 법령명 축 요약. 판정 불가(미등록 약칭·표기 변형)는 제외하지 않고 보류로 유지하므로,
 * 남은 항목 전부가 이 법령의 것이라고 읽히지 않게 확정/보류를 나눠 밝힌다 (#116).
 */
export function lawMatchNote(stats: BucketStat[]): string {
  const confirmed = stats.reduce((sum, s) => sum + s.lawConfirmed, 0)
  const held = stats.reduce((sum, s) => sum + s.lawHeld, 0)
  return `ℹ️ 법령명 대조: 확정 ${confirmed}건 / 보류 ${held}건 (보류는 약칭·표기 변형으로 판정 불가 — 제외하지 않고 유지하므로 타 법령이 섞였을 수 있음)`
}

/** 조문 본문에서 인용된 다른 법령 추출 */
export function extractCitedLaws(articleText: string): string[] {
  if (!articleText) return []
  const cited = new Set<string>()
  // "「OO법」", "「OO에 관한 법률」", "「OO 조례」" 패턴.
  // 접미 목록은 article-anchor와 공유한다 — 따로 적어두면 한쪽만 낡는다(#139: 조례 누락).
  // 접두는 1자부터 — {2,40}을 요구하면 접미 앞에 2자가 있어야 해서 「민법」·「형법」처럼
  // 가장 많이 인용되는 두 글자 법령명이 통째로 안 잡혔다.
  const bracketRe = new RegExp(`「([^」]{1,39}?${LAW_NAME_SUFFIX_PATTERN})」`, "g")
  let m: RegExpExecArray | null
  while ((m = bracketRe.exec(articleText)) !== null) {
    cited.add(m[1].trim())
  }
  return [...cited].slice(0, 10)
}

function safeMermaidId(s: string): string {
  return s.replace(/[^A-Za-z0-9가-힣]/g, "_").slice(0, 20)
}

export function buildMermaid(
  centerLabel: string,
  buckets: {
    precedents: number
    interpretations: number
    appeals: number
    constitutional: number
    ordinances: number
    citedLaws: string[]
    /** 조회 실패한 축의 표시명. 그래프에서 가지가 조용히 빠지면 "인용 없음"으로 읽힌다 (B#5) */
    failed?: string[]
  }
): string {
  const center = safeMermaidId(centerLabel) || "CENTER"
  const lines: string[] = ["graph LR"]
  lines.push(`    ${center}["⚖️ ${centerLabel}"]`)
  if (buckets.precedents > 0) lines.push(`    ${center} --> P["📚 대법원 판례 ${buckets.precedents}건"]`)
  if (buckets.constitutional > 0) lines.push(`    ${center} --> C["⚖️ 헌재 결정 ${buckets.constitutional}건"]`)
  if (buckets.interpretations > 0) lines.push(`    ${center} --> I["📑 법령해석 ${buckets.interpretations}건"]`)
  if (buckets.appeals > 0) lines.push(`    ${center} --> A["📋 행정심판 ${buckets.appeals}건"]`)
  if (buckets.ordinances > 0) lines.push(`    ${center} --> O["🏛️ 자치법규 ${buckets.ordinances}건"]`)
  const failedLabels = buckets.failed || []
  failedLabels.forEach((label, i) => {
    lines.push(`    ${center} -.-> F${i}["❓ ${label} 조회 실패"]`)
  })
  if (buckets.citedLaws.length > 0) {
    buckets.citedLaws.slice(0, 5).forEach((law, i) => {
      lines.push(`    ${center} -.인용.-> L${i}["📖 ${law}"]`)
    })
  }
  return lines.join("\n")
}
