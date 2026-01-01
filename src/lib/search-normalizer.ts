/**
 * 법령 검색어 정규화 및 약칭 해결
 * LexDiff에서 이식 (debugLogger 제거)
 */

interface LawAliasEntry {
  canonical: string
  aliases: string[]
  alternatives?: string[]
}

export interface LawAliasResolution {
  canonical: string
  matchedAlias?: string
  alternatives: string[]
}

const BASIC_CHAR_MAP = new Map<string, string>([
  ["벚", "법"],
  ["벆", "법"],
  ["벋", "법"],
  ["뻡", "법"],
  ["볍", "법"],
  ["뱝", "법"],
  ["셰", "세"],
  ["쉐", "세"],
  ["괸", "관"],
  ["곽", "관"],
  ["엄", "업"],
  ["얼", "업"],
])

const LAW_ALIAS_ENTRIES: LawAliasEntry[] = [
  {
    canonical: "대한민국헌법",
    aliases: ["헌법", "헌 법"],
  },
  {
    canonical: "관세법",
    aliases: ["관세벚", "관세요", "관세 볍", "관세 볍률"],
  },
  {
    canonical: "자유무역협정의 이행을 위한 관세법의 특례에 관한 법률",
    aliases: ["fta특례법", "fta 특례법", "fta 특례", "fta특례", "에프티에이특례법"],
    alternatives: ["관세법", "관세법 시행령", "관세법 시행규칙"],
  },
  {
    canonical: "화학물질관리법",
    aliases: ["화관법", "화관 법", "화학물질 관리법"],
    alternatives: ["화학물질관리법 시행령", "화학물질관리법 시행규칙"],
  },
  {
    canonical: "행정기본법",
    aliases: ["행정법", "행정 법"],
    alternatives: ["행정절차법", "행정조사기본법", "행정규제기본법"],
  },
  {
    canonical: "대외무역법",
    aliases: ["무역법", "원산지 사후판정", "원산지법"],
    alternatives: ["원산지표시법", "관세법"],
  },
  {
    canonical: "원산지표시법",
    aliases: ["원산지 표시법", "원산지표시"],
    alternatives: ["대외무역법", "관세법"],
  },
]

const aliasLookup = new Map<string, LawAliasEntry>()

for (const entry of LAW_ALIAS_ENTRIES) {
  aliasLookup.set(normalizeAliasKey(entry.canonical), entry)
  for (const alias of entry.aliases) {
    aliasLookup.set(normalizeAliasKey(alias), entry)
  }
}

function normalizeAliasKey(value: string): string {
  return normalizeBasicTypos(value)
    .toLowerCase()
    .replace(/\s+/gu, "")
    .replace(/[·•]/gu, "")
}

function normalizeBasicTypos(value: string): string {
  return value.replace(/[벚벆벋뻡볍뱝셰쉐괸곽엄얼]/gu, (char) => BASIC_CHAR_MAP.get(char) ?? char)
}

export function normalizeLawSearchText(input: string): string {
  let value = input.normalize("NFC")

  value = value
    .replace(/[\u00a0\u2002\u2003\u2009]/gu, " ")
    .replace(/[‐‑‒–—―﹘﹣－]/gu, "-")
    .replace(/[﹦=]/gu, " ")
    .replace(/§/gu, " 제")
    .replace(/\s*[-]\s*/gu, "-")
    .replace(/\s*\.\s*/gu, " ")

  value = normalizeBasicTypos(value)

  value = value.replace(/([a-zA-Z])([가-힣])/gu, "$1 $2")

  value = value
    .replace(/\s+/gu, " ")
    .replace(/\(\s+/gu, "(")
    .replace(/\s+\)/gu, ")")
    .trim()

  return value
}

export function resolveLawAlias(lawName: string): LawAliasResolution {
  const normalizedKey = normalizeAliasKey(lawName)
  const entry = aliasLookup.get(normalizedKey)

  if (entry) {
    const matchedAlias = entry.aliases.find((alias) => normalizeAliasKey(alias) === normalizedKey)
    return {
      canonical: entry.canonical,
      matchedAlias: matchedAlias || undefined,
      alternatives: entry.alternatives ?? [],
    }
  }

  const cleaned = normalizeBasicTypos(lawName).trim()
  return {
    canonical: cleaned,
    alternatives: [],
  }
}

/**
 * 검색어 확장 (Fuzzy Search)
 * 검색 실패 시 대안 검색어 생성
 */

// 서울시 자치구 목록
const SEOUL_DISTRICTS = [
  "강남구", "강동구", "강북구", "강서구", "관악구", "광진구", "구로구", "금천구",
  "노원구", "도봉구", "동대문구", "동작구", "마포구", "서대문구", "서초구", "성동구",
  "성북구", "송파구", "양천구", "영등포구", "용산구", "은평구", "종로구", "중구", "중랑구"
]

// 광역시/도 목록
const METRO_CITIES = ["부산", "대구", "인천", "광주", "대전", "울산", "세종"]
const PROVINCES = ["경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"]

// 키워드 확장 맵
const KEYWORD_EXPANSIONS: Record<string, string[]> = {
  "4차산업": ["4차산업혁명", "4차 산업혁명", "제4차산업혁명"],
  "ai": ["인공지능", "AI"],
  "인공지능": ["AI", "ai"],
  "iot": ["사물인터넷", "IoT"],
  "빅데이터": ["빅 데이터", "big data"],
  "스마트": ["스마트시티", "스마트도시"],
  "드론": ["무인항공기", "무인비행장치"],
  "자율주행": ["자율주행차", "자율주행자동차"],
  "친환경": ["녹색", "환경친화"],
  "복무": ["복무규정", "근무"],
  "지원": ["육성", "진흥", "촉진"],
}

export interface ExpandedQueries {
  original: string
  expanded: string[]
}

/**
 * 자치법규 검색어 확장
 * 구/군 이름 → 광역시/도 + 구/군 형태로 확장
 */
export function expandOrdinanceQuery(query: string): ExpandedQueries {
  const normalized = normalizeLawSearchText(query)
  const expanded: string[] = []

  // 1. 서울시 자치구 확장
  for (const district of SEOUL_DISTRICTS) {
    if (normalized.includes(district)) {
      // "광진구 조례" → "서울특별시 광진구 조례"
      const withSeoul = normalized.replace(district, `서울특별시 ${district}`)
      if (!expanded.includes(withSeoul)) expanded.push(withSeoul)

      // 짧은 형태도 추가
      const shortForm = `서울시 ${district} ${normalized.replace(district, "").trim()}`
      if (!expanded.includes(shortForm)) expanded.push(shortForm.trim())
    }
  }

  // 2. 키워드 확장
  for (const [keyword, alternatives] of Object.entries(KEYWORD_EXPANSIONS)) {
    if (normalized.toLowerCase().includes(keyword.toLowerCase())) {
      for (const alt of alternatives) {
        const expandedQuery = normalized.replace(new RegExp(keyword, "gi"), alt)
        if (!expanded.includes(expandedQuery) && expandedQuery !== normalized) {
          expanded.push(expandedQuery)
        }
      }
    }
  }

  // 3. 조례/규칙 확장
  if (normalized.includes("조례") && !expanded.some(e => e.includes("규칙"))) {
    expanded.push(normalized.replace("조례", "규칙"))
  }

  return {
    original: normalized,
    expanded: expanded.slice(0, 5) // 최대 5개
  }
}

/**
 * 일반 법령 검색어 확장
 */
export function expandLawQuery(query: string): ExpandedQueries {
  const normalized = normalizeLawSearchText(query)
  const expanded: string[] = []

  // 키워드 확장
  for (const [keyword, alternatives] of Object.entries(KEYWORD_EXPANSIONS)) {
    if (normalized.toLowerCase().includes(keyword.toLowerCase())) {
      for (const alt of alternatives) {
        const expandedQuery = normalized.replace(new RegExp(keyword, "gi"), alt)
        if (!expanded.includes(expandedQuery) && expandedQuery !== normalized) {
          expanded.push(expandedQuery)
        }
      }
    }
  }

  // 약칭 해결
  const aliasResolution = resolveLawAlias(normalized)
  if (aliasResolution.canonical !== normalized) {
    expanded.unshift(aliasResolution.canonical)
  }
  expanded.push(...aliasResolution.alternatives)

  return {
    original: normalized,
    expanded: expanded.slice(0, 5)
  }
}
