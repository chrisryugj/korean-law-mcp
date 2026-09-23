/**
 * 조문 경계 앵커 — "제103조"와 "제1032조"를 가르는 규칙 (#90, #98)
 *
 * 법제처 검색은 조번호를 부분 문자열로 물어온다("민법 제103조" 질의에 「민법 제1032조
 * 위헌소원」이 최상위로 섞임). 인용 그래프는 "이 조문을 인용했다"는 사실 주장을 하므로
 * 이 오탐은 그대로 잘못된 근거가 된다. 검색 결과를 조 단위로 다시 판정해 걸러낸다.
 *
 * 판정은 3값이다 — 매칭/불일치만 두면 사건명에 조문 표기가 없는 정상 항목
 * (예: "손해배상(기)")까지 죽는다. 판정 불가는 'silent'로 남겨 호출자가 살린다.
 */
import { buildJO, formatJO } from "./law-parser.js"
import { normalizeAliasKey, normalizeLawSearchText, resolveLawAlias } from "./search-normalizer.js"
import { INTERPUNCT_CHARS } from "./law-search.js"

export interface ArticleAnchor {
  /** 6자리 JO 코드 (AAAABB) */
  code: string
  /** 자연어 표기 (제103조 / 제10조의2) */
  display: string
  /** 조번호 — 정수. 레포 전반의 `jo`는 문자열(코드·표기)이라 이름을 겹치지 않게 한다 */
  articleNo: number
  /** 가지번호 (의X). 없으면 0 */
  branchNo: number
  /** 대조할 법령명. 없으면 법령 축을 적용하지 않는다(종전 동작) */
  lawName?: string
}

/**
 * match  = 조번호 일치 + 법령명 확정 일치
 * hold   = 조번호 일치, 법령명 판정 불가(구 제명 가능성 포함) → **유지**한다
 * mismatch = 조번호 불일치 → 제외
 * law-mismatch = 조번호는 맞으나 법령이 확정적으로 다름 → 제외.
 *   mismatch와 합쳐 두면 제외 사유가 전부 "조문 불일치"로 보고된다 (#150)
 * silent = 조문 표기 자체가 없음 → 유지
 */
export type AnchorVerdict = "match" | "hold" | "mismatch" | "law-mismatch" | "silent"

/** 한자·이체자 표기를 한글 표기로 접는다 (law-parser의 정규화와 같은 대응) */
function foldNotation(text: string): string {
  return text.replace(/第/g, "제").replace(/條/g, "조").replace(/之/g, "의")
}

// 조문 참조 패턴. `(\d+)`가 탐욕적이라 "제1032조"는 1032 하나로만 잡히고,
// 부분 문자열 103은 만들어지지 않는다 — 이것이 경계 그 자체다.
// `\s*`는 전각 공백(U+3000)도 흡수하므로 낫표·공백 변형 표기에 내성이 있다.
// 가지번호는 `의2`와 `-2`를 모두 받는다 — buildJO가 둘 다 받으므로, 여기서 `-`를 빼면
// 앵커가 자기 입력 표기("제10조-2")를 스스로 못 알아보고 정당한 항목을 떨어뜨린다.
// 앞선 법령명 토큰을 함께 잡는다(선택). 닫는 낫표는 넘겨서 「형법」 제1조도 읽는다.
// 붙여 쓴 한 덩어리만 본다 — "구 형법 제1조"에서는 수식어를 빼고 '형법'만 남는다.
/**
 * 법령명이 끝나는 접미. 이 목록이 갈라지면 어느 한쪽이 조용히 법령을 놓친다 —
 * impact-buckets가 `조례`를 빠뜨려 조문이 인용한 조례가 그래프에서 사라졌다 (#139).
 */
export const LAW_NAME_SUFFIX_PATTERN = "(?:법률|법|시행령|시행규칙|규칙|규정|조례)"

// 접두는 선택 — '형법'(1자+법)도, '시행령'(접두 없음)도 한 덩어리로 잡아야 한다.
const ARTICLE_REF_RE = new RegExp(
  `((?:[가-힣]{1,28})?${LAW_NAME_SUFFIX_PATTERN})?\\s*[」』】〕]?\\s*제\\s*(\\d+)\\s*조(?:\\s*(?:의|-)\\s*(\\d+))?`,
  "g"
)
// "제103조부터 제105조까지" 같은 범위 표기. 범위 안의 조문은 인용된 것이 맞으므로
// 양 끝만 보고 불일치로 버리면 정당한 자료가 죽는다.
// 뒤따르는 "까지"는 선택 — "제103조~제105조"처럼 생략된 표기가 흔하다. 시작 쪽 `제`를
// 요구하므로 가지번호 하이픈("제10조-2")을 범위로 오인하지 않는다.
const ARTICLE_RANGE_RE = /제\s*(\d+)\s*조(?:\s*(?:의|-)\s*\d+)?\s*(?:부터|~|∼|-)\s*제\s*(\d+)\s*조(?:\s*(?:의|-)\s*\d+)?(?:\s*까지)?/g

/**
 * jo 입력을 앵커로 정규화. 자연어 표기와 6자리 JO 코드를 모두 받는다
 * (get_law_text와 같은 계약 — #98). 해석 불가면 null.
 */
export function parseArticleAnchor(raw: string, lawName?: string): ArticleAnchor | null {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) return null

  let code: string
  if (/^\d{6}$/.test(trimmed)) {
    code = trimmed
  } else {
    try {
      code = buildJO(trimmed)
    } catch {
      return null
    }
  }

  // buildJO는 조번호를 4자리로 pad할 뿐 상한을 두지 않아 "10300"이 "1030000"(7자리)이 된다.
  // 그대로 흘려보내면 formatJO가 원문을 되돌려주고 헤더·검색어·JO 파라미터가 모두 깨진 채
  // 전건 0건이 사실로 보고된다 — #98이 지적한 바로 그 실패다. 6자리가 아니면 거부한다.
  if (code.length !== 6) return null
  const articleNo = Number.parseInt(code.slice(0, 4), 10)
  const branchNo = Number.parseInt(code.slice(4, 6), 10)
  if (!Number.isFinite(articleNo) || articleNo <= 0 || !Number.isFinite(branchNo)) return null
  return { code, display: formatJO(code), articleNo, branchNo, lawName: lawName?.trim() || undefined }
}

export type LawNameVerdict = "same" | "different" | "unknown"

// 하위법령 접미. 같은 조번호라도 「민법」 제1조와 「민법 시행령」 제1조는 다른 규범이다.
const INSTRUMENT_RE = /(시행규칙|시행령|규칙|규정|조례)$/

// normalizeAliasKey는 가운뎃점을 `·•`만 지운다. 나머지 3종(ㆍ‧・)이 남으면 같은 법령이
// 글자 수까지 같은 채로 달라 보여 **확정적으로 다르다**는 판정이 나온다 = 정탐 제거.
// 레포가 이미 쓰는 INTERPUNCT_CHARS 전체를 접은 뒤 비교한다(#75와 같은 함정).
const INTERPUNCT_RE = new RegExp(`[${INTERPUNCT_CHARS}]`, "g")

function lawKey(name: string): string {
  // 2026-09-23 리뷰 C3: normalizeLawSearchText(LexDiff)는 공백 덩어리에서 제곱이다(10만 자 15.0초).
  // 공백을 먼저 접어도 결과가 같다(ordinance-search.test.ts 퍼즈). 대상 법령명은 호출자 입력이다.
  const resolved = resolveLawAlias(normalizeLawSearchText(name.replace(/\s+/g, " "))).canonical
  return normalizeAliasKey(resolved).replace(INTERPUNCT_RE, "")
}

/** 축약 가능성: 짧은 이름의 글자들이 순서대로 긴 이름에 나타나면 약칭일 수 있다(도교법 ⊂ 도로교통법) */
function isContractionOf(short: string, long: string): boolean {
  let i = 0
  for (const ch of long) if (ch === short[i]) i++
  return i === short.length
}

/**
 * 법령명 축 판정. LexDiff의 정규화·약칭 사전을 **읽기 전용**으로 사용한다.
 *
 * 정책: 확정적으로 다를 때만 different. 미등록 약칭·표기 변형은 unknown으로 남겨
 * 호출자가 유지하게 한다 — false drop은 #116의 해결이 아니라 새 결함이다.
 */
/** 테스트 도달용 공개 — 프로덕션 소비자는 이 파일 안뿐이다 (#143) */
export function classifyLawName(candidate: string, target: string): LawNameVerdict {
  const c = lawKey(candidate)
  const t = lawKey(target)
  if (!c || !t) return "unknown"
  if (c === t) return "same"

  if ((INSTRUMENT_RE.exec(c)?.[1] ?? "") !== (INSTRUMENT_RE.exec(t)?.[1] ?? "")) return "different"
  // 대상보다 길거나 같으면 대상의 약칭일 수 없다 — 군형법은 형법의 준말이 아니다.
  if (c.length >= t.length) return "different"
  // 짧더라도 글자 순서가 대상에 들어있지 않으면 축약으로 볼 수 없다(민법 ⊄ 도로교통법).
  return isContractionOf(c, t) ? "unknown" : "different"
}

// "구 매장및묘지등에관한법률 제5조 위헌소원" — 위헌심판은 행위시법 심사라 구 제명 인용이
// 흔하다. 제명변경 전신 여부는 문자열만으로 알 수 없으므로 "구 " 신호가 있는 different만
// 보류로 완화한다(#150). 어절 끝 '구'(동대문구 등)를 신호로 읽지 않도록 앞이 한글이면
// 성립하지 않고, 낫표 열림·한자 舊 표기는 허용한다.
const OLD_LAW_PREFIX_RE = /(?:^|[^가-힣])[구舊]\s*[「『【〔]?\s*$/

function hasOldLawPrefix(text: string, lawNameStart: number): boolean {
  return OLD_LAW_PREFIX_RE.test(text.slice(0, lawNameStart))
}

/** 텍스트가 앵커 조문을 가리키는지 판정. 조문 표기가 없으면 silent(판정 보류). */
export function classifyArticleRefs(text: string, anchor: ArticleAnchor): AnchorVerdict {
  // 2026-09-23 리뷰 C7: ARTICLE_REF_RE 의 `\s*[」』】〕]?\s*` 는 공백 덩어리에서 세제곱이다(인용 앞
  // 공백 800자 228ms, 1,600자 1.35초). 자치법규 원시 JSON 전체에 적용되므로 공백을 한 칸으로 접는다.
  // `\s*` 판정은 길이와 무관해 결과가 같고(퍼즈 40만 건 차이 0), m.index 도 접힌 문자열 기준으로 일관된다.
  const folded = foldNotation(text || "").replace(/\s+/g, " ")

  // 범위 표기를 먼저 본다 — 범위 안에 들면 양 끝 조번호가 달라도 인용된 것이 맞다.
  let r: RegExpExecArray | null
  ARTICLE_RANGE_RE.lastIndex = 0
  while ((r = ARTICLE_RANGE_RE.exec(folded)) !== null) {
    const from = Number.parseInt(r[1], 10)
    const to = Number.parseInt(r[2], 10)
    if (from <= anchor.articleNo && anchor.articleNo <= to) return "match"
  }

  let sawRef = false
  let held = false
  let lawMismatch = false
  let m: RegExpExecArray | null
  ARTICLE_REF_RE.lastIndex = 0
  while ((m = ARTICLE_REF_RE.exec(folded)) !== null) {
    sawRef = true
    const articleNo = Number.parseInt(m[2], 10)
    const branchNo = m[3] ? Number.parseInt(m[3], 10) : 0
    if (articleNo !== anchor.articleNo || branchNo !== anchor.branchNo) continue
    if (!anchor.lawName) return "match"           // 법령 축 미적용 — 종전 동작

    // 조번호는 맞다. 이 참조가 어느 법령의 것인지 본다.
    const verdict = m[1] ? classifyLawName(m[1], anchor.lawName) : "unknown"
    if (verdict === "same") return "match"
    // 법령명 그룹이 패턴 선두라 m[1]이 있으면 m.index가 곧 법령명 시작 — 구 접두는 그 앞을 본다
    if (verdict === "unknown" || hasOldLawPrefix(folded, m.index)) held = true
    else lawMismatch = true                       // 확정 타법 — 다음 참조를 계속 본다
  }
  if (held) return "hold"
  if (lawMismatch) return "law-mismatch"
  return sawRef ? "mismatch" : "silent"
}
