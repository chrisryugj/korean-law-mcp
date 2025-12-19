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
