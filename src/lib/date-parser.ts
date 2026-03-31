/**
 * 자연어 날짜 범위 파서
 * 검색 쿼리에서 시간 조건을 추출하여 YYYYMMDD 범위로 변환.
 */

export interface DateRange {
  /** 시작일 (YYYYMMDD) */
  from: string
  /** 종료일 (YYYYMMDD) */
  to: string
}

export interface DateParseResult {
  /** 추출된 날짜 범위 (없으면 undefined) */
  range?: DateRange
  /** 날짜 표현을 제거한 쿼리 (검색용) */
  cleanQuery: string
}

/** YYYYMMDD 포맷 */
function fmt(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}${m}${day}`
}

/** 오늘 기준 N개월 전 */
function monthsAgo(n: number, base: Date = new Date()): Date {
  const d = new Date(base)
  d.setMonth(d.getMonth() - n)
  return d
}

/** 오늘 기준 N년 전 */
function yearsAgo(n: number, base: Date = new Date()): Date {
  const d = new Date(base)
  d.setFullYear(d.getFullYear() - n)
  return d
}

/** 오늘 기준 N일 전 */
function daysAgo(n: number, base: Date = new Date()): Date {
  const d = new Date(base)
  d.setDate(d.getDate() - n)
  return d
}

/** 특정 연/월의 첫날 */
function monthStart(year: number, month: number): Date {
  return new Date(year, month - 1, 1)
}

/** 특정 연/월의 마지막날 */
function monthEnd(year: number, month: number): Date {
  return new Date(year, month, 0)
}

interface TimePattern {
  regex: RegExp
  resolve: (m: RegExpMatchArray) => DateRange
}

const patterns: TimePattern[] = [
  // "2020년부터 2023년까지" / "2020~2023"
  {
    regex: /(\d{4})\s*(?:년\s*)?(?:부터|~|–|-)\s*(\d{4})\s*(?:년\s*)?(?:까지)?/,
    resolve: (m) => ({
      from: `${m[1]}0101`,
      to: `${m[2]}1231`,
    }),
  },
  // "최근 N년"
  {
    regex: /최근\s*(\d+)\s*년/,
    resolve: (m) => ({
      from: fmt(yearsAgo(parseInt(m[1], 10))),
      to: fmt(new Date()),
    }),
  },
  // "최근 N개월"
  {
    regex: /최근\s*(\d+)\s*개월/,
    resolve: (m) => ({
      from: fmt(monthsAgo(parseInt(m[1], 10))),
      to: fmt(new Date()),
    }),
  },
  // "YYYY년 이후" / "YYYY년부터"
  {
    regex: /(\d{4})\s*년\s*(?:이후|이래|부터)/,
    resolve: (m) => ({
      from: `${m[1]}0101`,
      to: fmt(new Date()),
    }),
  },
  // "YYYY년 이전" / "YYYY년까지"
  {
    regex: /(\d{4})\s*년\s*(?:이전|까지|전)/,
    resolve: (m) => ({
      from: "19480101",
      to: `${m[1]}1231`,
    }),
  },
  // "N개월 전"
  {
    regex: /(\d+)\s*개월\s*전/,
    resolve: (m) => {
      const t = monthsAgo(parseInt(m[1], 10))
      return { from: fmt(monthStart(t.getFullYear(), t.getMonth() + 1)), to: fmt(monthEnd(t.getFullYear(), t.getMonth() + 1)) }
    },
  },
  // "YYYY년 N월" (특정 월)
  {
    regex: /(\d{4})\s*년\s*(\d{1,2})\s*월/,
    resolve: (m) => {
      const y = parseInt(m[1], 10)
      const mo = parseInt(m[2], 10)
      return { from: fmt(monthStart(y, mo)), to: fmt(monthEnd(y, mo)) }
    },
  },
  // "올해 상반기" / "올해 하반기"
  {
    regex: /올해\s*(상반기|하반기)/,
    resolve: (m) => {
      const y = new Date().getFullYear()
      if (m[1] === "상반기") return { from: `${y}0101`, to: `${y}0630` }
      return { from: `${y}0701`, to: `${y}1231` }
    },
  },
  // "지난달" / "이번달" / "저번달"
  {
    regex: /(지난달|저번달|이번\s*달)/,
    resolve: (m) => {
      const now = new Date()
      if (m[1] === "이번 달" || m[1] === "이번달") {
        return { from: fmt(monthStart(now.getFullYear(), now.getMonth() + 1)), to: fmt(monthEnd(now.getFullYear(), now.getMonth() + 1)) }
      }
      const p = monthsAgo(1, now)
      return { from: fmt(monthStart(p.getFullYear(), p.getMonth() + 1)), to: fmt(monthEnd(p.getFullYear(), p.getMonth() + 1)) }
    },
  },
  // "지난주" / "이번주"
  {
    regex: /(지난주|이번\s*주)/,
    resolve: (m) => {
      const now = new Date()
      const day = now.getDay() // 0=Sun
      if (m[1] === "이번 주" || m[1] === "이번주") {
        const mon = daysAgo(day === 0 ? 6 : day - 1, now)
        const sun = new Date(mon)
        sun.setDate(mon.getDate() + 6)
        return { from: fmt(mon), to: fmt(sun) }
      }
      // 지난주: 이번주 월요일 -7 ~ -1
      const thisMon = daysAgo(day === 0 ? 6 : day - 1, now)
      const lastMon = daysAgo(7, thisMon)
      const lastSun = daysAgo(1, thisMon)
      return { from: fmt(lastMon), to: fmt(lastSun) }
    },
  },
  // "작년" / "올해" / "재작년"
  {
    regex: /(재작년|작년|올해|금년)/,
    resolve: (m) => {
      const now = new Date()
      const y = now.getFullYear()
      let target = y
      if (m[1] === "작년") target = y - 1
      else if (m[1] === "재작년") target = y - 2
      return { from: `${target}0101`, to: `${target}1231` }
    },
  },
  // "최신" / "요즘" / "근래" → 최근 3년
  {
    regex: /(?:^|\s)(최신|요즘|근래)(?:\s|$)/,
    resolve: () => ({
      from: fmt(yearsAgo(3)),
      to: fmt(new Date()),
    }),
  },
]

/** 쿼리에서 시간 조건을 추출하고, 날짜 표현을 제거한 검색어를 반환. */
export function parseDateRange(query: string): DateParseResult {
  for (const p of patterns) {
    const m = query.match(p.regex)
    if (m) {
      const range = p.resolve(m)
      // 매칭된 부분을 제거하여 깨끗한 검색어 생성
      const cleanQuery = query.replace(m[0], "").replace(/\s+/g, " ").trim()
      return { range, cleanQuery }
    }
  }
  return { cleanQuery: query }
}
